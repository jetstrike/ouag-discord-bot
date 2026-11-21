const crypto = require('node:crypto');
const queries = require('../database/queries');
const config = require('../config');

/**
 * Builds a public-safe JSON snapshot of all running tournaments (omits Discord IDs and private lobby codes).
 */
async function buildPublicTournamentSnapshot() {
  const running = await queries.getAllRunningTournaments();
  const tournaments = [];

  for (const t of running) {
    const stage = t.stage === 'finals' ? 'finals' : 'swiss';
    const [standings, pods, podPlayers] = await Promise.all([
      queries.getStandings(t.id, stage),
      queries.getPodsForTournament(t.id),
      queries.getPodPlayersForTournament(t.id)
    ]);

    const playersByPod = new Map();
    for (const pp of podPlayers) {
      if (!playersByPod.has(pp.pod_id)) playersByPod.set(pp.pod_id, []);
      playersByPod.get(pp.pod_id).push({
        username: pp.username,
        placement: pp.placement,
        points_awarded: pp.points_awarded,
        carry_over_awarded: pp.carry_over_awarded,
        finals_points_awarded: pp.finals_points_awarded
      });
    }

    tournaments.push({
      id: t.id,
      name: t.name,
      status: t.status,
      stage: t.stage,
      current_round: t.current_round,
      total_rounds: t.total_rounds,
      finals_round_number: t.finals_round_number,
      created_at: t.created_at,
      standings: standings.map(s => ({
        username: s.username,
        points: s.points,
        carry_over_points: s.carry_over_points,
        finals_points: s.finals_points,
        is_eligible_to_win: Boolean(s.is_eligible_to_win),
        matches_played: s.matches_played,
        first_places: s.first_places,
        status: s.status
      })),
      pods: pods.map(p => ({
        id: p.id,
        round_number: p.round_number,
        is_finals: Boolean(p.is_finals),
        pod_number: p.pod_number,
        status: p.status,
        players: playersByPod.get(p.id) || []
      }))
    });
  }

  return {
    generated_at: new Date().toISOString(),
    tournaments
  };
}

/**
 * Computes HMAC-SHA256 signature header value for a webhook payload.
 */
function signPayload(bodyString, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
}

/**
 * Pushes the current public tournament snapshot to all configured webhook URLs.
 */
async function notifyWebhooks(eventName = 'tournament_update') {
  const urls = config.TOURNAMENT_WEBHOOK_URLS;
  if (!Array.isArray(urls) || urls.length === 0) return [];

  const snapshot = await buildPublicTournamentSnapshot();
  const body = JSON.stringify({ event: eventName, ...snapshot });

  const headers = {
    'Content-Type': 'application/json',
    'X-OUAG-Event': eventName
  };
  if (config.TOURNAMENT_WEBHOOK_SECRET) {
    headers['X-OUAG-Signature'] = signPayload(body, config.TOURNAMENT_WEBHOOK_SECRET);
  }

  const results = await Promise.allSettled(
    urls.map(url =>
      fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5000)
      })
    )
  );

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res.status === 'rejected') {
      console.warn(`[Webhooks] Failed POST to ${urls[i]}:`, res.reason?.message || res.reason);
    } else if (!res.value.ok) {
      console.warn(`[Webhooks] POST to ${urls[i]} returned HTTP ${res.value.status}`);
    }
  }

  return results;
}

module.exports = {
  buildPublicTournamentSnapshot,
  signPayload,
  notifyWebhooks
};
