const { Client, GatewayIntentBits, REST, Routes, Events, MessageFlags } = require('discord.js');
const config = require('./config');
const db = require('./database/db');
const { commands, handleSlashCommand } = require('./commands/slashCommands');
const { handleCasualButton, handleCasualModal } = require('./interactions/casualHandlers');
const { handleTournamentButton, handleTournamentModal } = require('./interactions/tournamentHandlers');
const { startWebServer } = require('./web/server');
const { startReminderLoop } = require('./services/reminderService');

// Initialize Discord Client (only Guilds intent needed for Slash Commands, Buttons, and Modals)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// Slash Command Registration
async function registerCommands(clientId, token, guildId = null) {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('[Discord] Refreshing application slash commands...');
    const body = commands.map(c => c.toJSON());

    if (guildId) {
      // Instant development registration for a specific guild
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`[Discord] Registered ${commands.length} guild slash commands for guild: ${guildId}`);
    } else {
      // Global registration
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log(`[Discord] Registered ${commands.length} global application slash commands.`);

      // Clean up any stale guild-level commands from all joined guilds to prevent duplicate command listings in Discord UI
      for (const [gId] of client.guilds.cache) {
        try {
          const existingGuildCmds = await rest.get(Routes.applicationGuildCommands(clientId, gId)).catch(() => []);
          if (Array.isArray(existingGuildCmds) && existingGuildCmds.length > 0) {
            await rest.put(Routes.applicationGuildCommands(clientId, gId), { body: [] });
            console.log(`[Discord] Cleared ${existingGuildCmds.length} stale guild command(s) in guild ${gId} to avoid duplicates.`);
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('[Discord] Failed to register slash commands:', err);
  }
}

// Ready Event
client.once(Events.ClientReady, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 OUAG Discord Bot is online as ${client.user.tag}!`);
  console.log(`🎮 Game: Once Upon a Galaxy (OUAG)`);
  console.log(`🗄️ Database: ${config.USE_TIDB ? 'TiDB / MySQL' : 'Local SQLite'}`);
  console.log(`======================================================\n`);

  if (config.CLIENT_ID && config.DISCORD_TOKEN) {
    await registerCommands(config.CLIENT_ID, config.DISCORD_TOKEN, config.GUILD_ID);
  } else {
    console.warn('[Notice] DISCORD_TOKEN or CLIENT_ID missing in .env. Slash commands will register when configured.');
  }

  startReminderLoop(client);
});

// Interaction Event
client.on('interactionCreate', async (interaction) => {
  const name = interaction.commandName || interaction.customId || 'unknown';
  console.log(`[Interaction] Received '${name}' from ${interaction.user?.tag || interaction.user?.id} in guild ${interaction.guildId}`);
  try {
    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
      return await handleSlashCommand(interaction);
    }

    // 2. Buttons
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('casual_')) {
        return await handleCasualButton(interaction);
      }
      if (interaction.customId.startsWith('tourney_') || interaction.customId.startsWith('pod_') || interaction.customId.startsWith('issue_')) {
        return await handleTournamentButton(interaction);
      }
    }

    // 3. Modals
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('casual_modal_')) {
        return await handleCasualModal(interaction);
      }
      if (interaction.customId.startsWith('pod_modal_')) {
        return await handleTournamentModal(interaction);
      }
    }
  } catch (error) {
    console.error(`[Interaction Error] ${interaction.customId || interaction.commandName}:`, error);
    const reply = { content: '❌ An error occurred while executing this action.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply).catch(() => null);
    } else {
      await interaction.reply(reply).catch(() => null);
    }
  }
});

// Bootstrapping
async function start() {
  try {
    // Connect to database
    await db.initDb();

    // Start optional Web Dashboard & Public API server if WEB_PORT is set
    startWebServer(client);

    if (!config.DISCORD_TOKEN) {
      console.log('\n--------------------------------------------------------------');
      console.log('⚠️  No DISCORD_TOKEN provided in .env');
      console.log('👉 Create a .env file based on .env.example with your bot token to start.');
      console.log('--------------------------------------------------------------\n');
      return;
    }

    await client.login(config.DISCORD_TOKEN);
  } catch (err) {
    console.error('[Bot Startup Error]:', err);
    process.exit(1);
  }
}

// 24/7 Resilience Handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err);
});

start();
