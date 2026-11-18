const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const queries = require('../database/queries');
const embeds = require('../utils/embeds');
const casualManager = require('../managers/casualManager');
const tournamentManager = require('../managers/tournamentManager');
const channelManager = require('../managers/channelManager');
const config = require('../config');

const commands = [
  // /casual setup
  new SlashCommandBuilder()
    .setName('casual')
    .setDescription('Casual lobby management commands')
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Spawn or link the persistent Casual Lobby Queue in a channel')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('The channel for casual queueing (defaults to current channel)')
            .addChannelTypes(ChannelType.GuildText)
        )
    ),

  // /tournament
  new SlashCommandBuilder()
    .setName('tournament')
    .setDescription("Once Upon a Galaxy Tournament management (Chekhov's Gum format)")
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new OUAG tournament (4 Swiss rounds + Top 6 Finals)')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Tournament name (e.g. Galaxy Championship #1)').setRequired(true)
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
    ),

  // /ouag-help
  new SlashCommandBuilder()
    .setName('ouag-help')
    .setDescription('Display guide for Casual Lobbies and Chekhov’s Gum Tournament format')
];

/**
 * Handles incoming Slash Command interactions.
 */
async function handleSlashCommand(interaction) {
  const { commandName, options, channel, member } = interaction;

  if (commandName === 'ouag-help') {
    return await interaction.reply({
      content:
        `✨ **Once Upon a Galaxy (OUAG) Discord Bot Guide** ✨\n\n` +
        `**1. Casual Lobbies Mode**:\n` +
        `• Set up with \`/casual setup [channel]\`.\n` +
        `• Continuous 6-player queue with **Join Queue**, **Leave**, **Submit Code** (4 alphanumeric chars), and **Start Match**.\n` +
        `• Starting a match hides the lobby and immediately starts a new queue for waiting players.\n\n` +
        `**2. Chekhov's Gum Tournament Format**:\n` +
        `• **Swiss Stage**: 4 Swiss Rounds with random seeding & balanced lobby sizes (Rule B.1 & B.2).\n` +
        `• **Swiss Scoring**: 1st=6, 2nd=4, 3rd=3, 4th=2, 5th=1, 6th=0 (ties split points).\n` +
        `• **Carry-Over Points**: 1st=4, 2nd=2 (banked for Finals & used as 1st tiebreaker).\n` +
        `• **Round 3 Cut**: Bottom third of players are eliminated after Round 3.\n` +
        `• **Finals Break**: 15-minute break after Round 4; Top 6 players advance.\n` +
        `• **Finals Win Condition**: Accumulate **20+ Finals Points** to become eligible, then finish **1st Place** in a Finals lobby to become Tournament Champion! 🏆`,
      flags: MessageFlags.Ephemeral
    });
  }

  // Ensure command is run inside a Discord server text channel
  if (!interaction.inGuild() || !interaction.guildId) {
    return await interaction.reply({
      content: '⚠️ This command can only be used inside a Discord server text channel, not in Direct Messages.',
      flags: MessageFlags.Ephemeral
    });
  }

  // Resiliently resolve full guild
  let guild = interaction.guild;
  if (!guild && interaction.guildId) {
    guild = await interaction.client.guilds.fetch(interaction.guildId).catch(() => null);
  }

  if (!guild) {
    return await interaction.reply({
      content: '❌ Could not retrieve server details. Please verify the bot is properly added to this server.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (commandName === 'casual') {
    const sub = options.getSubcommand(false) || 'setup';
    console.log(`[Casual Command] Subcommand: '${sub}', user: ${interaction.user.tag}`);

    if (sub === 'setup') {
      const hasPerms = 
        !interaction.memberPermissions ||
        interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) ||
        interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) ||
        interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
        guild.ownerId === interaction.user.id;

      if (!hasPerms) {
        return interaction.reply({ 
          content: '⚠️ You need `Manage Channels` or `Administrator` permission to set up casual lobbies.', 
          flags: MessageFlags.Ephemeral 
        });
      }

      const targetChannelOption = options.getChannel('channel');
      const targetChannelId = targetChannelOption ? targetChannelOption.id : (channel?.id || interaction.channelId);

      let targetChannel = targetChannelOption;
      if (!targetChannel || typeof targetChannel.send !== 'function') {
        targetChannel = await interaction.client.channels.fetch(targetChannelId).catch((err) => {
          console.error(`[Casual Setup] Error fetching channel ${targetChannelId}:`, err.message);
          return null;
        });
      }

      if (!targetChannel || typeof targetChannel.send !== 'function') {
        return await interaction.reply({
          content: `❌ Could not access text channel <#${targetChannelId}>. Ensure the bot has 'View Channel' and 'Send Messages' permissions.`,
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      console.log(`[Casual Setup] Initializing lobby in channel ${targetChannel.name || targetChannel.id}`);
      await casualManager.ensureActiveLobby(targetChannel, guild.id);
      return await interaction.editReply(`✅ Casual lobby queue dashboard successfully initialized in <#${targetChannel.id}>!`);
    }
  }

  if (commandName === 'tournament') {
    const sub = options.getSubcommand();

    if (sub === 'create') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '⚠️ You need `Manage Server` permission to create a tournament.', flags: MessageFlags.Ephemeral });
      }

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

      return interaction.reply({
        content: `✅ Tournament **"${name}"** created following Chekhov's Gum Rules! Registration is live above.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'cleanup') {
      const explicitId = options.getInteger('tournament_id');
      const deleteCategory = options.getBoolean('delete_category') || false;

      let targetTourney = null;
      if (explicitId) {
        targetTourney = await queries.getTournamentById(explicitId);
        if (!targetTourney) {
          return interaction.reply({
            content: `❌ Tournament with ID #${explicitId} was not found.`,
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

      if (!tournamentManager.isCoordinator(member, targetTourney, interaction)) {
        return interaction.reply({
          content: '⚠️ Only Coordinators can run tournament cleanup.',
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const summary = await channelManager.cleanupTournamentChannels(guild, targetTourney, { deleteCategory });

      return await interaction.editReply(
        `🧹 **Tournament Cleanup Complete** for **${targetTourney.name}** (ID #${targetTourney.id}):\n` +
        `• Deleted Pod/Issue Channels: **${summary.deletedChannels}**\n` +
        `• Deleted Threads: **${summary.deletedThreads}**` +
        (summary.deletedCategory ? `\n• Category channel deleted: **Yes**` : '')
      );
    }

    const activeTourney = await queries.getActiveTournament(guild.id);
    if (!activeTourney) {
      return interaction.reply({ content: '⚠️ No active tournament found in this server. Create one using `/tournament create`.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'start') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can start tournament rounds.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();
      try {
        const roundInfo = await tournamentManager.startRound(guild, activeTourney.id);
        const podDescriptions = roundInfo.pods.map(p => `Pod #${p.podNumber} (${p.size} players)`).join(', ');
        return await interaction.editReply(
          `⚔️ **Swiss Round ${roundInfo.roundNumber} has officially begun!**\n` +
          `Balanced Pods: ${podDescriptions}. Match rooms are open for players!`
        );
      } catch (err) {
        return await interaction.editReply(`❌ Error starting round: ${err.message}`);
      }
    }

    if (sub === 'next-round') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can advance rounds.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();
      try {
        const roundInfo = await tournamentManager.startRound(guild, activeTourney.id);
        const podDescriptions = roundInfo.pods.map(p => `Pod #${p.podNumber} (${p.size} players)`).join(', ');
        return await interaction.editReply(
          `⚔️ **Swiss Round ${roundInfo.roundNumber} is LIVE!**\n` +
          `Balanced Pods: ${podDescriptions}. Good luck to all players!`
        );
      } catch (err) {
        return await interaction.editReply(`❌ Could not advance to next round: ${err.message}`);
      }
    }

    if (sub === 'start-finals') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can start Grand Finals.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();
      try {
        const finalsInfo = await tournamentManager.startFinalsRound(guild, activeTourney.id);
        return await interaction.editReply(
          `🏆 **THE GRAND FINALS ARE UNDERWAY!**\n` +
          `Finals Lobby #${finalsInfo.finalsRoundNumber} room created. Good luck to the Top 6 Finalists!`
        );
      } catch (err) {
        return await interaction.editReply(`❌ Could not start Finals: ${err.message}`);
      }
    }

    if (sub === 'next-finals-round') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can launch Finals lobbies.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();
      try {
        const finalsInfo = await tournamentManager.startFinalsRound(guild, activeTourney.id);
        return await interaction.editReply(
          `🏆 **GRAND FINALS LOBBY #${finalsInfo.finalsRoundNumber} IS LIVE!**\n` +
          `Match room created. Players with 20+ Finals Points can win the Championship by finishing 1st!`
        );
      } catch (err) {
        return await interaction.editReply(`❌ Could not launch next Finals lobby: ${err.message}`);
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
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can execute cut lines.', flags: MessageFlags.Ephemeral });
      }
      const cutCount = options.getInteger('count');
      const eliminated = await queries.eliminateBottomThird(activeTourney.id, cutCount);
      return interaction.reply({
        content: `✅ Eliminated ${eliminated.length} players from the tournament according to Swiss standings.`
      });
    }

    if (sub === 'rule-stuck') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can issue stuck lobby rulings.', flags: MessageFlags.Ephemeral });
      }
      const podId = options.getInteger('pod_id');
      const p1 = options.getUser('player1');
      const p2 = options.getUser('player2');

      await interaction.deferReply();
      await tournamentManager.rulePodStuck(guild, podId, [p1.id, p2.id]);
      return await interaction.editReply(`⚖️ **Stuck Lobby Ruling Applied**: Pod #${podId} remaining players (<@${p1.id}>, <@${p2.id}>) awarded split 1st place points. Neither player may win tournament from this lobby.`);
    }

    if (sub === 'crash-replay') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can issue crash replay rulings.', flags: MessageFlags.Ephemeral });
      }
      const podId = options.getInteger('pod_id');
      await interaction.deferReply();
      await tournamentManager.voidPodReplay(guild, podId);
      return await interaction.editReply(`🔄 **Crash Replay Ruling Applied**: Pod #${podId} voided for replay. A new 4-character lobby code may be submitted.`);
    }

    if (sub === 'crash-two') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can issue crash rulings.', flags: MessageFlags.Ephemeral });
      }
      const podId = options.getInteger('pod_id');
      const p1 = options.getUser('player1');
      const p2 = options.getUser('player2');

      await interaction.deferReply();
      await tournamentManager.ruleCrashTwoPlayers(guild, podId, p1.id, p2.id);
      return await interaction.editReply(`⚖️ **Two Players Remaining Crash Ruling**: Pod #${podId} concluded with <@${p1.id}> and <@${p2.id}> tied for 1st & 2nd.`);
    }

    if (sub === 'add-player') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can manually add players.', flags: MessageFlags.Ephemeral });
      }
      const targetUser = options.getUser('player');
      await queries.registerParticipant(activeTourney.id, targetUser.id, targetUser.username);
      return interaction.reply({ content: `✅ Registered <@${targetUser.id}> for **${activeTourney.name}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'drop-player') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can drop players.', flags: MessageFlags.Ephemeral });
      }
      const targetUser = options.getUser('player');
      await queries.unregisterParticipant(activeTourney.id, targetUser.id);
      return interaction.reply({ content: `✅ Dropped <@${targetUser.id}> from **${activeTourney.name}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'add-bots') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can add test bot players.', flags: MessageFlags.Ephemeral });
      }
      const count = options.getInteger('count');
      if (count < 1 || count > 64) {
        return interaction.reply({ content: '⚠️ Please choose a count between 1 and 64.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const existing = await queries.getParticipants(activeTourney.id, false);
      const startNum = existing.filter(p => p.username.startsWith('Bot_')).length + 1;

      for (let i = 0; i < count; i++) {
        const botNum = startNum + i;
        const fakeId = `mock_bot_${Date.now()}_${botNum}`;
        const fakeUsername = `Bot_${botNum}`;
        await queries.registerParticipant(activeTourney.id, fakeId, fakeUsername);
      }

      const totalParticipants = await queries.getParticipants(activeTourney.id, true);

      return await interaction.editReply(
        `🤖 Added **${count} test bot players** to **${activeTourney.name}**! Total players: **${totalParticipants.length}**.\n` +
        `• Bots will never ping anyone.\n` +
        `• You can click **⚡ Simulate Pod** or **🛠️ Coordinator Override** in any match room to simulate matches instantly!`
      );
    }

    if (sub === 'cancel') {
      if (!tournamentManager.isCoordinator(member, activeTourney, interaction)) {
        return interaction.reply({ content: '⚠️ Only Coordinators can cancel the tournament.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const summary = await channelManager.cleanupTournamentChannels(guild, activeTourney, { deleteCategory: false });
      await queries.cancelTournament(activeTourney.id);
      return await interaction.editReply(
        `🗑️ Tournament **"${activeTourney.name}"** has been cancelled and removed from the active database.\n` +
        `• Cleaned up **${summary.deletedChannels}** channels and **${summary.deletedThreads}** threads.`
      );
    }
  }
}

module.exports = {
  commands,
  handleSlashCommand
};
