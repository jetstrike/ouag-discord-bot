const db = require('./db');
const config = require('../config');

// --- Casual Lobbies ---

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

// --- Tournaments ---

async function createTournament({ 
  guildId, 
  name, 
  rounds = config.TOURNAMENT_RULES.SWISS_ROUNDS, 
  channelMode, 
  categoryId, 
  tournamentChannelId, 
  resultsChannelId, 
  coordinatorRoleId, 
  pointsConfig = config.TOURNAMENT_RULES.SWISS_POINTS, 
  createdBy 
}) {
  const result = await db.run(
    `INSERT INTO tournaments (
      guild_id, name, status, stage, current_round, total_rounds, finals_round_number,
      channel_mode, category_id, tournament_channel_id, results_channel_id,
      coordinator_role_id, points_config, created_by
    ) VALUES (?, ?, 'registration', 'registration', 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guildId, name, rounds, channelMode,
      categoryId || null, tournamentChannelId, resultsChannelId || null, coordinatorRoleId || null,
      JSON.stringify(pointsConfig), createdBy
    ]
  );
  return result.insertId;
}

async function getTournamentById(id) {
  const row = await db.get(`SELECT * FROM tournaments WHERE id = ?`, [id]);
  if (row && typeof row.points_config === 'string') {
    try { row.points_config = JSON.parse(row.points_config); } catch (e) {}
  }
  return row;
}

async function getActiveTournament(guildId) {
  const row = await db.get(
    `SELECT * FROM tournaments WHERE guild_id = ? AND status IN ('registration', 'in_progress') ORDER BY id DESC LIMIT 1`,
    [guildId]
  );
  if (row && typeof row.points_config === 'string') {
    try { row.points_config = JSON.parse(row.points_config); } catch (e) {}
  }
  return row;
}

async function updateTournamentStatus(tournamentId, status) {
  await db.run(`UPDATE tournaments SET status = ? WHERE id = ?`, [status, tournamentId]);
}

async function updateTournamentStage(tournamentId, stage) {
  await db.run(`UPDATE tournaments SET stage = ? WHERE id = ?`, [stage, tournamentId]);
}

async function updateTournamentCurrentRound(tournamentId, roundNum) {
  await db.run(`UPDATE tournaments SET current_round = ? WHERE id = ?`, [roundNum, tournamentId]);
}

async function incrementFinalsRound(tournamentId) {
  await db.run(`UPDATE tournaments SET finals_round_number = finals_round_number + 1 WHERE id = ?`, [tournamentId]);
  const row = await db.get(`SELECT finals_round_number FROM tournaments WHERE id = ?`, [tournamentId]);
  return row ? row.finals_round_number : 1;
}

async function updateTournamentPoints(tournamentId, pointsArray) {
  await db.run(
    `UPDATE tournaments SET points_config = ? WHERE id = ?`,
    [JSON.stringify(pointsArray), tournamentId]
  );
}

async function registerParticipant(tournamentId, userId, username) {
  try {
    await db.run(
      `INSERT INTO tournament_participants (tournament_id, user_id, username, status) VALUES (?, ?, ?, 'registered')`,
      [tournamentId, userId, username]
    );
    return true;
  } catch (err) {
    const res = await db.run(
      `UPDATE tournament_participants SET status = 'registered', username = ? WHERE tournament_id = ? AND user_id = ?`,
      [username, tournamentId, userId]
    );
    return res.changes > 0;
  }
}

async function unregisterParticipant(tournamentId, userId) {
  const res = await db.run(
    `UPDATE tournament_participants SET status = 'dropped' WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId]
  );
  return res.changes > 0;
}

async function getParticipants(tournamentId, onlyActive = true) {
  if (onlyActive) {
    return await db.all(
      `SELECT * FROM tournament_participants 
       WHERE tournament_id = ? AND status IN ('registered', 'finalist') 
       ORDER BY points DESC, carry_over_points DESC, first_places DESC, username ASC`,
      [tournamentId]
    );
  }
  return await db.all(
    `SELECT * FROM tournament_participants 
     WHERE tournament_id = ? 
     ORDER BY points DESC, carry_over_points DESC, first_places DESC, username ASC`,
    [tournamentId]
  );
}

async function getParticipant(tournamentId, userId) {
  return await db.get(
    `SELECT * FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId]
  );
}

async function eliminateBottomThird(tournamentId, cutCount) {
  // Get the bottom N active players by Swiss points ascending
  const bottomPlayers = await db.all(
    `SELECT user_id FROM tournament_participants 
     WHERE tournament_id = ? AND status = 'registered' 
     ORDER BY points ASC, carry_over_points ASC, username DESC 
     LIMIT ?`,
    [tournamentId, cutCount]
  );

  const eliminatedIds = bottomPlayers.map(p => p.user_id);
  for (const id of eliminatedIds) {
    await db.run(
      `UPDATE tournament_participants SET status = 'eliminated_cut' WHERE tournament_id = ? AND user_id = ?`,
      [tournamentId, id]
    );
  }
  return eliminatedIds;
}

async function initFinalsParticipants(tournamentId, finalistIds) {
  // Mark all finalistIds as 'finalist' and copy their carry_over_points into starting finals_points
  for (const userId of finalistIds) {
    const p = await getParticipant(tournamentId, userId);
    const startPts = p ? p.carry_over_points : 0.0;
    const isLive = startPts >= config.TOURNAMENT_RULES.FINALS_WIN_THRESHOLD ? 1 : 0;
    await db.run(
      `UPDATE tournament_participants 
       SET status = 'finalist', finals_points = ?, is_eligible_to_win = ? 
       WHERE tournament_id = ? AND user_id = ?`,
      [startPts, isLive, tournamentId, userId]
    );
  }
}

async function getFinalists(tournamentId) {
  return await db.all(
    `SELECT * FROM tournament_participants 
     WHERE tournament_id = ? AND status = 'finalist' 
     ORDER BY finals_points DESC, carry_over_points DESC, first_places DESC`,
    [tournamentId]
  );
}

async function createRound(tournamentId, roundNumber, isFinals = 0) {
  const res = await db.run(
    `INSERT INTO tournament_rounds (tournament_id, round_number, is_finals, status) VALUES (?, ?, ?, 'in_progress')`,
    [tournamentId, roundNumber, isFinals ? 1 : 0]
  );
  return res.insertId;
}

async function getRoundById(roundId) {
  return await db.get(`SELECT * FROM tournament_rounds WHERE id = ?`, [roundId]);
}

async function completeRound(roundId) {
  await db.run(`UPDATE tournament_rounds SET status = 'completed' WHERE id = ?`, [roundId]);
}

async function createPod(roundId, tournamentId, podNumber, leaderUserId) {
  const res = await db.run(
    `INSERT INTO tournament_pods (round_id, tournament_id, pod_number, leader_user_id, status) VALUES (?, ?, ?, ?, 'waiting_code')`,
    [roundId, tournamentId, podNumber, leaderUserId]
  );
  return res.insertId;
}

async function updatePodChannel(podId, channelId, messageId) {
  await db.run(
    `UPDATE tournament_pods SET channel_id = ?, message_id = ? WHERE id = ?`,
    [channelId, messageId, podId]
  );
}

async function updatePodLeader(podId, leaderUserId) {
  await db.run(`UPDATE tournament_pods SET leader_user_id = ? WHERE id = ?`, [leaderUserId, podId]);
}

async function getActivePodForPlayer(tournamentId, roundNumber, userId) {
  return await db.get(
    `SELECT p.* FROM tournament_pods p 
     JOIN tournament_rounds r ON p.round_id = r.id 
     JOIN tournament_pod_players pp ON p.id = pp.pod_id 
     WHERE p.tournament_id = ? AND r.round_number = ? AND pp.user_id = ?`,
    [tournamentId, roundNumber, userId]
  );
}

async function getPodById(podId) {
  return await db.get(`SELECT * FROM tournament_pods WHERE id = ?`, [podId]);
}

async function getPodsForRound(roundId) {
  return await db.all(`SELECT * FROM tournament_pods WHERE round_id = ? ORDER BY pod_number ASC`, [roundId]);
}

async function addPodPlayer(podId, tournamentId, userId, username) {
  await db.run(
    `INSERT INTO tournament_pod_players (pod_id, tournament_id, user_id, username) VALUES (?, ?, ?, ?)`,
    [podId, tournamentId, userId, username]
  );
}

async function getPodPlayers(podId) {
  return await db.all(
    `SELECT * FROM tournament_pod_players WHERE pod_id = ? ORDER BY placement ASC, username ASC`,
    [podId]
  );
}

async function updatePodCode(podId, code) {
  await db.run(
    `UPDATE tournament_pods SET lobby_code = ?, status = 'ready' WHERE id = ?`,
    [code, podId]
  );
}

async function markPodStarted(podId) {
  await db.run(
    `UPDATE tournament_pods SET status = 'started', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [podId]
  );
}

async function setPodPlayerPlacement(podId, userId, placement, swissPts = 0, carryOverPts = 0, finalsPts = 0) {
  await db.run(
    `UPDATE tournament_pod_players 
     SET placement = ?, points_awarded = ?, carry_over_awarded = ?, finals_points_awarded = ?, reported_at = CURRENT_TIMESTAMP 
     WHERE pod_id = ? AND user_id = ?`,
    [placement, swissPts, carryOverPts, finalsPts, podId, userId]
  );
}

async function markPodCompleted(podId) {
  await db.run(
    `UPDATE tournament_pods SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [podId]
  );
}

async function voidPodMatch(podId) {
  await db.run(`UPDATE tournament_pods SET status = 'waiting_code', lobby_code = NULL WHERE id = ?`, [podId]);
  await db.run(`UPDATE tournament_pod_players SET placement = NULL, points_awarded = 0, carry_over_awarded = 0, finals_points_awarded = 0 WHERE pod_id = ?`, [podId]);
}

async function recordMatchup(tournamentId, p1, p2, roundNumber) {
  const [a, b] = p1 < p2 ? [p1, p2] : [p2, p1];
  await db.run(
    `INSERT INTO tournament_matchups (tournament_id, player_a_id, player_b_id, round_number) VALUES (?, ?, ?, ?)`,
    [tournamentId, a, b, roundNumber]
  );
}

async function getMatchupHistory(tournamentId) {
  return await db.all(`SELECT * FROM tournament_matchups WHERE tournament_id = ?`, [tournamentId]);
}

async function applySwissScores(tournamentId, userId, swissPts, carryOverPts, isFirstPlace) {
  await db.run(
    `UPDATE tournament_participants 
     SET points = points + ?, 
         carry_over_points = carry_over_points + ?, 
         matches_played = matches_played + 1, 
         first_places = first_places + ? 
     WHERE tournament_id = ? AND user_id = ?`,
    [swissPts, carryOverPts, isFirstPlace ? 1 : 0, tournamentId, userId]
  );
}

async function applyFinalsScores(tournamentId, userId, finalsPts, isFirstPlace) {
  await db.run(
    `UPDATE tournament_participants 
     SET finals_points = finals_points + ?, 
         matches_played = matches_played + 1, 
         first_places = first_places + ? 
     WHERE tournament_id = ? AND user_id = ?`,
    [finalsPts, isFirstPlace ? 1 : 0, tournamentId, userId]
  );

  // Check if player has crossed the 20 finals points threshold
  const p = await getParticipant(tournamentId, userId);
  if (p && p.finals_points >= config.TOURNAMENT_RULES.FINALS_WIN_THRESHOLD) {
    await db.run(
      `UPDATE tournament_participants SET is_eligible_to_win = 1 WHERE tournament_id = ? AND user_id = ?`,
      [tournamentId, userId]
    );
  }
}

async function getStandings(tournamentId, stage = 'swiss') {
  if (stage === 'finals') {
    return await db.all(
      `SELECT user_id, username, points, carry_over_points, finals_points, is_eligible_to_win, matches_played, first_places, status
       FROM tournament_participants
       WHERE tournament_id = ? AND status = 'finalist'
       ORDER BY finals_points DESC, carry_over_points DESC, first_places DESC, username ASC`,
      [tournamentId]
    );
  }

  // Swiss stage: Rank by Swiss Points, then Carry-Over Points (D.3 1st tiebreaker), then 1st places
  return await db.all(
    `SELECT user_id, username, points, carry_over_points, finals_points, is_eligible_to_win, matches_played, first_places, status
     FROM tournament_participants
     WHERE tournament_id = ?
     ORDER BY points DESC, carry_over_points DESC, first_places DESC, username ASC`,
    [tournamentId]
  );
}

async function getRecentTournament(guildId) {
  const row = await db.get(
    `SELECT * FROM tournaments WHERE guild_id = ? ORDER BY id DESC LIMIT 1`,
    [guildId]
  );
  if (row && typeof row.points_config === 'string') {
    try { row.points_config = JSON.parse(row.points_config); } catch (e) {}
  }
  return row;
}

async function recordIssueChannel(tournamentId, channelId, userId) {
  try {
    await db.run(
      `INSERT INTO tournament_issue_channels (tournament_id, channel_id, user_id) VALUES (?, ?, ?)`,
      [tournamentId, channelId, userId]
    );
  } catch (e) {}
}

async function getIssueChannels(tournamentId) {
  return await db.all(
    `SELECT channel_id FROM tournament_issue_channels WHERE tournament_id = ?`,
    [tournamentId]
  );
}

async function deleteIssueChannel(channelId) {
  await db.run(
    `DELETE FROM tournament_issue_channels WHERE channel_id = ?`,
    [channelId]
  );
}

async function getPodChannelIds(tournamentId) {
  return await db.all(
    `SELECT DISTINCT channel_id FROM tournament_pods WHERE tournament_id = ? AND channel_id IS NOT NULL`,
    [tournamentId]
  );
}

async function cancelTournament(tournamentId) {
  await db.run(`DELETE FROM tournament_issue_channels WHERE tournament_id = ?`, [tournamentId]);
  await db.run(`DELETE FROM tournament_pod_players WHERE tournament_id = ?`, [tournamentId]);
  await db.run(`DELETE FROM tournament_pods WHERE tournament_id = ?`, [tournamentId]);
  await db.run(`DELETE FROM tournament_rounds WHERE tournament_id = ?`, [tournamentId]);
  await db.run(`DELETE FROM tournament_matchups WHERE tournament_id = ?`, [tournamentId]);
  await db.run(`DELETE FROM tournament_participants WHERE tournament_id = ?`, [tournamentId]);
  await db.run(`DELETE FROM tournaments WHERE id = ?`, [tournamentId]);
}

module.exports = {
  // Casual
  getActiveCasualLobby,
  getCasualLobbyById,
  createCasualLobby,
  updateCasualLobbyMessage,
  addCasualPlayer,
  removeCasualPlayer,
  getCasualPlayers,
  setCasualLobbyCode,
  markCasualLobbyStarted,

  // Tournament
  createTournament,
  getTournamentById,
  getActiveTournament,
  updateTournamentStatus,
  updateTournamentStage,
  updateTournamentCurrentRound,
  incrementFinalsRound,
  updateTournamentPoints,
  registerParticipant,
  unregisterParticipant,
  getParticipants,
  getParticipant,
  eliminateBottomThird,
  initFinalsParticipants,
  getFinalists,
  createRound,
  getRoundById,
  completeRound,
  createPod,
  updatePodChannel,
  updatePodLeader,
  getActivePodForPlayer,
  getPodById,
  getPodsForRound,
  addPodPlayer,
  getPodPlayers,
  updatePodCode,
  markPodStarted,
  setPodPlayerPlacement,
  markPodCompleted,
  voidPodMatch,
  recordMatchup,
  getMatchupHistory,
  applySwissScores,
  applyFinalsScores,
  getStandings,
  cancelTournament,
  getRecentTournament,
  recordIssueChannel,
  getIssueChannels,
  deleteIssueChannel,
  getPodChannelIds
};
