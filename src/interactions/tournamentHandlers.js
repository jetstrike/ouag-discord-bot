const { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags 
} = require('discord.js');

const queries = require('../database/queries');
const embeds = require('../utils/embeds');
const scoring = require('../utils/scoring');
const tournamentManager = require('../managers/tournamentManager');
const channelManager = require('../managers/channelManager');

/**
 * Announces a player drop inside their pod room and reassigns Lobby Leader if needed.
 */
async function notifyPodOfDrop(guild, pod, userId) {
  if (!guild || !pod || !pod.channel_id) return;
  const podRoom = await guild.channels.fetch(pod.channel_id).catch(() => null);
  if (!podRoom) return;

  await podRoom.send({
    content: `🚪 <@${userId}> has dropped from the tournament.`
  }).catch(() => null);

  if (pod.leader_user_id === userId) {
    const podPlayers = await queries.getPodPlayers(pod.id);
    const remaining = podPlayers.filter(p => p.user_id !== userId);
    if (remaining.length > 0) {
      const newLeader = remaining[0];
      await queries.updatePodLeader(pod.id, newLeader.user_id);
      await podRoom.send({
        content: `👑 <@${newLeader.user_id}> is now the new **Lobby Leader** for this match.`
      }).catch(() => null);
    }
  }
}

async function handleTournamentButton(interaction) {
  const customId = interaction.customId;

  // 1. Tournament Registration
  if (customId.startsWith('tourney_reg_')) {
    const tournamentId = parseInt(customId.replace('tourney_reg_', ''), 10);
    const tournament = await queries.getTournamentById(tournamentId);

    if (!tournament || tournament.status !== 'registration') {
      return interaction.reply({ content: '⚠️ Registration is not currently open for this tournament.', flags: MessageFlags.Ephemeral });
    }

    await queries.registerParticipant(tournamentId, interaction.user.id, interaction.user.username);
    const participants = await queries.getParticipants(tournamentId, true);

    // Update registration embed
    try {
      const regMsg = embeds.createRegistrationEmbed(tournament, participants.length);
      await interaction.message.edit(regMsg);
    } catch (e) {}

    return interaction.reply({
      content: `🎉 You have successfully registered for **${tournament.name}**! Total players: **${participants.length}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 2. Tournament Withdrawal
  if (customId.startsWith('tourney_withdraw_')) {
    const tournamentId = parseInt(customId.replace('tourney_withdraw_', ''), 10);
    const tournament = await queries.getTournamentById(tournamentId);

    if (!tournament || tournament.status !== 'registration') {
      return interaction.reply({ content: '⚠️ You cannot withdraw after tournament rounds have begun.', flags: MessageFlags.Ephemeral });
    }

    const removed = await queries.unregisterParticipant(tournamentId, interaction.user.id);
    const participants = await queries.getParticipants(tournamentId, true);

    try {
      const regMsg = embeds.createRegistrationEmbed(tournament, participants.length);
      await interaction.message.edit(regMsg);
    } catch (e) {}

    return interaction.reply({
      content: removed ? 'ℹ️ You have withdrawn from the tournament.' : 'You were not registered.',
      flags: MessageFlags.Ephemeral
    });
  }

  // 3. Pod Submit Code Modal Trigger
  if (customId.startsWith('pod_code_')) {
    const podId = customId.replace('pod_code_', '');

    const modal = new ModalBuilder()
      .setCustomId(`pod_modal_code_${podId}`)
      .setTitle('Submit Match Lobby Code');

    const codeInput = new TextInputBuilder()
      .setCustomId('pod_code_input')
      .setLabel('4-Character Game Code')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 9B2W')
      .setMinLength(4)
      .setMaxLength(4)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
    return await interaction.showModal(modal);
  }

  // 4. Pod Start Match
  if (customId.startsWith('pod_start_')) {
    const podId = parseInt(customId.replace('pod_start_', ''), 10);
    return await tournamentManager.handlePodStartMatch(interaction, podId);
  }

  // 4b. Pod Simulate Match
  if (customId.startsWith('pod_simulate_')) {
    const podId = parseInt(customId.replace('pod_simulate_', ''), 10);
    const pod = await queries.getPodById(podId);
    if (!pod) {
      return interaction.reply({ content: '⚠️ Pod not found.', flags: MessageFlags.Ephemeral });
    }
    const tournament = await queries.getTournamentById(pod.tournament_id);

    if (!tournamentManager.isCoordinator(interaction.member, tournament, interaction)) {
      return interaction.reply({ content: '⚠️ Only Coordinators can simulate match results.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targetGuild = interaction.guild || (interaction.guildId ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null) : null);
    await tournamentManager.simulatePodMatch(targetGuild, podId);
    return await interaction.editReply(`⚡ Pod #${pod.pod_number} match successfully simulated and finalized!`);
  }

  // 5. Player Report Placement Menu
  if (customId.startsWith('pod_report_')) {
    const podId = customId.replace('pod_report_', '');
    const pod = await queries.getPodById(podId);

    if (!pod || pod.status !== 'started') {
      return interaction.reply({ content: '⚠️ Match is not currently in progress.', flags: MessageFlags.Ephemeral });
    }

    const players = await queries.getPodPlayers(podId);
    const inPod = players.some(p => p.user_id === interaction.user.id);
    if (!inPod) {
      return interaction.reply({ content: '⚠️ You are not assigned to this pod.', flags: MessageFlags.Ephemeral });
    }

    // Ephemeral selector adapting to pod size (4, 5, or 6 players)
    const buttons = [];
    const medals = { 1: '🥇 1st Place', 2: '🥈 2nd Place', 3: '🥉 3rd Place' };
    for (let r = 1; r <= players.length; r++) {
      const label = medals[r] || `${r}th Place`;
      const style = r <= 3 ? ButtonStyle.Primary : ButtonStyle.Secondary;
      buttons.push(new ButtonBuilder().setCustomId(`pod_place_${podId}_${r}`).setLabel(label).setStyle(style));
    }

    const rows = [];
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 3)));
    }

    return interaction.reply({
      content: `Select your finishing placement in this match below (1-${players.length}).\n*(If you tied with another player, select the tied rank!)*`,
      components: rows,
      flags: MessageFlags.Ephemeral
    });
  }

  // 6. Placement selected
  if (customId.startsWith('pod_place_')) {
    const parts = customId.split('_'); // ['pod', 'place', podId, rank]
    const podId = parseInt(parts[2], 10);
    const placement = parseInt(parts[3], 10);
    return await tournamentManager.handlePlayerReportPlacement(interaction, podId, placement);
  }

  // 7. Coordinator Override Modal
  if (customId.startsWith('pod_override_')) {
    const podId = customId.replace('pod_override_', '');
    const pod = await queries.getPodById(podId);
    if (!pod) {
      return interaction.reply({ content: '⚠️ Pod not found.', flags: MessageFlags.Ephemeral });
    }
    const tournament = await queries.getTournamentById(pod.tournament_id);

    if (!tournamentManager.isCoordinator(interaction.member, tournament, interaction)) {
      return interaction.reply({ content: '⚠️ Only Tournament Coordinators can access this override menu.', flags: MessageFlags.Ephemeral });
    }

    const players = await queries.getPodPlayers(podId);
    const modal = new ModalBuilder()
      .setCustomId(`pod_modal_override_${podId}`)
      .setTitle(`Coordinator Override Pod #${pod.pod_number}`);

    // Prompt for 6 placements formatted: Username: Rank
    const summary = players.map(p => `${p.username}: ${p.placement || '?'}`).join('\n');
    const input = new TextInputBuilder()
      .setCustomId('override_placements_input')
      .setLabel(`Ranks (${players.length} numbers, space-separated)`)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('e.g. 1 2 3 4 5 6  or  1 1 3 4 5 6 for ties')
      .setValue(players.map(p => p.placement || 1).join(' '))
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return await interaction.showModal(modal);
  }

  // 8. Player initiates Drop from pod or standings
  if (customId.startsWith('pod_drop_') || customId.startsWith('tourney_drop_')) {
    let tournamentId = null;
    let podId = 0;

    if (customId.startsWith('pod_drop_')) {
      podId = parseInt(customId.replace('pod_drop_', ''), 10);
      const pod = await queries.getPodById(podId);
      if (!pod) return interaction.reply({ content: 'Pod not found.', flags: MessageFlags.Ephemeral });
      tournamentId = pod.tournament_id;
    } else {
      tournamentId = parseInt(customId.replace('tourney_drop_', ''), 10);
    }

    const tournament = await queries.getTournamentById(tournamentId);
    if (!tournament) return interaction.reply({ content: 'Tournament not found.', flags: MessageFlags.Ephemeral });

    const participant = await queries.getParticipant(tournamentId, interaction.user.id);
    if (!participant || participant.status === 'dropped' || participant.status === 'eliminated_cut') {
      return interaction.reply({
        content: '⚠️ You are not currently an active participant in this tournament.',
        flags: MessageFlags.Ephemeral
      });
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tourney_confirm_drop_${tournamentId}_${podId}`)
        .setLabel('Yes, Drop from Tournament')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⚠️'),
      new ButtonBuilder()
        .setCustomId('tourney_cancel_drop')
        .setLabel('Never mind, Stay')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
      content: `⚠️ **Are you sure you want to drop from ${tournament.name}?**\n\n` +
               `• You will be withdrawn from all subsequent rounds.\n` +
               `• This action **cannot** be undone.`,
      components: [confirmRow],
      flags: MessageFlags.Ephemeral
    });
  }

  // 9. Cancel Drop
  if (customId === 'tourney_cancel_drop') {
    return interaction.update({
      content: '✅ Drop cancelled. You are still registered in the tournament.',
      components: []
    });
  }

  // 10. Confirm Drop
  if (customId.startsWith('tourney_confirm_drop_')) {
    const parts = customId.split('_'); // ['tourney', 'confirm', 'drop', tournamentId, podId]
    const tournamentId = parseInt(parts[3], 10);
    const podId = parseInt(parts[4], 10) || 0;

    const tournament = await queries.getTournamentById(tournamentId);
    if (!tournament) return interaction.update({ content: 'Tournament not found.', components: [] });

    await queries.unregisterParticipant(tournamentId, interaction.user.id);

    const targetGuild = interaction.guild || (interaction.guildId ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null) : null);

    // Notify pod room and reassign leader if needed
    if (podId > 0) {
      const pod = await queries.getPodById(podId);
      await notifyPodOfDrop(targetGuild, pod, interaction.user.id);
    } else if (tournament.current_round > 0) {
      const activePod = await queries.getActivePodForPlayer(tournamentId, tournament.current_round, interaction.user.id);
      await notifyPodOfDrop(targetGuild, activePod, interaction.user.id);
    }

    return interaction.update({
      content: `🚪 You have successfully dropped from **${tournament.name}**. Thank you for playing!`,
      components: []
    });
  }

  // 11. Report Issue
  if (customId.startsWith('tourney_report_issue_')) {
    const tournamentId = parseInt(customId.replace('tourney_report_issue_', ''), 10);
    const tournament = await queries.getTournamentById(tournamentId);
    if (!tournament) return interaction.reply({ content: 'Tournament not found.', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetGuild = interaction.guild || (interaction.guildId ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null) : null);
    if (!targetGuild) {
      return interaction.editReply('❌ Could not access server to create issue channel.');
    }

    try {
      const { channel: issueChannel, isExisting } = await channelManager.createIssueChannel(targetGuild, tournament, interaction.user);

      if (isExisting) {
        return interaction.editReply(`⚠️ You already have an open issue channel: <#${issueChannel.id}>.`);
      }

      // Send greeting embed and ping coordinators
      const issuePayload = embeds.createIssueChannelEmbed(tournament, interaction.user);
      await issueChannel.send(issuePayload);

      return interaction.editReply(`🚨 Issue report opened in <#${issueChannel.id}>! Tournament coordinators have been notified.`);
    } catch (err) {
      console.error('[Tournament] Failed to create issue channel:', err);
      return interaction.editReply(`❌ Failed to open issue channel: ${err.message}`);
    }
  }

  // 12. Close / Resolve Issue Channel
  if (customId.startsWith('issue_resolve_')) {
    await interaction.reply({
      content: '🔒 Issue marked as resolved. This channel will close in 5 seconds...'
    });

    setTimeout(async () => {
      try {
        await queries.deleteIssueChannel(interaction.channel.id).catch(() => null);
        if (interaction.channel.isThread()) {
          await interaction.channel.setLocked(true, 'Issue resolved');
          await interaction.channel.setArchived(true, 'Issue resolved');
        } else {
          await interaction.channel.delete('Issue resolved');
        }
      } catch (err) {
        console.error('[Tournament] Error closing issue channel:', err.message);
      }
    }, 5000);
    return;
  }
}

async function handleTournamentModal(interaction) {
  const customId = interaction.customId;

  // Pod code modal
  if (customId.startsWith('pod_modal_code_')) {
    const podId = parseInt(customId.replace('pod_modal_code_', ''), 10);
    const code = interaction.fields.getTextInputValue('pod_code_input');
    return await tournamentManager.handlePodSubmitCode(interaction, podId, code);
  }

  // Coordinator override modal
  if (customId.startsWith('pod_modal_override_')) {
    const podId = parseInt(customId.replace('pod_modal_override_', ''), 10);
    const rawInput = interaction.fields.getTextInputValue('override_placements_input');
    const ranks = rawInput.trim().split(/\s+/).map(Number);

    const pod = await queries.getPodById(podId);
    if (!pod) {
      return interaction.reply({ content: '⚠️ Pod not found.', flags: MessageFlags.Ephemeral });
    }
    const players = await queries.getPodPlayers(podId);
    const round = await queries.getRoundById(pod.round_id);
    const tournament = await queries.getTournamentById(pod.tournament_id);

    if (!tournamentManager.isCoordinator(interaction.member, tournament, interaction)) {
      return interaction.reply({ content: '⚠️ Only Tournament Coordinators can override match placements.', flags: MessageFlags.Ephemeral });
    }

    if (ranks.some(r => !Number.isInteger(r))) {
      return interaction.reply({
        content: '❌ Placements must be whole numbers separated by spaces (e.g. `1 2 3 4 5 6`).',
        flags: MessageFlags.Ephemeral
      });
    }

    const validation = scoring.validatePlacements(ranks, players.length);
    if (!validation.valid) {
      return interaction.reply({
        content: `❌ ${validation.error}`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Apply manual placements to players in current order
    for (let i = 0; i < players.length; i++) {
      players[i].placement = ranks[i];
      await queries.setPodPlayerPlacement(podId, players[i].user_id, ranks[i], 0);
    }

    await interaction.reply({
      content: '✅ Placements manually overridden. Validating and finalizing results...',
      flags: MessageFlags.Ephemeral
    });

    const targetGuild = interaction.guild || (interaction.guildId ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null) : null);
    return await tournamentManager.finalizePodResults(targetGuild, pod, players, round, tournament);
  }
}

module.exports = {
  handleTournamentButton,
  handleTournamentModal
};
