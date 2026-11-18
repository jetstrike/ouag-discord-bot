const queries = require('../database/queries');
const embeds = require('../utils/embeds');
const scoring = require('../utils/scoring');
const swissPairing = require('./swissPairing');
const channelManager = require('./channelManager');
const config = require('../config');

const { PermissionsBitField, MessageFlags } = require('discord.js');

/**
 * Checks if a user is a coordinator or administrator.
 */
function isCoordinator(member, tournament, interaction = null) {
  if (!member && !interaction) return false;

  if (interaction?.memberPermissions) {
    if (interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) || 
        interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return true;
    }
  }

  if (member?.permissions) {
    try {
      const bitfield = typeof member.permissions.has === 'function' 
        ? member.permissions 
        : new PermissionsBitField(member.permissions);
      if (bitfield.has(PermissionsBitField.Flags.Administrator) || bitfield.has(PermissionsBitField.Flags.ManageGuild)) {
        return true;
      }
    } catch (e) {}
  }

  if (tournament?.coordinator_role_id) {
    if (member?.roles?.cache?.has(tournament.coordinator_role_id)) return true;
    if (Array.isArray(member?.roles) && member.roles.includes(tournament.coordinator_role_id)) return true;
  }
  return false;
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

  // Get active registered players
  const participants = await queries.getParticipants(tournamentId, true);
  if (participants.length < config.MIN_LOBBY_SIZE) {
    throw new Error(`Need at least ${config.MIN_LOBBY_SIZE} registered players to start a round. Currently active: ${participants.length}.`);
  }

  // Update DB state
  const roundId = await queries.createRound(tournamentId, nextRoundNumber, 0);
  await queries.updateTournamentCurrentRound(tournamentId, nextRoundNumber);
  await queries.updateTournamentStatus(tournamentId, 'in_progress');
  await queries.updateTournamentStage(tournamentId, 'swiss');

  // Swiss pairing: Random seeding for Round 1, score tiers with rematch minimization for Round 2+
  const matchupHistory = await queries.getMatchupHistory(tournamentId);
  const podGroups = swissPairing.generatePods(participants, nextRoundNumber, false, matchupHistory);
  const createdPods = [];

  for (let podIndex = 0; podIndex < podGroups.length; podIndex++) {
    const podPlayers = podGroups[podIndex];
    const podNumber = podIndex + 1;

    // Designate Lobby Leader (Random player in pod)
    const leader = podPlayers[Math.floor(Math.random() * podPlayers.length)];

    // Create Pod in DB
    const podId = await queries.createPod(roundId, tournamentId, podNumber, leader.user_id);

    for (const p of podPlayers) {
      await queries.addPodPlayer(podId, tournamentId, p.user_id, p.username);
    }

    // Save matchups for head-to-head records
    for (let i = 0; i < podPlayers.length; i++) {
      for (let j = i + 1; j < podPlayers.length; j++) {
        await queries.recordMatchup(tournamentId, podPlayers[i].user_id, podPlayers[j].user_id, nextRoundNumber);
      }
    }

    // Create room (dedicated text channel or private thread)
    const podData = await queries.getPodById(podId);
    const room = await channelManager.createPodRoom(guild, tournament, podData, nextRoundNumber, false, podPlayers);

    // Send Pod message
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

  const finalsRoundNumber = await queries.incrementFinalsRound(tournamentId);
  await queries.updateTournamentStage(tournamentId, 'finals');
  await queries.updateTournamentStatus(tournamentId, 'in_progress');

  const roundId = await queries.createRound(tournamentId, finalsRoundNumber, 1);

  // Designate Lobby Leader (Top seeded finalist or random)
  const leader = finalists[0];
  const podId = await queries.createPod(roundId, tournamentId, 1, leader.user_id);

  for (const f of finalists) {
    await queries.addPodPlayer(podId, tournamentId, f.user_id, f.username);
  }

  const podData = await queries.getPodById(podId);
  const room = await channelManager.createPodRoom(guild, tournament, podData, finalsRoundNumber, true, finalists);

  const podMessagePayload = embeds.createTournamentPodMessage(podData, finalists, finalsRoundNumber, true, finalsRoundNumber);
  const playerPings = finalists.map(p => `<@${p.user_id}>`).join(' ');

  const podMsg = await room.send({
    content: `🏆 **GRAND FINALS — LOBBY #${finalsRoundNumber} IS LIVE!** ${playerPings}\n` +
             `👑 <@${leader.user_id}> is the **Lobby Leader**. Please create the OUAG match and submit the 4-character code below.\n` +
             `*(Players with 20+ Finals Points must finish 1st in this lobby to become Tournament Champion!)*`,
    ...podMessagePayload
  });

  await queries.updatePodChannel(podId, room.id, podMsg.id);
  return { finalsRoundNumber, podId, roomName: room.name };
}

/**
 * Lobby Leader or Coordinator submits the 4-char lobby code.
 */
async function handlePodSubmitCode(interaction, podId, code) {
  const cleanCode = code.trim().toUpperCase();
  if (!config.LOBBY_CODE_REGEX.test(cleanCode)) {
    return interaction.reply({
      content: '❌ Invalid lobby code! Must be exactly 4 alphanumeric characters (e.g. `X8Y1`).',
      flags: MessageFlags.Ephemeral
    });
  }

  const pod = await queries.getPodById(podId);
  if (!pod || pod.status === 'completed') {
    return interaction.reply({ content: '⚠️ This pod is no longer active.', flags: MessageFlags.Ephemeral });
  }

  const tournament = await queries.getTournamentById(pod.tournament_id);
  const isLeader = pod.leader_user_id === interaction.user.id;
  const isCoord = isCoordinator(interaction.member, tournament);

  if (!isLeader && !isCoord) {
    return interaction.reply({
      content: `⚠️ Only the Lobby Leader (<@${pod.leader_user_id}>) or a Tournament Coordinator can submit the lobby code.`,
      flags: MessageFlags.Ephemeral
    });
  }

  await queries.updatePodCode(podId, cleanCode);
  const updatedPod = await queries.getPodById(podId);
  const players = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);

  // Update pod embed
  try {
    const channel = interaction.channel;
    const msg = await channel.messages.fetch(pod.message_id);
    if (msg) {
      await msg.edit(embeds.createTournamentPodMessage(
        updatedPod, 
        players, 
        round.round_number, 
        Boolean(round.is_finals), 
        tournament.finals_round_number
      ));
    }
  } catch (err) {}

  await interaction.reply({
    content: `✅ Lobby code set to **\`${cleanCode}\`**! All players can now join the in-game lobby. When ready, the Leader or Coordinator can click **Start Match**.`
  });
}

/**
 * Lobby Leader or Coordinator marks pod match as started.
 */
async function handlePodStartMatch(interaction, podId) {
  const pod = await queries.getPodById(podId);
  if (!pod || pod.status === 'started' || pod.status === 'completed') {
    return interaction.reply({ content: '⚠️ This match is already in progress or completed.', flags: MessageFlags.Ephemeral });
  }

  if (!pod.lobby_code) {
    return interaction.reply({ content: '⚠️ Please submit the lobby code first.', flags: MessageFlags.Ephemeral });
  }

  const tournament = await queries.getTournamentById(pod.tournament_id);
  const isLeader = pod.leader_user_id === interaction.user.id;
  const isCoord = isCoordinator(interaction.member, tournament);

  if (!isLeader && !isCoord) {
    return interaction.reply({
      content: `⚠️ Only the Lobby Leader (<@${pod.leader_user_id}>) or a Coordinator can start the match.`,
      flags: MessageFlags.Ephemeral
    });
  }

  await queries.markPodStarted(podId);
  const updatedPod = await queries.getPodById(podId);
  const players = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);

  try {
    const msg = await interaction.channel.messages.fetch(pod.message_id);
    if (msg) {
      await msg.edit(embeds.createTournamentPodMessage(
        updatedPod, 
        players, 
        round.round_number, 
        Boolean(round.is_finals), 
        tournament.finals_round_number
      ));
    }
  } catch (err) {}

  await interaction.reply({
    content: `🚀 **Match Started!** Placements can now be reported using the **Report Placement** button below when the game concludes. Good luck!`
  });
}

/**
 * Player reports their match placement.
 */
async function handlePlayerReportPlacement(interaction, podId, placement) {
  const pod = await queries.getPodById(podId);
  if (!pod || pod.status !== 'started') {
    return interaction.reply({ content: '⚠️ Placements can only be reported while the match is started.', flags: MessageFlags.Ephemeral });
  }

  const players = await queries.getPodPlayers(podId);
  const playerInPod = players.find(p => p.user_id === interaction.user.id);
  if (!playerInPod) {
    return interaction.reply({ content: '⚠️ You are not a player in this pod.', flags: MessageFlags.Ephemeral });
  }

  await queries.setPodPlayerPlacement(podId, interaction.user.id, placement, 0, 0, 0);

  const updatedPlayers = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);
  const tournament = await queries.getTournamentById(pod.tournament_id);

  try {
    const msg = await interaction.channel.messages.fetch(pod.message_id);
    if (msg) {
      await msg.edit(embeds.createTournamentPodMessage(
        pod, 
        updatedPlayers, 
        round.round_number, 
        Boolean(round.is_finals), 
        tournament.finals_round_number
      ));
    }
  } catch (err) {}

  await interaction.reply({
    content: `✅ Recorded your placement as **Rank ${placement}**. (${updatedPlayers.filter(p => p.placement).length}/${players.length} players reported)`,
    flags: MessageFlags.Ephemeral
  });

  // Check if all players in pod have reported
  const reportedCount = updatedPlayers.filter(p => p.placement !== null).length;
  if (reportedCount === players.length) {
    const targetGuild = interaction.guild || (interaction.guildId ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null) : null);
    if (targetGuild) {
      await finalizePodResults(targetGuild, pod, updatedPlayers, round, tournament);
    }
  }
}

/**
 * Finalizes results for a pod when all players have reported or coordinator overrides.
 */
async function finalizePodResults(guild, pod, players, round, tournament) {
  const placements = players.map(p => p.placement);
  const validation = scoring.validatePlacements(placements, players.length);

  const channel = guild ? await guild.channels.fetch(pod.channel_id).catch(() => null) : null;

  if (!validation.valid) {
    if (channel) {
      await channel.send({
        content: `⚠️ **Placement Conflict Detected!**\n${validation.error}\n` +
                 `Please review your submitted placements or have a Tournament Coordinator use the **Coordinator Override** button.`
      });
    }
    return;
  }

  // Atomically claim pod completion to prevent concurrent submissions from double-scoring
  const claimed = await queries.claimPodCompletion(pod.id);
  if (!claimed) {
    return;
  }

  const isFinals = Boolean(round.is_finals);
  let champion = null;

  if (isFinals) {
    // Finals Stage Scoring
    const finalsScores = scoring.calculateFinalsPodScores(players);

    // Rule A.2 & E.4: Check Win Condition
    // A player wins when BOTH conditions are met:
    // 1. They have accumulated at least 20 Finals Points.
    // 2. They finish 1st place in a Finals lobby (must enter match eligible or reach 20 and win future lobby).
    for (const report of finalsScores) {
      const pId = report.userId || report.user_id;
      const participant = await queries.getParticipant(tournament.id, pId);
      const wasEligibleBeforeMatch = participant && participant.is_eligible_to_win === 1;

      if (report.placement === 1 && wasEligibleBeforeMatch && pod.status !== 'stuck') {
        champion = participant;
      }

      await queries.setPodPlayerPlacement(pod.id, pId, report.placement, 0, 0, report.finalsPoints);
      await queries.applyFinalsScores(tournament.id, pId, report.finalsPoints, report.placement === 1);
    }
  } else {
    // Swiss Stage Scoring
    const swissScores = scoring.calculateSwissPodScores(players, tournament.points_config);

    for (const report of swissScores) {
      const pId = report.userId || report.user_id;
      await queries.setPodPlayerPlacement(
        pod.id,
        pId,
        report.placement,
        report.swissPoints,
        report.carryOverPoints,
        0
      );
      await queries.applySwissScores(
        tournament.id,
        pId,
        report.swissPoints,
        report.carryOverPoints,
        report.placement === 1
      );
    }
  }

  const finalPod = await queries.getPodById(pod.id);
  const finalPlayers = await queries.getPodPlayers(pod.id);

  // Update pod room message
  if (channel) {
    try {
      const msg = await channel.messages.fetch(pod.message_id);
      if (msg) {
        await msg.edit(embeds.createTournamentPodMessage(
          finalPod, 
          finalPlayers, 
          round.round_number, 
          isFinals, 
          tournament.finals_round_number
        ));
      }
    } catch (e) {}

    await channel.send({
      content: `🏁 **Pod #${pod.pod_number} Match Concluded!** Results have been verified and recorded.`
    });
  }

  // Post to Tournament Results Channel
  if (tournament.results_channel_id) {
    try {
      const resultsChannel = await guild.channels.fetch(tournament.results_channel_id);
      if (resultsChannel) {
        const resultsEmbed = embeds.createMatchResultsEmbed(
          tournament,
          round.round_number,
          pod.pod_number,
          finalPlayers,
          isFinals,
          champion
        );
        await resultsChannel.send({ embeds: [resultsEmbed] });
      }
    } catch (err) {
      console.warn('[TournamentManager] Could not post to results channel:', err.message);
    }
  }

  // Check if ALL pods in this round are completed
  const allPodsInRound = await queries.getPodsForRound(round.id);
  const allComplete = allPodsInRound.every(p => p.status === 'completed');

  if (allComplete) {
    await queries.completeRound(round.id);
    await handleRoundCompletion(guild, tournament, round, isFinals, champion);
  }
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
      // Champion Crowned!
      await queries.updateTournamentStatus(tournament.id, 'completed');
      await queries.updateTournamentStage(tournament.id, 'completed');

      await tourneyChannel.send({
        content: `👑 **CONGRATULATIONS TO THE ONCE UPON A GALAXY CHAMPION!** 👑\n` +
                 `🏆 <@${champion.user_id}> (${champion.username}) has achieved 20+ Finals Points AND captured 1st Place!\n` +
                 `Thank you to everyone who participated!`,
        embeds: [standingsEmbed]
      });
    } else {
      // Finals continues!
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

  // Swiss Stage Round Completion
  const currentRoundNum = round.round_number;
  let cutCount = 0;

  // Rule B.5: Round 3 Cut (Eliminate bottom third)
  if (currentRoundNum === config.TOURNAMENT_RULES.CUT_ROUND) {
    const activeParticipants = await queries.getParticipants(tournament.id, true);
    cutCount = Math.floor(activeParticipants.length / 3);

    if (cutCount > 0) {
      const eliminated = await queries.eliminateBottomThird(tournament.id, cutCount);
      console.log(`[TournamentManager] Round 3 Cut: Eliminated ${eliminated.length} players.`);
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

  // Rounds 1, 2, or 3 complete
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

/**
 * Rule F.1: Officially rules a pod stuck due to trigger limits.
 */
async function rulePodStuck(guild, podId, remainingPlayerIds) {
  const pod = await queries.getPodById(podId);
  if (!pod) throw new Error(`Pod #${podId} not found.`);
  const tournament = await queries.getTournamentById(pod.tournament_id);
  const round = await queries.getRoundById(pod.round_id);
  const allPlayers = await queries.getPodPlayers(podId);

  // Remaining players share 1st place points & carry-over points
  const pointsConfig = tournament.points_config || config.TOURNAMENT_RULES.SWISS_POINTS;
  const isFinals = Boolean(round.is_finals);

  // In stuck lobby: remaining players tied for 1st
  for (const p of allPlayers) {
    if (remainingPlayerIds.includes(p.user_id)) {
      p.placement = 1;
    } else if (!p.placement) {
      p.placement = remainingPlayerIds.length + 1;
    }
  }

  // Mark pod status as stuck so no champion is crowned from it (Rule E.5)
  await queries.run(`UPDATE tournament_pods SET status = 'stuck' WHERE id = ?`, [podId]);
  pod.status = 'stuck';
  await finalizePodResults(guild, pod, allPlayers, round, tournament);
}

/**
 * Rule F.2: Voids a crashed lobby and prepares it for replay (if >= 3 players remaining).
 */
async function voidPodReplay(guild, podId) {
  const pod = await queries.getPodById(podId);
  if (!pod) throw new Error(`Pod #${podId} not found.`);
  await queries.voidPodMatch(podId);

  const channel = await guild.channels.fetch(pod.channel_id).catch(() => null);
  if (channel) {
    await channel.send({
      content: `⚠️ **Game Crash Ruling (>= 3 players remaining)**:\n` +
               `The lobby result has been voided. Please have the Lobby Leader (<@${pod.leader_user_id}>) create a new in-game lobby and submit the new 4-character code below.`
    });
  }
}

/**
 * Rule F.2: Two players remaining crash ruling (awarded tie for 1st and 2nd).
 */
async function ruleCrashTwoPlayers(guild, podId, player1Id, player2Id) {
  const pod = await queries.getPodById(podId);
  if (!pod) throw new Error(`Pod #${podId} not found.`);
  const tournament = await queries.getTournamentById(pod.tournament_id);
  const round = await queries.getRoundById(pod.round_id);
  const allPlayers = await queries.getPodPlayers(podId);

  for (const p of allPlayers) {
    if (p.user_id === player1Id || p.user_id === player2Id) {
      p.placement = 1; // Both tie for top position (1st and 2nd points combined and divided)
    } else if (!p.placement) {
      p.placement = 3;
    }
  }

  await finalizePodResults(guild, pod, allPlayers, round, tournament);
}

/**
 * Coordinator simulates match results for testing purposes.
 * Assigns random placements (1 through N) and finalizes the pod.
 */
async function simulatePodMatch(guild, podId) {
  const pod = await queries.getPodById(podId);
  if (!pod || pod.status === 'completed') {
    throw new Error('This pod is already completed.');
  }

  // If lobby code not set, give it a simulation code
  if (!pod.lobby_code) {
    await queries.updatePodCode(podId, 'SIM1');
  }

  // Mark started if not yet started
  if (pod.status !== 'started') {
    await queries.markPodStarted(podId);
  }

  const players = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);
  const tournament = await queries.getTournamentById(pod.tournament_id);

  // Generate random permutation of ranks 1 through players.length
  const ranks = Array.from({ length: players.length }, (_, i) => i + 1);
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }

  for (let i = 0; i < players.length; i++) {
    players[i].placement = ranks[i];
    await queries.setPodPlayerPlacement(podId, players[i].user_id, ranks[i], 0);
  }

  return await finalizePodResults(guild, pod, players, round, tournament);
}

module.exports = {
  isCoordinator,
  startRound,
  startFinalsRound,
  handlePodSubmitCode,
  handlePodStartMatch,
  handlePlayerReportPlacement,
  finalizePodResults,
  rulePodStuck,
  voidPodReplay,
  ruleCrashTwoPlayers,
  simulatePodMatch
};
