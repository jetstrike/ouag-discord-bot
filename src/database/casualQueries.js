const db = require('./db');

async function getActiveCasualLobby(guildId, channelId) {
  return await db.get(
    `SELECT * FROM casual_lobbies 
     WHERE guild_id = ? AND channel_id = ? AND status IN ('waiting', 'ready') 
     ORDER BY id DESC LIMIT 1`,
    [guildId, channelId]
  );
}

async function getCasualLobbyById(id) {
  return await db.get(`SELECT * FROM casual_lobbies WHERE id = ?`, [id]);
}

async function getActiveCasualLobbiesForGuild(guildId) {
  return await db.all(
    `SELECT * FROM casual_lobbies WHERE guild_id = ? AND status IN ('waiting', 'ready') ORDER BY id DESC`,
    [guildId]
  );
}

async function createCasualLobby(guildId, channelId) {
  const result = await db.run(
    `INSERT INTO casual_lobbies (guild_id, channel_id, status) VALUES (?, ?, 'waiting')`,
    [guildId, channelId]
  );
  return result.insertId;
}

async function updateCasualLobbyMessage(lobbyId, messageId) {
  await db.run(`UPDATE casual_lobbies SET message_id = ? WHERE id = ?`, [messageId, lobbyId]);
}

async function addCasualPlayer(lobbyId, userId, username) {
  try {
    await db.run(
      `INSERT INTO casual_players (lobby_id, user_id, username) VALUES (?, ?, ?)`,
      [lobbyId, userId, username]
    );
    return true;
  } catch (err) {
    return false;
  }
}

async function removeCasualPlayer(lobbyId, userId) {
  const res = await db.run(
    `DELETE FROM casual_players WHERE lobby_id = ? AND user_id = ?`,
    [lobbyId, userId]
  );
  return res.changes > 0;
}

async function getCasualPlayers(lobbyId) {
  return await db.all(
    `SELECT * FROM casual_players WHERE lobby_id = ? ORDER BY joined_at ASC`,
    [lobbyId]
  );
}

async function setCasualLobbyCode(lobbyId, code, userId) {
  await db.run(
    `UPDATE casual_lobbies 
     SET lobby_code = ?, code_submitted_by = ?, status = CASE WHEN status = 'waiting' THEN 'ready' ELSE status END 
     WHERE id = ?`,
    [code, userId, lobbyId]
  );
}

async function markCasualLobbyStarted(lobbyId) {
  await db.run(
    `UPDATE casual_lobbies 
     SET status = 'started', started_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [lobbyId]
  );
}

async function claimCasualLobbyStart(lobbyId) {
  const res = await db.run(
    `UPDATE casual_lobbies 
     SET status = 'started', started_at = CURRENT_TIMESTAMP 
     WHERE id = ? AND status IN ('waiting', 'ready')`,
    [lobbyId]
  );
  return res.changes > 0;
}

module.exports = {
  getActiveCasualLobby,
  getCasualLobbyById,
  getActiveCasualLobbiesForGuild,
  createCasualLobby,
  updateCasualLobbyMessage,
  addCasualPlayer,
  removeCasualPlayer,
  getCasualPlayers,
  setCasualLobbyCode,
  markCasualLobbyStarted,
  claimCasualLobbyStart
};
