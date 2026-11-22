const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const queries = require('../database/queries');
const roundManager = require('../managers/roundManager');
const podManager = require('../managers/podManager');
const channelManager = require('../managers/channelManager');
const { isCoordinator } = require('../utils/permissions');
const webhookService = require('../services/webhookService');
const { renderDashboardHtml } = require('./dashboardHtml');
const config = require('../config');

const SESSION_COOKIE = 'ouag_session';
const STATE_COOKIE = 'ouag_oauth_state';
const MAX_BODY_BYTES = 64 * 1024;
const memberCache = new Map();
const MEMBER_CACHE_TTL_MS = 60 * 1000;

function signToken(payloadObj, secret) {
  const data = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function getGuildMemberCached(guild, userId) {
  const cachedInDjs = guild.members?.cache?.get(userId);
  if (cachedInDjs) return cachedInDjs;

  const key = `${guild.id}:${userId}`;
  const entry = memberCache.get(key);
  if (entry && Date.now() < entry.exp) return entry.member;

  const member = await guild.members.fetch(userId).catch(() => null);
  memberCache.set(key, { member, exp: Date.now() + MEMBER_CACHE_TTL_MS });
  return member;
}

async function getAuthorizedGuilds(client, userId) {
  const authorized = [];
  if (!client?.guilds?.cache) return authorized;

  for (const guild of client.guilds.cache.values()) {
    const activeTourney = await queries.getActiveTournament(guild.id);
    const tourney = activeTourney || await queries.getRecentTournament(guild.id);
    if (guild.ownerId === userId) {
      authorized.push({ guild, tourney });
      continue;
    }
    const member = await getGuildMemberCached(guild, userId);
    if (member && isCoordinator(member, tourney)) {
      authorized.push({ guild, tourney });
    }
  }
  return authorized;
}

function createWebServer(client) {
  const sessionSecret = config.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const oauthConfigured = Boolean(config.CLIENT_ID && config.DISCORD_CLIENT_SECRET && config.OAUTH_REDIRECT_URI);
  const secureFlag = config.OAUTH_REDIRECT_URI.startsWith('https://') ? '; Secure' : '';

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const cookies = parseCookies(req);

      // 1. Public Read-Only Snapshot Endpoint
      if (req.method === 'GET' && path === '/api/public/tournaments') {
        const snapshot = await webhookService.buildPublicTournamentSnapshot();
        return sendJson(res, 200, snapshot, { 'Access-Control-Allow-Origin': '*' });
      }

      // 2. Dashboard HTML
      if (req.method === 'GET' && path === '/') {
        const html = renderDashboardHtml({ oauthConfigured });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      // 3. Discord OAuth2 Login / Callback / Logout
      if (req.method === 'GET' && path === '/auth/login') {
        if (!oauthConfigured) {
          return sendJson(res, 503, { error: 'Discord OAuth2 is not configured.' });
        }
        const stateVal = crypto.randomBytes(16).toString('hex');
        const stateCookie = signToken({ state: stateVal, exp: Date.now() + 10 * 60 * 1000 }, sessionSecret);
        const authUrl = new URL('https://discord.com/oauth2/authorize');
        authUrl.searchParams.set('client_id', config.CLIENT_ID);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', config.OAUTH_REDIRECT_URI);
        authUrl.searchParams.set('scope', 'identify');
        authUrl.searchParams.set('state', stateVal);

        res.writeHead(302, {
          Location: authUrl.toString(),
          'Set-Cookie': `${STATE_COOKIE}=${encodeURIComponent(stateCookie)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secureFlag}`
        });
        return res.end();
      }

      if (req.method === 'GET' && path === '/auth/callback') {
        if (!oauthConfigured) return sendJson(res, 503, { error: 'Discord OAuth2 is not configured.' });
        const code = url.searchParams.get('code');
        const stateParam = url.searchParams.get('state');
        const stateToken = verifyToken(cookies[STATE_COOKIE], sessionSecret);
        if (!code || !stateToken || stateToken.state !== stateParam) {
          return sendJson(res, 400, { error: 'Invalid OAuth2 state or missing code.' });
        }

        const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.CLIENT_ID,
            client_secret: config.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.OAUTH_REDIRECT_URI
          })
        });
        if (!tokenRes.ok) return sendJson(res, 401, { error: 'Discord token exchange failed.' });
        const tokenData = await tokenRes.json();

        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        if (!userRes.ok) return sendJson(res, 401, { error: 'Failed to fetch Discord profile.' });
        const user = await userRes.json();

        const sessionCookie = signToken({
          userId: user.id,
          username: user.username,
          exp: Date.now() + 24 * 60 * 60 * 1000
        }, sessionSecret);

        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': [
            `${SESSION_COOKIE}=${encodeURIComponent(sessionCookie)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secureFlag}`,
            `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`
          ]
        });
        return res.end();
      }

      if (req.method === 'POST' && path === '/auth/logout') {
        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`
        });
        return res.end();
      }

      // 4. Protected Admin Endpoints
      const session = verifyToken(cookies[SESSION_COOKIE], sessionSecret);
      if (!session) {
        return sendJson(res, 401, { error: 'Authentication required.' });
      }

      const authorizedGuilds = await getAuthorizedGuilds(client, session.userId);

      if (req.method === 'GET' && path === '/api/admin/overview') {
        const guildsPayload = [];
        for (const { guild, tourney } of authorizedGuilds) {
          let standings = [];
          let pods = [];
          let issueChannels = [];
          if (tourney) {
            const stage = tourney.stage === 'finals' ? 'finals' : 'swiss';
            const [st, rawPods, podPlayers, issues] = await Promise.all([
              queries.getStandings(tourney.id, stage),
              queries.getPodsForTournament(tourney.id),
              queries.getPodPlayersForTournament(tourney.id),
              queries.getIssueChannels(tourney.id)
            ]);
            standings = st;
            const nameByUserId = new Map(st.map(s => [s.user_id, s.username]));
            issueChannels = issues.map(c => ({
              ...c,
              username: nameByUserId.get(c.user_id) || c.user_id,
              channel_name: guild.channels?.cache?.get(c.channel_id)?.name || null,
              discord_url: `https://discord.com/channels/${guild.id}/${c.channel_id}`
            }));
            const byPod = new Map();
            for (const pp of podPlayers) {
              if (!byPod.has(pp.pod_id)) byPod.set(pp.pod_id, []);
              byPod.get(pp.pod_id).push(pp);
            }
            pods = rawPods.map(p => ({ ...p, players: byPod.get(p.id) || [] }));
          }

          const rawCasuals = await queries.getActiveCasualLobbiesForGuild(guild.id);
          const casualLobbies = [];
          for (const l of rawCasuals) {
            casualLobbies.push({ ...l, players: await queries.getCasualPlayers(l.id) });
          }

          guildsPayload.push({
            id: guild.id,
            name: guild.name,
            tournament: tourney || null,
            standings,
            pods,
            issueChannels,
            casualLobbies
          });
        }

        return sendJson(res, 200, {
          user: { id: session.userId, username: session.username },
          guilds: guildsPayload
        });
      }

      if (req.method === 'POST' && path === '/api/admin/action') {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('application/json')) {
          return sendJson(res, 415, { error: 'Content-Type must be application/json.' });
        }
        if (req.headers.origin) {
          let originHost = '';
          try { originHost = new URL(req.headers.origin).host; } catch (e) {}
          if (originHost !== req.headers.host) {
            return sendJson(res, 403, { error: 'Cross-origin request rejected.' });
          }
        }
        const body = await readJsonBody(req);
        const target = authorizedGuilds.find(g => g.guild.id === body.guildId);
        if (!target) {
          return sendJson(res, 403, { error: 'You do not have coordinator access to this server.' });
        }
        const { guild, tourney } = target;
        if (!tourney) {
          return sendJson(res, 404, { error: 'No tournament found for this server.' });
        }

        const action = body.action;
        if (action === 'start_round') {
          const info = await roundManager.startRound(guild, tourney.id);
          return sendJson(res, 200, { message: `Swiss Round ${info.roundNumber} started (${info.pods.length} pods).` });
        }
        if (action === 'start_finals') {
          const info = await roundManager.startFinalsRound(guild, tourney.id);
          return sendJson(res, 200, { message: `Finals Lobby #${info.finalsRoundNumber} started.` });
        }
        if (action === 'cancel_tournament') {
          const confirmName = String(body.confirmName || '').trim();
          if (confirmName !== tourney.name) {
            return sendJson(res, 400, { error: `Type "${tourney.name}" exactly to confirm cancellation.` });
          }
          const summary = await channelManager.cleanupTournamentChannels(guild, tourney, { deleteCategory: false });
          await queries.cancelTournament(tourney.id);
          webhookService.notifyWebhooks('tournament_cancelled').catch(() => null);
          return sendJson(res, 200, {
            message: `Tournament "${tourney.name}" cancelled (${summary.deletedChannels} channels, ${summary.deletedThreads} threads cleaned up).`
          });
        }
        if (action === 'drop_player') {
          await podManager.handlePlayerDrop(guild, tourney, String(body.userId || ''));
          return sendJson(res, 200, { message: 'Player dropped from tournament.' });
        }

        // Pod-scoped actions
        const podId = parseInt(body.podId, 10);
        const pod = await queries.getPodById(podId);
        if (!pod || pod.tournament_id !== tourney.id) {
          return sendJson(res, 404, { error: `Pod #${podId} does not belong to ${tourney.name}.` });
        }

        if (action === 'override_pod') {
          let ranks;
          if (body.placementsByUserId && typeof body.placementsByUserId === 'object') {
            const podPlayers = await queries.getPodPlayers(podId);
            ranks = podPlayers.map(p => Number(body.placementsByUserId[p.user_id]));
          } else {
            ranks = String(body.placements || '').trim().split(/\s+/).map(Number);
          }
          await podManager.overridePodPlacements(guild, podId, ranks);
          return sendJson(res, 200, { message: `Pod #${pod.pod_number} placements overridden.` });
        }

        if (action === 'restart_pod') {
          await podManager.restartPod(guild, podId);
          return sendJson(res, 200, { message: `Pod #${pod.pod_number} restarted.` });
        }

        if (action === 'rule_stuck') {
          await podManager.rulePodStuck(guild, podId, [String(body.player1Id), String(body.player2Id)]);
          return sendJson(res, 200, { message: `Pod #${pod.pod_number} ruled stuck.` });
        }
        if (action === 'crash_replay') {
          await podManager.voidPodReplay(guild, podId);
          return sendJson(res, 200, { message: `Pod #${pod.pod_number} voided for replay.` });
        }
        if (action === 'crash_two') {
          await podManager.ruleCrashTwoPlayers(guild, podId, String(body.player1Id), String(body.player2Id));
          return sendJson(res, 200, { message: `Pod #${pod.pod_number} ruled 2-player crash tie.` });
        }

        return sendJson(res, 400, { error: `Unknown action: ${action}` });
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('[WebServer Error]:', err);
      if (!res.headersSent) {
        return sendJson(res, 500, { error: err.message || 'Internal server error' });
      }
    }
  });
}

function startWebServer(client, port = config.WEB_PORT) {
  if (!port || port <= 0) return null;
  const server = createWebServer(client);
  server.listen(port, () => {
    console.log(`🌐 Web server listening on http://localhost:${port} (Public API: /api/public/tournaments)`);
  });
  return server;
}

module.exports = {
  createWebServer,
  startWebServer,
  signToken,
  verifyToken
};
