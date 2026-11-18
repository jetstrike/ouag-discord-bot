const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const casualManager = require('../managers/casualManager');

const builder = new SlashCommandBuilder()
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
  );

async function handle(interaction, guild) {
  const { options, channel } = interaction;
  const sub = options.getSubcommand(false) || 'setup';

  if (sub === 'setup') {
    const hasPerms =
      Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
      ) ||
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
    await casualManager.ensureActiveLobby(targetChannel, guild.id);
    return await interaction.editReply(`✅ Casual lobby queue dashboard successfully initialized in <#${targetChannel.id}>!`);
  }
}

module.exports = { builder, handle };
