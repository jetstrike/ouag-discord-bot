const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const casualCommand = require('./casual');
const tournamentCommand = require('./tournament');

const helpBuilder = new SlashCommandBuilder()
  .setName('ouag-help')
  .setDescription('Display guide for Casual Lobbies and Chekhov’s Gum Tournament format');

const commands = [
  casualCommand.builder,
  tournamentCommand.builder,
  helpBuilder
];

async function handleSlashCommand(interaction) {
  const { commandName } = interaction;

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

  if (!interaction.inGuild() || !interaction.guildId) {
    return await interaction.reply({
      content: '⚠️ This command can only be used inside a Discord server text channel, not in Direct Messages.',
      flags: MessageFlags.Ephemeral
    });
  }

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
    return await casualCommand.handle(interaction, guild);
  }

  if (commandName === 'tournament') {
    return await tournamentCommand.handle(interaction, guild);
  }
}

module.exports = {
  commands,
  handleSlashCommand
};
