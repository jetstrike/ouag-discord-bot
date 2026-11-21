const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const queries = require('../database/queries');
const embeds = require('../utils/embeds');
const tournamentManager = require('../managers/tournamentManager');
const channelManager = require('../managers/channelManager');
const webhookService = require('../services/webhookService');
const config = require('../config');

const builder = new SlashCommandBuilder()
  .setName('tournament')
  .setDescription("Once Upon a Galaxy Tournament management (Chekhov's Gum format)")
  .addSubcommand(sub =>
    sub
      .setName('create')
      .setDescription('Create a new OUAG tournament (4 Swiss rounds + Top 6 Finals)')
      .addStringOption(opt =>
        opt.setName('name').setDescription('Tournament name (e.g. Galaxy Championship #1)').setMaxLength(100).setRequired(true)
      )
      .addStringOption(opt =>
        opt
          .setName('channel_mode')
          .setDescription('Temporary pod room style')
          .setRequired(true)
          .addChoices(
            { name: 'Dedicated Text Channels (in Category)', value: 'category' },
            { name: 'Discord Private Threads', value: 'thread' }
          )
      )
      .addChannelOption(opt =>
        opt
          .setName('results_channel')
          .setDescription('Channel where final pod match results are published')
          .addChannelTypes(ChannelType.GuildText)
      )
      .addChannelOption(opt =>
        opt
          .setName('category')
          .setDescription('Discord Category for dedicated pod channels (if channel_mode is Category)')
          .addChannelTypes(ChannelType.GuildCategory)
      )
      .addRoleOption(opt =>
        opt.setName('coordinator_role').setDescription('Role permitted to coordinate and override matches')
      )
  )
  .addSubcommand(sub =>
    sub.setName('start').setDescription('Begin Swiss Round 1 with random seeding & balanced lobby sizes')
  )
  .addSubcommand(sub =>
    sub.setName('next-round').setDescription('Advance to next Swiss round (applies Round 3 Cut or 15-min break)')
  )
  .addSubcommand(sub =>
    sub.setName('start-finals').setDescription('Launch Grand Finals Lobby #1 with the Top 6 finalists')
  )
  .addSubcommand(sub =>
    sub.setName('next-finals-round').setDescription('Launch next Finals lobby if win condition was not met')
  )
  .addSubcommand(sub =>
    sub.setName('standings').setDescription('View current tournament standings & qualification/win-eligible zone')
  )
  .addSubcommand(sub =>
    sub
      .setName('cut')
      .setDescription('Coordinator manually triggers or adjusts Round 3 Cut')
      .addIntegerOption(opt => opt.setName('count').setDescription('Number of bottom players to eliminate').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('rule-stuck')
      .setDescription('Rule F.1: Rule pod stuck (remaining players share 1st/2nd; cannot win from stuck lobby)')
      .addIntegerOption(opt => opt.setName('pod_id').setDescription('Pod ID').setRequired(true))
      .addUserOption(opt => opt.setName('player1').setDescription('Remaining Player 1').setRequired(true))
      .addUserOption(opt => opt.setName('player2').setDescription('Remaining Player 2').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('crash-replay')
      .setDescription('Rule F.2: Game crashed with >= 3 players. Voids match and prepares pod replay')
      .addIntegerOption(opt => opt.setName('pod_id').setDescription('Pod ID').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('crash-two')
      .setDescription('Rule F.2: Game crashed with 2 players remaining. Awards tie for 1st and 2nd')
      .addIntegerOption(opt => opt.setName('pod_id').setDescription('Pod ID').setRequired(true))
      .addUserOption(opt => opt.setName('player1').setDescription('Player 1').setRequired(true))
      .addUserOption(opt => opt.setName('player2').setDescription('Player 2').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('override-pod')
      .setDescription('Override placements for any pod (including completed pods; rolls back old scores)')
      .addIntegerOption(opt => opt.setName('pod_id').setDescription('Pod ID').setRequired(true))
      .addStringOption(opt => opt.setName('placements').setDescription('Space-separated ranks in pod player order (e.g. 1 2 3 4 5 6)').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('restart-pod')
      .setDescription('Restart a pod (rolls back scores if completed and reopens its match room)')
      .addIntegerOption(opt => opt.setName('pod_id').setDescription('Pod ID').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('add-player')
      .setDescription('Coordinator manually registers a player')
      .addUserOption(opt => opt.setName('player').setDescription('Player to register').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('drop-player')
      .setDescription('Coordinator drops a player from the tournament')
      .addUserOption(opt => opt.setName('player').setDescription('Player to drop').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('add-bots')
      .setDescription('Add mock bot players for solo tournament testing without pinging anyone')
      .addIntegerOption(opt => opt.setName('count').setDescription('Number of test bot players to add (e.g. 5, 7, 11, 23)').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('cleanup')
      .setDescription('Clean up all leftover pod channels and threads from a tournament')
      .addIntegerOption(opt =>
        opt
          .setName('tournament_id')
          .setDescription('Tournament ID to clean up (defaults to active or most recent tournament)')
      )
      .addBooleanOption(opt =>
        opt
          .setName('delete_category')
          .setDescription('Also delete the tournament category channel (default: false)')
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('cancel')
      .setDescription('Cancel and delete the active tournament')
  );

function requireCoordinator(interaction, member, tournament, actionLabel) {
  if (!tournamentManager.isCoordinator(member, tournament, interaction)) {
    interaction.reply({ content: `⚠️ Only Coordinators can ${actionLabel}.`, flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

async function handleCreate(interaction, guild) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '⚠️ You need `Manage Server` permission to create a tournament.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { options, channel } = interaction;
  const name = options.getString('name');
  const channelMode = options.getString('channel_mode');
  const resultsChannel = options.getChannel('results_channel');
  const category = options.getChannel('category');
  const coordinatorRole = options.getRole('coordinator_role');

  const tournamentId = await queries.createTournament({
    guildId: guild.id,
    name,
    rounds: config.TOURNAMENT_RULES.SWISS_ROUNDS,
    channelMode,
    categoryId: category?.id,
    tournamentChannelId: channel?.id || interaction.channelId,
    resultsChannelId: resultsChannel?.id || channel?.id || interaction.channelId,
    coordinatorRoleId: coordinatorRole?.id,
    pointsConfig: config.TOURNAMENT_RULES.SWISS_POINTS,
    createdBy: interaction.user.id
  });

  const tournament = await queries.getTournamentById(tournamentId);
  const regMsg = embeds.createRegistrationEmbed(tournament, 0);
  const tourneyChannelId = channel?.id || interaction.channelId;
  const fullTourneyChannel = await interaction.client.channels.fetch(tourneyChannelId).catch(() => null);
  if (fullTourneyChannel && typeof fullTourneyChannel.send === 'function') {
    await fullTourneyChannel.send(regMsg);
  }

  webhookService.notifyWebhooks('tournament_created').catch(() => null);
  return await interaction.editReply({
    content: `✅ Tournament **"${name}"** created following Chekhov's Gum Rules! Registration is live above.`
  });
}

async function handleCleanup(interaction, guild, member) {
  const { options } = interaction;
  const explicitId = options.getInteger('tournament_id');
  const deleteCategory = options.getBoolean('delete_category') || false;

  let targetTourney = null;
  if (explicitId) {
    targetTourney = await queries.getTournamentById(explicitId);
    if (!targetTourney || targetTourney.guild_id !== guild.id) {
      return interaction.reply({
        content: `❌ Tournament with ID #${explicitId} was not found in this server.`,
        flags: MessageFlags.Ephemeral
      });
    }
  } else {
    targetTourney = (await queries.getActiveTournament(guild.id)) || (await queries.getRecentTournament(guild.id));
    if (!targetTourney) {
      return interaction.reply({
        content: '⚠️ No tournament found in this server to clean up.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  if (!requireCoordinator(interaction, member, targetTourney, 'run tournament cleanup')) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const summary = await channelManager.cleanupTournamentChannels(guild, targetTourney, { deleteCategory });

  return await interaction.editReply(
    `🧹 **Tournament Cleanup Complete** for **${targetTourney.name}** (ID #${targetTourney.id}):\n` +
    `• Deleted Pod/Issue Channels: **${summary.deletedChannels}**\n` +
    `• Deleted Threads: **${summary.deletedThreads}**` +
    (summary.deletedCategory ? `\n• Category channel deleted: **Yes**` : '')
  );
}

async function handle(interaction, guild) {
  const { options, member } = interaction;
  const sub = options.getSubcommand();

  if (sub === 'create') return await handleCreate(interaction, guild);
  if (sub === 'cleanup') return await handleCleanup(interaction, guild, member);

  const activeTourney = await queries.getActiveTournament(guild.id);
  if (!activeTourney) {
    return interaction.reply({ content: '⚠️ No active tournament found in this server. Create one using `/tournament create`.', flags: MessageFlags.Ephemeral });
  }

  if (sub === 'start' || sub === 'next-round') {
    if (!requireCoordinator(interaction, member, activeTourney, 'start or advance tournament rounds')) return;
    await interaction.deferReply();
    try {
      const roundInfo = await tournamentManager.startRound(guild, activeTourney.id);
      const podDescriptions = roundInfo.pods.map(p => `Pod #${p.podNumber} (${p.size} players)`).join(', ');
      const prefix = sub === 'start'
        ? `⚔️ **Swiss Round ${roundInfo.roundNumber} has officially begun!**`
        : `⚔️ **Swiss Round ${roundInfo.roundNumber} is LIVE!**`;
      return await interaction.editReply(`${prefix}\nBalanced Pods: ${podDescriptions}. Match rooms are open for players!`);
    } catch (err) {
      return await interaction.editReply(`❌ Could not start round: ${err.message}`);
    }
  }

  if (sub === 'start-finals' || sub === 'next-finals-round') {
    if (!requireCoordinator(interaction, member, activeTourney, 'launch Grand Finals')) return;
    await interaction.deferReply();
    try {
      const finalsInfo = await tournamentManager.startFinalsRound(guild, activeTourney.id);
      return await interaction.editReply(
        `🏆 **GRAND FINALS LOBBY #${finalsInfo.finalsRoundNumber} IS LIVE!**\n` +
        `Match room created. Players with 20+ Finals Points can win the Championship by finishing 1st!`
      );
    } catch (err) {
      return await interaction.editReply(`❌ Could not launch Finals: ${err.message}`);
    }
  }

  if (sub === 'standings') {
    const stage = activeTourney.stage === 'finals' ? 'finals' : 'swiss';
    const standings = await queries.getStandings(activeTourney.id, stage);
    const embed = embeds.createStandingsEmbed(activeTourney, standings, stage);
    const components = [embeds.createStandingsComponents(activeTourney)];
    return interaction.reply({ embeds: [embed], components });
  }

  if (sub === 'cut') {
    if (!requireCoordinator(interaction, member, activeTourney, 'execute cut lines')) return;
    const cutCount = options.getInteger('count');
    if (!Number.isInteger(cutCount) || cutCount <= 0) {
      return interaction.reply({ content: '⚠️ Cut count must be a positive integer greater than 0.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    const eliminated = await queries.eliminateBottomThird(activeTourney.id, cutCount);
    return await interaction.editReply({
      content: `✅ Eliminated ${eliminated.length} players from the tournament according to Swiss standings.`
    });
  }

  if (sub === 'rule-stuck' || sub === 'crash-replay' || sub === 'crash-two' || sub === 'override-pod' || sub === 'restart-pod') {
    if (!requireCoordinator(interaction, member, activeTourney, 'issue match rulings')) return;
    const podId = options.getInteger('pod_id');
    await interaction.deferReply();

    const targetPod = await queries.getPodById(podId);
    if (!targetPod || targetPod.tournament_id !== activeTourney.id) {
      return await interaction.editReply(`❌ Pod #${podId} does not belong to **${activeTourney.name}**.`);
    }

    if (sub === 'override-pod') {
      const ranks = options.getString('placements').trim().split(/\s+/).map(Number);
      try {
        await tournamentManager.overridePodPlacements(guild, podId, ranks);
        return await interaction.editReply(`🛠️ **Pod #${podId} Placements Overridden** and standings updated.`);
      } catch (err) {
        return await interaction.editReply(`❌ ${err.message}`);
      }
    }

    if (sub === 'restart-pod') {
      await tournamentManager.restartPod(guild, podId);
      return await interaction.editReply(`🔄 **Pod #${podId} Restarted**: Prior scores rolled back (if any) and match room reopened.`);
    }

    if (sub === 'rule-stuck') {
      const p1 = options.getUser('player1');
      const p2 = options.getUser('player2');
      await tournamentManager.rulePodStuck(guild, podId, [p1.id, p2.id]);
      return await interaction.editReply(`⚖️ **Stuck Lobby Ruling Applied**: Pod #${podId} remaining players (<@${p1.id}>, <@${p2.id}>) awarded split 1st place points. Neither player may win tournament from this lobby.`);
    }

    if (sub === 'crash-replay') {
      await tournamentManager.voidPodReplay(guild, podId);
      return await interaction.editReply(`🔄 **Crash Replay Ruling Applied**: Pod #${podId} voided for replay. A new 4-character lobby code may be submitted.`);
    }

    const p1 = options.getUser('player1');
    const p2 = options.getUser('player2');
    await tournamentManager.ruleCrashTwoPlayers(guild, podId, p1.id, p2.id);
    return await interaction.editReply(`⚖️ **Two Players Remaining Crash Ruling**: Pod #${podId} concluded with <@${p1.id}> and <@${p2.id}> tied for 1st & 2nd.`);
  }

  if (sub === 'add-player') {
    if (!requireCoordinator(interaction, member, activeTourney, 'manually add players')) return;
    const targetUser = options.getUser('player');
    await queries.registerParticipant(activeTourney.id, targetUser.id, targetUser.username);
    return interaction.reply({ content: `✅ Registered <@${targetUser.id}> for **${activeTourney.name}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'drop-player') {
    if (!requireCoordinator(interaction, member, activeTourney, 'drop players')) return;
    const targetUser = options.getUser('player');
    await queries.unregisterParticipant(activeTourney.id, targetUser.id);
    return interaction.reply({ content: `✅ Dropped <@${targetUser.id}> from **${activeTourney.name}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'add-bots') {
    if (!requireCoordinator(interaction, member, activeTourney, 'add test bot players')) return;
    const count = options.getInteger('count');
    if (count < 1 || count > 64) {
      return interaction.reply({ content: '⚠️ Please choose a count between 1 and 64.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const existing = await queries.getParticipants(activeTourney.id, false);
    const startNum = existing.filter(p => p.username.startsWith('Bot_')).length + 1;

    for (let i = 0; i < count; i++) {
      const botNum = startNum + i;
      await queries.registerParticipant(activeTourney.id, `mock_bot_${Date.now()}_${botNum}`, `Bot_${botNum}`);
    }

    const totalParticipants = await queries.getParticipants(activeTourney.id, true);
    return await interaction.editReply(
      `🤖 Added **${count} test bot players** to **${activeTourney.name}**! Total players: **${totalParticipants.length}**.\n` +
      `• Bots will never ping anyone.\n` +
      `• You can click **⚡ Simulate Pod** or **🛠️ Coordinator Override** in any match room to simulate matches instantly!`
    );
  }

  if (sub === 'cancel') {
    if (!requireCoordinator(interaction, member, activeTourney, 'cancel the tournament')) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const summary = await channelManager.cleanupTournamentChannels(guild, activeTourney, { deleteCategory: false });
    await queries.cancelTournament(activeTourney.id);
    webhookService.notifyWebhooks('tournament_cancelled').catch(() => null);
    return await interaction.editReply(
      `🗑️ Tournament **"${activeTourney.name}"** has been cancelled and removed from the active database.\n` +
      `• Cleaned up **${summary.deletedChannels}** channels and **${summary.deletedThreads}** threads.`
    );
  }
}

module.exports = { builder, handle };
