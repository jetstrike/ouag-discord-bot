const db = require('./db');
const config = require('../config');

function parseTournamentRow(row) {
  if (row && typeof row.points_config === 'string') {
    try { row.points_config = JSON.parse(row.points_config); } catch (e) {}
  }
  return row;
}

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
  startTime = null,
  createdBy
}) {
  const result = await db.run(
    `INSERT INTO tournaments (
      guild_id, name, status, stage, current_round, total_rounds, finals_round_number,
      channel_mode, category_id, tournament_channel_id, results_channel_id,
      coordinator_role_id, points_config, start_time, created_by
    ) VALUES (?, ?, 'registration', 'registration', 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guildId, name, rounds, channelMode,
      categoryId || null, tournamentChannelId, resultsChannelId || null, coordinatorRoleId || null,
      JSON.stringify(pointsConfig), startTime || null, createdBy
    ]
  );
  return result.insertId;
}

async function getTournamentById(id) {
  return parseTournamentRow(await db.get(`SELECT * FROM tournaments WHERE id = ?`, [id]));
}

async function getActiveTournament(guildId) {
  const row = await db.get(
    `SELECT * FROM tournaments WHERE guild_id = ? AND status IN ('registration', 'in_progress') ORDER BY id DESC LIMIT 1`,
    [guildId]
  );
  return parseTournamentRow(row);
}

async function getRecentTournament(guildId) {
  const row = await db.get(
    `SELECT * FROM tournaments WHERE guild_id = ? ORDER BY id DESC LIMIT 1`,
    [guildId]
  );
  return parseTournamentRow(row);
}

async function getAllRunningTournaments() {
  const rows = await db.all(
    `SELECT * FROM tournaments WHERE status IN ('registration', 'in_progress') ORDER BY id DESC`
  );
  return rows.map(parseTournamentRow);
}

async function updateTournamentStatus(tournamentId, status) {
  await db.run(`UPDATE tournaments SET status = ? WHERE id = ?`, [status, tournamentId]);
}

async function updateTournamentStage(tournamentId, stage) {
  await db.run(`UPDATE tournaments SET stage = ? WHERE id = ?`, [stage, tournamentId]);
}

async function claimNextFinalsRound(tournamentId, expectedFinalsRound, nextFinalsRound) {
  const res = await db.run(
    `UPDATE tournaments SET finals_round_number = ?, status = 'in_progress', stage = 'finals' 
     WHERE id = ? AND finals_round_number = ?`,
    [nextFinalsRound, tournamentId, expectedFinalsRound]
  );
  return res.changes > 0;
}

async function getTournamentsPendingReminders() {
  const rows = await db.all(
    `SELECT * FROM tournaments
     WHERE status = 'registration' AND start_time IS NOT NULL AND (reminder_2h_sent = 0 OR reminder_15m_sent = 0)`
  );
  return rows.map(parseTournamentRow);
}

async function markReminderSent(tournamentId, type) {
  const col = type === '2h' ? 'reminder_2h_sent' : 'reminder_15m_sent';
  const res = await db.run(
    `UPDATE tournaments SET ${col} = 1 WHERE id = ? AND ${col} = 0`,
    [tournamentId]
  );
  return res.changes > 0;
}

async function registerParticipant(tournamentId, userId, username, checkedIn = 0) {
  const existing = await getParticipant(tournamentId, userId);
  if (existing) {
    const res = await db.run(
      `UPDATE tournament_participants SET status = 'registered', username = ?, checked_in = CASE WHEN ? = 1 THEN 1 ELSE checked_in END WHERE tournament_id = ? AND user_id = ?`,
      [username, checkedIn ? 1 : 0, tournamentId, userId]
    );
    return res.changes > 0;
  }

  await db.run(
    `INSERT INTO tournament_participants (tournament_id, user_id, username, checked_in, status) VALUES (?, ?, ?, ?, 'registered')`,
    [tournamentId, userId, username, checkedIn ? 1 : 0]
  );
  return true;
}

async function setParticipantCheckedIn(tournamentId, userId, checkedIn = 1) {
  const res = await db.run(
    `UPDATE tournament_participants SET checked_in = ? WHERE tournament_id = ? AND user_id = ? AND status = 'registered'`,
    [checkedIn ? 1 : 0, tournamentId, userId]
  );
  return res.changes > 0;
}

async function autoDropUnconfirmedParticipants(tournamentId) {
  const unconfirmed = await db.all(
    `SELECT user_id, username FROM tournament_participants
     WHERE tournament_id = ? AND status = 'registered' AND (checked_in = 0 OR checked_in IS NULL)`,
    [tournamentId]
  );
  if (unconfirmed.length > 0) {
    await db.run(
      `UPDATE tournament_participants SET status = 'auto_dropped'
       WHERE tournament_id = ? AND status = 'registered' AND (checked_in = 0 OR checked_in IS NULL)`,
      [tournamentId]
    );
  }
  return unconfirmed;
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

async function getRoundByTournamentAndNumber(tournamentId, roundNumber, isFinals = 0) {
  return await db.get(
    `SELECT * FROM tournament_rounds WHERE tournament_id = ? AND round_number = ? AND is_finals = ? ORDER BY id DESC LIMIT 1`,
    [tournamentId, roundNumber, isFinals ? 1 : 0]
  );
}

async function claimNextRound(tournamentId, expectedCurrentRound, nextRoundNumber) {
  const res = await db.run(
    `UPDATE tournaments SET current_round = ?, status = 'in_progress', stage = 'swiss' 
     WHERE id = ? AND current_round = ? AND stage != 'finals'`,
    [nextRoundNumber, tournamentId, expectedCurrentRound]
  );
  return res.changes > 0;
}

async function completeRound(roundId) {
  const res = await db.run(`UPDATE tournament_rounds SET status = 'completed' WHERE id = ? AND status != 'completed'`, [roundId]);
  return res.changes > 0;
}

async function reopenRound(roundId) {
  await db.run(`UPDATE tournament_rounds SET status = 'in_progress' WHERE id = ?`, [roundId]);
}

async function rollbackFailedRound(roundId, tournamentId, prevRoundNum, prevStage, prevStatus, isFinals) {
  if (roundId) {
    const pods = await getPodsForRound(roundId);
    for (const p of pods) {
      await db.run(`DELETE FROM tournament_pod_players WHERE pod_id = ?`, [p.id]);
    }
    await db.run(`DELETE FROM tournament_pods WHERE round_id = ?`, [roundId]);
    await db.run(`DELETE FROM tournament_rounds WHERE id = ?`, [roundId]);
  }
  if (isFinals) {
    await db.run(
      `UPDATE tournaments SET finals_round_number = ?, stage = ?, status = ? WHERE id = ?`,
      [prevRoundNum, prevStage, prevStatus, tournamentId]
    );
  } else {
    await db.run(
      `UPDATE tournaments SET current_round = ?, stage = ?, status = ? WHERE id = ?`,
      [prevRoundNum, prevStage, prevStatus, tournamentId]
    );
  }
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

async function getActivePodForPlayer(tournamentId, roundNumber, userId, isFinals = null) {
  if (isFinals !== null) {
    return await db.get(
      `SELECT p.* FROM tournament_pods p 
       JOIN tournament_rounds r ON p.round_id = r.id 
       JOIN tournament_pod_players pp ON p.id = pp.pod_id 
       WHERE p.tournament_id = ? AND r.round_number = ? AND r.is_finals = ? AND pp.user_id = ? AND p.status != 'completed'
       ORDER BY p.id DESC LIMIT 1`,
      [tournamentId, roundNumber, isFinals ? 1 : 0, userId]
    );
  }
  return await db.get(
    `SELECT p.* FROM tournament_pods p 
     JOIN tournament_rounds r ON p.round_id = r.id 
     JOIN tournament_pod_players pp ON p.id = pp.pod_id 
     WHERE p.tournament_id = ? AND r.round_number = ? AND pp.user_id = ? AND p.status != 'completed'
     ORDER BY p.id DESC LIMIT 1`,
    [tournamentId, roundNumber, userId]
  );
}

async function getPodById(podId) {
  return await db.get(`SELECT * FROM tournament_pods WHERE id = ?`, [podId]);
}

async function getPodsForRound(roundId) {
  return await db.all(`SELECT * FROM tournament_pods WHERE round_id = ? ORDER BY pod_number ASC`, [roundId]);
}

async function getPodsForTournament(tournamentId) {
  return await db.all(
    `SELECT p.*, r.round_number, r.is_finals
     FROM tournament_pods p
     JOIN tournament_rounds r ON p.round_id = r.id
     WHERE p.tournament_id = ?
     ORDER BY r.id DESC, p.pod_number ASC`,
    [tournamentId]
  );
}

async function getPodPlayersForTournament(tournamentId) {
  return await db.all(
    `SELECT * FROM tournament_pod_players WHERE tournament_id = ? ORDER BY pod_id ASC, placement ASC, username ASC`,
    [tournamentId]
  );
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

async function markPodStuck(podId) {
  const res = await db.run(
    `UPDATE tournament_pods SET status = 'stuck' WHERE id = ? AND status != 'completed'`,
    [podId]
  );
  return res.changes > 0;
}

async function setPodPlayerPlacement(podId, userId, placement, swissPts = 0, carryOverPts = 0, finalsPts = 0) {
  await db.run(
    `UPDATE tournament_pod_players 
     SET placement = ?, points_awarded = ?, carry_over_awarded = ?, finals_points_awarded = ?, reported_at = CURRENT_TIMESTAMP 
     WHERE pod_id = ? AND user_id = ?`,
    [placement, swissPts, carryOverPts, finalsPts, podId, userId]
  );
}

async function claimPodCompletion(podId) {
  const res = await db.run(
    `UPDATE tournament_pods SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'completed'`,
    [podId]
  );
  return res.changes > 0;
}

async function voidPodMatch(podId) {
  await db.run(`UPDATE tournament_pods SET status = 'waiting_code', lobby_code = NULL, completed_at = NULL WHERE id = ?`, [podId]);
  await db.run(`UPDATE tournament_pod_players SET placement = NULL, points_awarded = 0, carry_over_awarded = 0, finals_points_awarded = 0 WHERE pod_id = ?`, [podId]);
}

async function rollbackPodScores(podId, tournamentId, isFinals) {
  const players = await getPodPlayers(podId);
  for (const pp of players) {
    if (pp.placement === null) continue;
    const participant = await getParticipant(tournamentId, pp.user_id);
    if (!participant) continue;

    const newMatches = Math.max(0, (participant.matches_played || 0) - 1);
    const newFirsts = Math.max(0, (participant.first_places || 0) - (pp.placement === 1 ? 1 : 0));

    if (isFinals) {
      const newFinalsPts = Math.max(0, Math.round(((participant.finals_points || 0) - (pp.finals_points_awarded || 0)) * 100) / 100);
      const isEligible = newFinalsPts >= config.TOURNAMENT_RULES.FINALS_WIN_THRESHOLD ? 1 : 0;
      await db.run(
        `UPDATE tournament_participants
         SET finals_points = ?, is_eligible_to_win = ?, matches_played = ?, first_places = ?
         WHERE tournament_id = ? AND user_id = ?`,
        [newFinalsPts, isEligible, newMatches, newFirsts, tournamentId, pp.user_id]
      );
    } else {
      const newSwissPts = Math.max(0, Math.round(((participant.points || 0) - (pp.points_awarded || 0)) * 100) / 100);
      const newCarryPts = Math.max(0, Math.round(((participant.carry_over_points || 0) - (pp.carry_over_awarded || 0)) * 100) / 100);
      await db.run(
        `UPDATE tournament_participants
         SET points = ?, carry_over_points = ?, matches_played = ?, first_places = ?
         WHERE tournament_id = ? AND user_id = ?`,
        [newSwissPts, newCarryPts, newMatches, newFirsts, tournamentId, pp.user_id]
      );
    }
  }
  await voidPodMatch(podId);
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

  return await db.all(
    `SELECT user_id, username, points, carry_over_points, finals_points, is_eligible_to_win, matches_played, first_places, checked_in, status
     FROM tournament_participants
     WHERE tournament_id = ?
     ORDER BY points DESC, carry_over_points DESC, first_places DESC, username ASC`,
    [tournamentId]
  );
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
    `SELECT channel_id, user_id, created_at FROM tournament_issue_channels WHERE tournament_id = ? ORDER BY created_at DESC`,
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
  createTournament,
  getTournamentById,
  getActiveTournament,
  getRecentTournament,
  getAllRunningTournaments,
  getTournamentsPendingReminders,
  markReminderSent,
  updateTournamentStatus,
  updateTournamentStage,
  claimNextFinalsRound,
  registerParticipant,
  setParticipantCheckedIn,
  autoDropUnconfirmedParticipants,
  unregisterParticipant,
  getParticipants,
  getParticipant,
  eliminateBottomThird,
  initFinalsParticipants,
  getFinalists,
  createRound,
  getRoundById,
  getRoundByTournamentAndNumber,
  claimNextRound,
  completeRound,
  reopenRound,
  rollbackFailedRound,
  createPod,
  updatePodChannel,
  updatePodLeader,
  getActivePodForPlayer,
  getPodById,
  getPodsForRound,
  getPodsForTournament,
  addPodPlayer,
  getPodPlayers,
  getPodPlayersForTournament,
  updatePodCode,
  markPodStarted,
  markPodStuck,
  setPodPlayerPlacement,
  claimPodCompletion,
  voidPodMatch,
  rollbackPodScores,
  recordMatchup,
  getMatchupHistory,
  applySwissScores,
  applyFinalsScores,
  getStandings,
  cancelTournament,
  recordIssueChannel,
  getIssueChannels,
  deleteIssueChannel,
  getPodChannelIds
};
