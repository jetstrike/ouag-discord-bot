const queries = require('../database/queries');
const embeds = require('../utils/embeds');
const swissPairing = require('./swissPairing');
const channelManager = require('./channelManager');
const webhookService = require('../services/webhookService');
const config = require('../config');

/**
 * Cleans up all pod rooms belonging to a finished round.
 */
async function cleanupRoundPodRooms(guild, tournament, roundId) {
  if (!guild || !roundId) return;
  const pods = await queries.getPodsForRound(roundId);
  for (const pod of pods) {
    if (pod.channel_id) {
      await channelManager.cleanupPodRoom(guild, pod.channel_id, tournament.channel_mode);
    }
  }
}

/**
 * Starts a new Swiss Round (Rounds 1 through 4).
 */
async function startRound(guild, tournamentId) {
  const tournament = await queries.getTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');

  if (tournament.stage === 'finals') {
    throw new Error('Tournament is currently in Finals stage. Use /tournament next-finals-round to launch a Finals match.');
  }

  const nextRoundNumber = tournament.current_round + 1;
  if (nextRoundNumber > config.TOURNAMENT_RULES.SWISS_ROUNDS) {
    throw new Error(`All ${config.TOURNAMENT_RULES.SWISS_ROUNDS} Swiss rounds have concluded. Use /tournament start-finals to start the Finals.`);
  }

  let prevRound = null;
  if (tournament.current_round > 0) {
    prevRound = await queries.getRoundByTournamentAndNumber(tournamentId, tournament.current_round, 0);
    if (prevRound) {
      const prevPods = await queries.getPodsForRound(prevRound.id);
      const incomplete = prevPods.filter(p => p.status !== 'completed');
      if (incomplete.length > 0) {
        throw new Error(`Swiss Round ${tournament.current_round} still has ${incomplete.length} incomplete pod(s). Finish or rule all pods before advancing.`);
      }
    }
  }

  let participants = await queries.getParticipants(tournamentId, true);

  // If Round 1 has a scheduled start_time, auto-drop unconfirmed players before pairing
  if (nextRoundNumber === 1 && tournament.start_time) {
    const confirmed = participants.filter(p => p.checked_in === 1);
    if (confirmed.length < config.MIN_LOBBY_SIZE) {
      throw new Error(`Need at least ${config.MIN_LOBBY_SIZE} checked-in players to start Round 1. Confirmed: ${confirmed.length}/${participants.length}.`);
    }
    const autoDropped = await queries.autoDropUnconfirmedParticipants(tournamentId);
    if (autoDropped.length > 0 && guild && tournament.tournament_channel_id) {
      const ch = await guild.channels.fetch(tournament.tournament_channel_id).catch(() => null);
      if (ch) {
        await ch.send({
          content: `⏰ **Check-In Closed**: Auto-dropped **${autoDropped.length}** unconfirmed player(s) before Round 1.`
        }).catch(() => null);
      }
    }
    participants = confirmed;
  }

  if (participants.length < config.MIN_LOBBY_SIZE) {
    throw new Error(`Need at least ${config.MIN_LOBBY_SIZE} registered players to start a round. Currently active: ${participants.length}.`);
  }

  const claimed = await queries.claimNextRound(tournamentId, tournament.current_round, nextRoundNumber);
  if (!claimed) {
    throw new Error(`Swiss Round ${nextRoundNumber} is already being started by another coordinator.`);
  }

  let roundId = null;
  const createdPods = [];
  try {
    roundId = await queries.createRound(tournamentId, nextRoundNumber, 0);

    const matchupHistory = await queries.getMatchupHistory(tournamentId);
    const podGroups = swissPairing.generatePods(participants, nextRoundNumber, false, matchupHistory);

    for (let podIndex = 0; podIndex < podGroups.length; podIndex++) {
      const podPlayers = podGroups[podIndex];
      const podNumber = podIndex + 1;
      const leader = podPlayers[Math.floor(Math.random() * podPlayers.length)];

      const podId = await queries.createPod(roundId, tournamentId, podNumber, leader.user_id);

      for (const p of podPlayers) {
        await queries.addPodPlayer(podId, tournamentId, p.user_id, p.username);
      }

      for (let i = 0; i < podPlayers.length; i++) {
        for (let j = i + 1; j < podPlayers.length; j++) {
          await queries.recordMatchup(tournamentId, podPlayers[i].user_id, podPlayers[j].user_id, nextRoundNumber);
        }
      }

      const podData = await queries.getPodById(podId);
      const room = await channelManager.createPodRoom(guild, tournament, podData, nextRoundNumber, false, podPlayers);

      const podMessagePayload = embeds.createTournamentPodMessage(podData, podPlayers, nextRoundNumber, false);
      const playerPings = podPlayers.map(p => /^\d{17,20}$/.test(p.user_id) ? `<@${p.user_id}>` : `**${p.username}**`).join(' ');
      const leaderPing = /^\d{17,20}$/.test(leader.user_id) ? `<@${leader.user_id}>` : `**${leader.username}**`;

      const podMsg = await room.send({
        content: `👋 Welcome to your match room! ${playerPings}\n👑 ${leaderPing} is the **Lobby Leader**. Please create the in-game OUAG lobby and submit the 4-character code below.`,
        ...podMessagePayload
      });

      await queries.updatePodChannel(podId, room.id, podMsg.id);
      createdPods.push({ podId, roomName: room.name, podNumber, size: podPlayers.length });
    }
  } catch (err) {
    await queries.rollbackFailedRound(roundId, tournamentId, tournament.current_round, tournament.stage, tournament.status, false);
    throw err;
  }

  if (prevRound) {
    await cleanupRoundPodRooms(guild, tournament, prevRound.id);
  }

  webhookService.notifyWebhooks('round_started').catch(() => null);
  return { roundNumber: nextRoundNumber, isFinals: false, pods: createdPods };
}

/**
 * Starts a Grand Finals round (continuous match-point format).
 */
async function startFinalsRound(guild, tournamentId) {
  const tournament = await queries.getTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');

  const finalists = await queries.getFinalists(tournamentId);
  if (finalists.length < config.TOURNAMENT_RULES.FINALS_QUALIFIERS) {
    throw new Error(`Need exactly ${config.TOURNAMENT_RULES.FINALS_QUALIFIERS} qualified finalists. Check standings after Round 4.`);
  }

  let prevRoundToCleanup = null;
  if (tournament.finals_round_number > 0) {
    const prevFinalsRound = await queries.getRoundByTournamentAndNumber(tournamentId, tournament.finals_round_number, 1);
    if (prevFinalsRound) {
      const prevPods = await queries.getPodsForRound(prevFinalsRound.id);
      if (prevPods.some(p => p.status !== 'completed')) {
        throw new Error(`Finals Lobby #${tournament.finals_round_number} is still in progress. Finish or rule it before starting the next lobby.`);
      }
      prevRoundToCleanup = prevFinalsRound;
    }
  } else if (tournament.current_round > 0) {
    prevRoundToCleanup = await queries.getRoundByTournamentAndNumber(tournamentId, tournament.current_round, 0);
  }

  const nextFinalsRound = (tournament.finals_round_number || 0) + 1;
  const claimed = await queries.claimNextFinalsRound(tournamentId, tournament.finals_round_number || 0, nextFinalsRound);
  if (!claimed) {
    throw new Error(`Finals Lobby #${nextFinalsRound} is already being started by another coordinator.`);
  }
  const finalsRoundNumber = nextFinalsRound;
  let roundId = null;
  let podId = null;
  let roomName = null;

  try {
    roundId = await queries.createRound(tournamentId, finalsRoundNumber, 1);
    const leader = finalists[0];
    podId = await queries.createPod(roundId, tournamentId, 1, leader.user_id);

    for (const f of finalists) {
      await queries.addPodPlayer(podId, tournamentId, f.user_id, f.username);
    }

    const podData = await queries.getPodById(podId);
    const room = await channelManager.createPodRoom(guild, tournament, podData, finalsRoundNumber, true, finalists);
    roomName = room.name;

    const podMessagePayload = embeds.createTournamentPodMessage(podData, finalists, finalsRoundNumber, true, finalsRoundNumber);
    const playerPings = finalists.map(p => `<@${p.user_id}>`).join(' ');

    const podMsg = await room.send({
      content: `🏆 **GRAND FINALS — LOBBY #${finalsRoundNumber} IS LIVE!** ${playerPings}\n` +
               `👑 <@${leader.user_id}> is the **Lobby Leader**. Please create the OUAG match and submit the 4-character code below.\n` +
               `*(Players with 20+ Finals Points must finish 1st in this lobby to become Tournament Champion!)*`,
      ...podMessagePayload
    });

    await queries.updatePodChannel(podId, room.id, podMsg.id);
  } catch (err) {
    await queries.rollbackFailedRound(roundId, tournamentId, tournament.finals_round_number || 0, tournament.stage, tournament.status, true);
    throw err;
  }

  if (prevRoundToCleanup) {
    await cleanupRoundPodRooms(guild, tournament, prevRoundToCleanup.id);
  }

  webhookService.notifyWebhooks('finals_round_started').catch(() => null);
  return { finalsRoundNumber, podId, roomName };
}

/**
 * Handles round transitions, Round 3 Cut, 15-Minute Finals Break, and Champion crowning.
 */
async function handleRoundCompletion(guild, tournament, round, isFinals, champion) {
  const tourneyChannel = await guild.channels.fetch(tournament.tournament_channel_id).catch(() => null);
  if (!tourneyChannel) return;

  if (isFinals) {
    const finalists = await queries.getFinalists(tournament.id);
    const standingsEmbed = embeds.createStandingsEmbed(tournament, finalists, 'finals');

    if (champion) {
      await queries.updateTournamentStatus(tournament.id, 'completed');
      await queries.updateTournamentStage(tournament.id, 'completed');
      await cleanupRoundPodRooms(guild, tournament, round.id);

      await tourneyChannel.send({
        content: `👑 **CONGRATULATIONS TO THE ONCE UPON A GALAXY CHAMPION!** 👑\n` +
                 `🏆 <@${champion.user_id}> (${champion.username}) has achieved 20+ Finals Points AND captured 1st Place!\n` +
                 `Thank you to everyone who participated!`,
        embeds: [standingsEmbed]
      });
    } else {
      await tourneyChannel.send({
        content: `🏁 **Finals Lobby #${tournament.finals_round_number} Concluded!**\n` +
                 `No finalist has satisfied the championship condition yet.\n` +
                 `Coordinators can launch the next Finals lobby with \`/tournament next-finals-round\`!`,
        embeds: [standingsEmbed],
        components: [embeds.createStandingsComponents(tournament)]
      });
    }
    return;
  }

  const currentRoundNum = round.round_number;
  let cutCount = 0;

  // Rule B.5: Round 3 Cut (Eliminate bottom third)
  if (currentRoundNum === config.TOURNAMENT_RULES.CUT_ROUND) {
    const activeParticipants = await queries.getParticipants(tournament.id, true);
    cutCount = Math.floor(activeParticipants.length / 3);

    if (cutCount > 0) {
      const eliminated = await queries.eliminateBottomThird(tournament.id, cutCount);
      console.log(`[RoundManager] Round 3 Cut: Eliminated ${eliminated.length} players.`);
    }
  }

  const standings = await queries.getStandings(tournament.id, 'swiss');
  const standingsEmbed = embeds.createStandingsEmbed(tournament, standings, 'swiss', cutCount);

  // Rule D.1 & D.2: After Round 4 -> 15-Minute Finals Break & Announce Top 6
  if (currentRoundNum >= config.TOURNAMENT_RULES.SWISS_ROUNDS) {
    const top6 = standings.filter(p => p.status === 'registered').slice(0, config.TOURNAMENT_RULES.FINALS_QUALIFIERS);
    await queries.initFinalsParticipants(tournament.id, top6.map(p => p.user_id));
    await queries.updateTournamentStage(tournament.id, 'finals_break');

    const breakEmbed = embeds.createFinalsBreakEmbed(tournament, top6);

    await tourneyChannel.send({
      content: `🏁 **All 4 Swiss Rounds are officially complete!**\n` +
               `⏰ **15-MINUTE FINALS BREAK COMMENCING** — Tournament staff is reviewing standings.`,
      embeds: [standingsEmbed, breakEmbed],
      components: [embeds.createStandingsComponents(tournament)]
    });
    return;
  }

  let announcement = `🏁 **Swiss Round ${currentRoundNum} is complete!**\n`;
  if (currentRoundNum === 3) {
    announcement += `⚠️ **Round 3 Cut Applied**: The bottom third (${cutCount} players) have been eliminated.\n` +
                    `Remaining players advance to **Swiss Round 4**!`;
  } else {
    announcement += `Coordinators can begin the next round with \`/tournament next-round\`!`;
  }

  await tourneyChannel.send({
    content: announcement,
    embeds: [standingsEmbed],
    components: [embeds.createStandingsComponents(tournament)]
  });
}

module.exports = {
  startRound,
  startFinalsRound,
  handleRoundCompletion
};
