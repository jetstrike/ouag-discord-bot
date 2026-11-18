const { MessageFlags } = require('discord.js');
const queries = require('../database/queries');
const embeds = require('../utils/embeds');
const config = require('../config');

const lobbyLocks = new Map();

/**
 * Serializes concurrent operations per casual lobby to prevent >6 player join races.
 */
async function withLobbyLock(lobbyId, fn) {
  const prev = lobbyLocks.get(lobbyId) || Promise.resolve();
  let release;
  const next = new Promise(resolve => { release = resolve; });
  lobbyLocks.set(lobbyId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (lobbyLocks.get(lobbyId) === next) {
      lobbyLocks.delete(lobbyId);
    }
  }
}

/**
 * Ensures an active, visible casual queue lobby exists in the channel.
 */
async function ensureActiveLobby(channelInput, guildId = null) {
  let channel = channelInput;
  if (!channel || typeof channel.send !== 'function') {
    if (channelInput?.client) {
      channel = await channelInput.client.channels.fetch(channelInput.id).catch(() => null);
    }
  }

  if (!channel || typeof channel.send !== 'function') {
    throw new Error(`Could not resolve text channel ${channelInput?.id} to send messages.`);
  }

  const resolvedGuildId = guildId || channel.guildId || channel.guild?.id;
  let lobby = await queries.getActiveCasualLobby(resolvedGuildId, channel.id);

  if (lobby && lobby.message_id) {
    try {
      const msg = await channel.messages.fetch(lobby.message_id);
      if (msg) {
        const players = await queries.getCasualPlayers(lobby.id);
        const payload = embeds.createCasualQueueMessage(lobby, players);
        await msg.edit(payload);
        return { lobby, message: msg };
      }
    } catch (err) {
      console.log(`[CasualManager] Previous queue message missing; creating a new one.`);
    }
  }

  // Create new lobby in database
  const lobbyId = await queries.createCasualLobby(resolvedGuildId, channel.id);
  lobby = await queries.getCasualLobbyById(lobbyId);

  const payload = embeds.createCasualQueueMessage(lobby, []);
  const message = await channel.send(payload);

  await queries.updateCasualLobbyMessage(lobbyId, message.id);
  return { lobby, message };
}

/**
 * Player joins the casual queue.
 */
async function handleJoinQueue(interaction, lobbyId) {
  return await withLobbyLock(lobbyId, async () => {
    const lobby = await queries.getCasualLobbyById(lobbyId);
    if (!lobby || lobby.status === 'started' || lobby.status === 'completed') {
      return interaction.reply({ content: '⚠️ This lobby is no longer active.', flags: MessageFlags.Ephemeral });
    }

    const players = await queries.getCasualPlayers(lobbyId);
    if (players.length >= config.LOBBY_SIZE) {
      return interaction.reply({ content: '⚠️ This lobby is already full (6/6 players)!', flags: MessageFlags.Ephemeral });
    }

    const alreadyJoined = players.some(p => p.user_id === interaction.user.id);
    if (alreadyJoined) {
      return interaction.reply({ content: 'ℹ️ You are already in this lobby queue!', flags: MessageFlags.Ephemeral });
    }

    await queries.addCasualPlayer(lobbyId, interaction.user.id, interaction.user.username);
    const updatedPlayers = await queries.getCasualPlayers(lobbyId);

    // Update lobby embed
    const payload = embeds.createCasualQueueMessage(lobby, updatedPlayers);
    await interaction.update(payload);

    // If lobby just reached 6 players, send a brief alert
    if (updatedPlayers.length === config.LOBBY_SIZE) {
      const mentions = updatedPlayers.map(p => `<@${p.user_id}>`).join(' ');
      await interaction.channel.send({
        content: `🎉 **Lobby is full (6/6)!** ${mentions}\n` +
                 (lobby.lobby_code 
                   ? `🔑 Lobby Code is: **\`${lobby.lobby_code}\`**. Any player can now click **Start Match**!` 
                   : `Please have any player submit the 4-character OUAG game code!`)
      });
    }
  });
}

/**
 * Player leaves the casual queue.
 */
async function handleLeaveQueue(interaction, lobbyId) {
  const lobby = await queries.getCasualLobbyById(lobbyId);
  if (!lobby || lobby.status === 'started') {
    return interaction.reply({ content: '⚠️ This lobby is no longer active.', flags: MessageFlags.Ephemeral });
  }

  const removed = await queries.removeCasualPlayer(lobbyId, interaction.user.id);
  if (!removed) {
    return interaction.reply({ content: 'ℹ️ You are not in this lobby queue.', flags: MessageFlags.Ephemeral });
  }

  const updatedPlayers = await queries.getCasualPlayers(lobbyId);
  const payload = embeds.createCasualQueueMessage(lobby, updatedPlayers);
  await interaction.update(payload);
}

/**
 * Player submits a 4-character game code.
 */
async function handleSubmitCode(interaction, lobbyId, code) {
  const cleanCode = code.trim().toUpperCase();
  if (!config.LOBBY_CODE_REGEX.test(cleanCode)) {
    return interaction.reply({
      content: '❌ Invalid lobby code! OUAG game codes must be exactly 4 alphanumeric characters (e.g. `A7B2`).',
      flags: MessageFlags.Ephemeral
    });
  }

  const lobby = await queries.getCasualLobbyById(lobbyId);
  if (!lobby || lobby.status === 'started') {
    return interaction.reply({ content: '⚠️ This lobby is no longer active.', flags: MessageFlags.Ephemeral });
  }

  const players = await queries.getCasualPlayers(lobbyId);
  const isPlayerInLobby = players.some(p => p.user_id === interaction.user.id);
  if (!isPlayerInLobby && !interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({ content: '⚠️ You must be in the queue to submit the lobby code.', flags: MessageFlags.Ephemeral });
  }

  await queries.setCasualLobbyCode(lobbyId, cleanCode, interaction.user.id);
  const updatedLobby = await queries.getCasualLobbyById(lobbyId);
  const payload = embeds.createCasualQueueMessage(updatedLobby, players);

  // Edit original message
  try {
    const msg = await interaction.channel.messages.fetch(lobby.message_id);
    if (msg) await msg.edit(payload);
  } catch (err) {}

  await interaction.reply({
    content: `✅ Lobby code updated to **\`${cleanCode}\`** by <@${interaction.user.id}>! Anyone in the lobby can now start the match.`
  });
}

/**
 * Anyone in the lobby marks the match as started.
 * Hides/removes the queue message, announces match launch, and initializes a fresh queue.
 */
async function handleStartMatch(interaction, lobbyId) {
  const lobby = await queries.getCasualLobbyById(lobbyId);
  if (!lobby || lobby.status === 'started') {
    return interaction.reply({ content: '⚠️ This match has already started!', flags: MessageFlags.Ephemeral });
  }

  if (!lobby.lobby_code) {
    return interaction.reply({
      content: '⚠️ Please submit a 4-character lobby code before starting the match.',
      flags: MessageFlags.Ephemeral
    });
  }

  const players = await queries.getCasualPlayers(lobbyId);
  const isPlayerInLobby = players.some(p => p.user_id === interaction.user.id);
  if (!isPlayerInLobby && !interaction.memberPermissions?.has('Administrator')) {
    return interaction.reply({
      content: '⚠️ Only players in this lobby (or coordinators) can mark the match as started.',
      flags: MessageFlags.Ephemeral
    });
  }

  // Atomically claim match start so simultaneous clicks cannot double-launch
  const claimed = await queries.claimCasualLobbyStart(lobbyId);
  if (!claimed) {
    return interaction.reply({ content: '⚠️ This match has already started!', flags: MessageFlags.Ephemeral });
  }

  // Hide the queue message as requested
  try {
    if (interaction.message) {
      await interaction.message.delete().catch(() => null);
    }
  } catch (err) {
    console.warn('[CasualManager] Could not delete previous queue message:', err.message);
  }

  // Announce the match launch
  const playerMentions = players.map(p => `<@${p.user_id}>`).join(' ');
  await interaction.channel.send({
    content: `🚀 **Once Upon a Galaxy Match Started!**\n` +
             `🔑 **Lobby Code**: \`${lobby.lobby_code}\`\n` +
             `👥 **Players**: ${playerMentions || 'None'}\n` +
             `Have fun and good luck in the Galaxy!`
  });

  // Reply to interaction so Discord doesn't hang
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: 'Match started! Spawning new queue...', flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  // Continuous Queue: Spawns a brand new queue embed immediately
  await ensureActiveLobby(interaction.channel, interaction.guildId || interaction.guild?.id);
}

module.exports = {
  ensureActiveLobby,
  handleJoinQueue,
  handleLeaveQueue,
  handleSubmitCode,
  handleStartMatch
};
