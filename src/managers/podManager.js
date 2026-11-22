const { MessageFlags } = require('discord.js');
const queries = require('../database/queries');
const embeds = require('../utils/embeds');
const scoring = require('../utils/scoring');
const channelManager = require('./channelManager');
const webhookService = require('../services/webhookService');
const { isCoordinator } = require('../utils/permissions');
const { handleRoundCompletion } = require('./roundManager');
const config = require('../config');

/**
 * Refreshes the pod's status embed in its match channel.
 */
async function refreshPodEmbed(channel, pod, players, round, tournament) {
  if (!channel || !pod.message_id) return;
  try {
    const msg = await channel.messages.fetch(pod.message_id);
    if (msg) {
      await msg.edit(embeds.createTournamentPodMessage(
        pod,
        players,
        round.round_number,
        Boolean(round.is_finals),
        tournament.finals_round_number
      ));
    }
  } catch (err) {}
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
  if (!isLeader && !isCoordinator(interaction.member, tournament, interaction)) {
    return interaction.reply({
      content: `⚠️ Only the Lobby Leader (<@${pod.leader_user_id}>) or a Tournament Coordinator can submit the lobby code.`,
      flags: MessageFlags.Ephemeral
    });
  }

  await queries.updatePodCode(podId, cleanCode);
  const updatedPod = await queries.getPodById(podId);
  const players = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);

  await interaction.reply({
    content: `✅ Lobby code set to **\`${cleanCode}\`**! All players can now join the in-game lobby. When ready, the Leader or Coordinator can click **Start Match**.`
  });

  await refreshPodEmbed(interaction.channel, updatedPod, players, round, tournament);
  webhookService.notifyWebhooks('pod_started').catch(() => null);
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
  if (!isLeader && !isCoordinator(interaction.member, tournament, interaction)) {
    return interaction.reply({
      content: `⚠️ Only the Lobby Leader (<@${pod.leader_user_id}>) or a Coordinator can start the match.`,
      flags: MessageFlags.Ephemeral
    });
  }

  await queries.markPodStarted(podId);
  const updatedPod = await queries.getPodById(podId);
  const players = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);

  await interaction.reply({
    content: `🚀 **Match Started!** Placements can now be reported using the **Report Placement** button below when the game concludes. Good luck!`
  });

  await refreshPodEmbed(interaction.channel, updatedPod, players, round, tournament);
  webhookService.notifyWebhooks('pod_started').catch(() => null);
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
  if (!players.some(p => p.user_id === interaction.user.id)) {
    return interaction.reply({ content: '⚠️ You are not a player in this pod.', flags: MessageFlags.Ephemeral });
  }

  await queries.setPodPlayerPlacement(podId, interaction.user.id, placement, 0, 0, 0);

  const updatedPlayers = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);
  const tournament = await queries.getTournamentById(pod.tournament_id);

  await interaction.reply({
    content: `✅ Recorded your placement as **Rank ${placement}**. (${updatedPlayers.filter(p => p.placement).length}/${players.length} players reported)`,
    flags: MessageFlags.Ephemeral
  });

  await refreshPodEmbed(interaction.channel, pod, updatedPlayers, round, tournament);

  const reportedCount = updatedPlayers.filter(p => p.placement !== null).length;
  if (reportedCount === players.length) {
    const targetGuild = interaction.guild || (interaction.guildId ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null) : null);
    if (targetGuild) {
      await finalizePodResults(targetGuild, pod, updatedPlayers, round, tournament, { allowTies: false });
    }
  }
}

/**
 * Finalizes results for a pod when all players have reported or coordinator overrides.
 */
async function finalizePodResults(guild, pod, players, round, tournament, { allowTies = true } = {}) {
  const placements = players.map(p => p.placement);
  const validation = scoring.validatePlacements(placements, players.length, { allowTies });

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
    const finalsScores = scoring.calculateFinalsPodScores(players);
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

  if (channel) {
    await refreshPodEmbed(channel, finalPod, finalPlayers, round, tournament);
    await channel.send({
      content: `🏁 **Pod #${pod.pod_number} Match Concluded!** Results have been verified and recorded.`
    });
  }

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
      console.warn('[PodManager] Could not post to results channel:', err.message);
    }
  }

  const allPodsInRound = await queries.getPodsForRound(round.id);
  if (allPodsInRound.every(p => p.status === 'completed')) {
    const roundClaimed = await queries.completeRound(round.id);
    if (roundClaimed) {
      await handleRoundCompletion(guild, tournament, round, isFinals, champion);
    }
  }

  webhookService.notifyWebhooks('pod_completed').catch(() => null);
}

/**
 * Validates that all specified ruling players are distinct and belong to the pod.
 */
function validateRulingPlayers(allPlayers, targetIds) {
  const uniqueIds = new Set(targetIds);
  if (uniqueIds.size !== targetIds.length || targetIds.length === 0) {
    throw new Error('You must select distinct players for this ruling.');
  }
  const podIds = new Set(allPlayers.map(p => p.user_id));
  for (const id of uniqueIds) {
    if (!podIds.has(id)) {
      throw new Error(`Player <@${id}> is not assigned to this pod.`);
    }
  }
  return uniqueIds;
}

/**
 * Rule F.1: Officially rules a pod stuck due to trigger limits.
 */
async function rulePodStuck(guild, podId, remainingPlayerIds) {
  const pod = await queries.getPodById(podId);
  if (!pod) throw new Error(`Pod #${podId} not found.`);
  if (pod.status === 'completed') throw new Error(`Pod #${podId} is already completed.`);
  const tournament = await queries.getTournamentById(pod.tournament_id);
  const round = await queries.getRoundById(pod.round_id);
  const allPlayers = await queries.getPodPlayers(podId);

  const remainingSet = validateRulingPlayers(allPlayers, remainingPlayerIds);

  for (const p of allPlayers) {
    p.placement = remainingSet.has(p.user_id) ? 1 : remainingSet.size + 1;
  }

  const check = scoring.validatePlacements(allPlayers.map(p => p.placement), allPlayers.length, { allowTies: true });
  if (!check.valid) throw new Error(check.error);

  const marked = await queries.markPodStuck(podId);
  if (!marked) throw new Error(`Pod #${podId} is already completed.`);
  pod.status = 'stuck';
  await finalizePodResults(guild, pod, allPlayers, round, tournament, { allowTies: true });
}

/**
 * Rule F.2: Voids a crashed lobby and prepares it for replay (if >= 3 players remaining).
 */
async function voidPodReplay(guild, podId) {
  const pod = await queries.getPodById(podId);
  if (!pod) throw new Error(`Pod #${podId} not found.`);
  if (pod.status === 'completed') throw new Error(`Pod #${podId} is already completed.`);
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
  if (pod.status === 'completed') throw new Error(`Pod #${podId} is already completed.`);
  const tournament = await queries.getTournamentById(pod.tournament_id);
  const round = await queries.getRoundById(pod.round_id);
  const allPlayers = await queries.getPodPlayers(podId);

  const topTwoSet = validateRulingPlayers(allPlayers, [player1Id, player2Id]);

  for (const p of allPlayers) {
    p.placement = topTwoSet.has(p.user_id) ? 1 : 3;
  }

  const check = scoring.validatePlacements(allPlayers.map(p => p.placement), allPlayers.length, { allowTies: true });
  if (!check.valid) throw new Error(check.error);

  await finalizePodResults(guild, pod, allPlayers, round, tournament, { allowTies: true });
}

/**
 * Coordinator simulates match results for testing purposes.
 */
async function simulatePodMatch(guild, podId) {
  const pod = await queries.getPodById(podId);
  if (!pod || pod.status === 'completed') {
    throw new Error('This pod is already completed.');
  }

  if (!pod.lobby_code) {
    await queries.updatePodCode(podId, 'SIM1');
  }
  if (pod.status !== 'started') {
    await queries.markPodStarted(podId);
  }

  const players = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);
  const tournament = await queries.getTournamentById(pod.tournament_id);

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

/**
 * Overrides placements for any pod (including already-completed pods by rolling back prior scores first).
 */
async function overridePodPlacements(guild, podId, ranks) {
  const pod = await queries.getPodById(podId);
  if (!pod) throw new Error(`Pod #${podId} not found.`);
  const players = await queries.getPodPlayers(podId);
  const round = await queries.getRoundById(pod.round_id);
  const tournament = await queries.getTournamentById(pod.tournament_id);

  if (!Array.isArray(ranks) || ranks.some(r => !Number.isInteger(r))) {
    throw new Error('Placements must be whole numbers separated by spaces (e.g. 1 2 3 4 5 6).');
  }
  const validation = scoring.validatePlacements(ranks, players.length, { allowTies: true });
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (pod.status === 'completed') {
    await queries.rollbackPodScores(podId, tournament.id, Boolean(round.is_finals));
    await queries.reopenRound(round.id);
    if (tournament.status === 'completed') {
      await queries.updateTournamentStatus(tournament.id, 'in_progress');
      await queries.updateTournamentStage(tournament.id, round.is_finals ? 'finals' : 'swiss');
    }
  }

  for (let i = 0; i < players.length; i++) {
    players[i].placement = ranks[i];
    await queries.setPodPlayerPlacement(podId, players[i].user_id, ranks[i], 0);
  }

  const freshPod = await queries.getPodById(podId);
  const freshTournament = await queries.getTournamentById(tournament.id);
  return await finalizePodResults(guild, freshPod, players, round, freshTournament, { allowTies: true });
}

/**
 * Restarts a pod (including completed pods: rolls back awarded scores, reopens round, and restores/recreates room).
 */
async function restartPod(guild, podId) {
  const pod = await queries.getPodById(podId);
  if (!pod) throw new Error(`Pod #${podId} not found.`);
  const round = await queries.getRoundById(pod.round_id);
  const tournament = await queries.getTournamentById(pod.tournament_id);
  const isFinals = Boolean(round.is_finals);

  if (pod.status === 'completed') {
    await queries.rollbackPodScores(podId, tournament.id, isFinals);
  } else {
    await queries.voidPodMatch(podId);
  }

  await queries.reopenRound(round.id);
  if (tournament.status === 'completed') {
    await queries.updateTournamentStatus(tournament.id, 'in_progress');
    await queries.updateTournamentStage(tournament.id, isFinals ? 'finals' : 'swiss');
  }

  const refreshedPod = await queries.getPodById(podId);
  const players = await queries.getPodPlayers(podId);

  if (guild) {
    let room = refreshedPod.channel_id ? await guild.channels.fetch(refreshedPod.channel_id).catch(() => null) : null;
    if (room && room.isThread()) {
      if (room.archived) await room.setArchived(false, 'Pod restarted by coordinator').catch(() => null);
      if (room.locked) await room.setLocked(false, 'Pod restarted by coordinator').catch(() => null);
    }
    if (!room) {
      room = await channelManager.createPodRoom(guild, tournament, refreshedPod, round.round_number, isFinals, players);
    }

    const podPayload = embeds.createTournamentPodMessage(
      refreshedPod,
      players,
      round.round_number,
      isFinals,
      tournament.finals_round_number
    );
    const playerPings = players.map(p => /^\d{17,20}$/.test(p.user_id) ? `<@${p.user_id}>` : `**${p.username}**`).join(' ');
    const leaderPing = /^\d{17,20}$/.test(refreshedPod.leader_user_id) ? `<@${refreshedPod.leader_user_id}>` : `**${refreshedPod.leader_user_id}**`;
    const msg = await room.send({
      content: `🔄 **Pod #${refreshedPod.pod_number} has been restarted by a Coordinator!** ${playerPings}\n👑 ${leaderPing} is the **Lobby Leader**. Please submit a new 4-character lobby code below.`,
      ...podPayload
    });
    await queries.updatePodChannel(podId, room.id, msg.id);
  }

  webhookService.notifyWebhooks('pod_restarted').catch(() => null);
  return await queries.getPodById(podId);
}

/**
 * Drops a player from a tournament, reassigns Lobby Leader if needed, and auto-assigns last place in their active pod.
 */
async function handlePlayerDrop(guild, tournament, userId, podId = 0) {
  await queries.unregisterParticipant(tournament.id, userId);

  let pod = podId > 0 ? await queries.getPodById(podId) : null;
  if (!pod) {
    const isFinals = tournament.stage === 'finals';
    const targetRoundNum = isFinals ? tournament.finals_round_number : tournament.current_round;
    if (targetRoundNum > 0) {
      pod = await queries.getActivePodForPlayer(tournament.id, targetRoundNum, userId, isFinals);
    }
  }

  if (pod && pod.status !== 'completed') {
    const podPlayers = await queries.getPodPlayers(pod.id);
    const inPod = podPlayers.find(p => p.user_id === userId);
    const podRoom = guild && pod.channel_id ? await guild.channels.fetch(pod.channel_id).catch(() => null) : null;

    if (podRoom) {
      await podRoom.send({ content: `🚪 <@${userId}> has dropped from the tournament.` }).catch(() => null);
    }

    if (pod.leader_user_id === userId) {
      const activeSet = new Set((await queries.getParticipants(pod.tournament_id, true)).map(p => p.user_id));
      const remaining = podPlayers.filter(p => p.user_id !== userId && activeSet.has(p.user_id));
      if (remaining.length > 0) {
        await queries.updatePodLeader(pod.id, remaining[0].user_id);
        if (podRoom) {
          await podRoom.send({
            content: `👑 <@${remaining[0].user_id}> is now the new **Lobby Leader** for this match.`
          }).catch(() => null);
        }
      }
    }

    if (inPod && inPod.placement === null) {
      const lastPlace = podPlayers.length;
      await queries.setPodPlayerPlacement(pod.id, userId, lastPlace, 0, 0, 0);
      const updatedPlayers = await queries.getPodPlayers(pod.id);
      const refreshedPod = await queries.getPodById(pod.id);
      const round = await queries.getRoundById(pod.round_id);

      if (podRoom) {
        await refreshPodEmbed(podRoom, refreshedPod, updatedPlayers, round, tournament);
        await podRoom.send({ content: `📉 <@${userId}> was assigned last place (Rank ${lastPlace}) due to dropping.` }).catch(() => null);
      }

      if (refreshedPod.status === 'started' && updatedPlayers.every(p => p.placement !== null) && guild) {
        await finalizePodResults(guild, refreshedPod, updatedPlayers, round, tournament, { allowTies: false });
      }
    }
  }

  webhookService.notifyWebhooks('player_dropped').catch(() => null);
}

module.exports = {
  handlePodSubmitCode,
  handlePodStartMatch,
  handlePlayerReportPlacement,
  finalizePodResults,
  rulePodStuck,
  voidPodReplay,
  ruleCrashTwoPlayers,
  simulatePodMatch,
  overridePodPlacements,
  restartPod,
  handlePlayerDrop
};
