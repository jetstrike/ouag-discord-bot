function renderDashboardHtml({ oauthConfigured }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OUAG Bot — Admin Dashboard</title>
  <style>
    :root { --bg: #0f1117; --card: #181b24; --border: #2a2f3d; --text: #e6e9f0; --muted: #9aa3b2; --accent: #5865f2; --green: #43b581; --yellow: #faa61a; --red: #f04747; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); }
    header { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; background: var(--card); border-bottom: 1px solid var(--border); }
    header h1 { margin: 0; font-size: 18px; }
    main { max-width: 1200px; margin: 24px auto; padding: 0 16px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
    button, a.btn { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; text-decoration: none; display: inline-block; }
    button.sec { background: #2d3343; }
    button.warn { background: #b8750b; }
    button.danger { background: #b83232; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    select, input { background: #10131a; color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #2d3343; }
    .badge.started { background: rgba(250,166,26,0.2); color: var(--yellow); }
    .badge.completed { background: rgba(67,181,129,0.2); color: var(--green); }
    .muted { color: var(--muted); font-size: 13px; }
    .code { font-family: monospace; background: #10131a; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); }
    #toast { position: fixed; bottom: 20px; right: 20px; background: #232734; border: 1px solid var(--border); padding: 10px 16px; border-radius: 8px; display: none; max-width: 380px; z-index: 99; }
  </style>
</head>
<body>
  <header>
    <h1>OUAG Tournament Admin</h1>
    <div id="authArea" class="row"></div>
  </header>
  <main id="app"><div class="card muted">Loading...</div></main>
  <div id="toast"></div>

  <script>
    const OAUTH_CONFIGURED = ${JSON.stringify(oauthConfigured)};
    let state = { user: null, guilds: [], selectedGuildId: null };

    function esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function toast(msg, isErr = false) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.borderColor = isErr ? '#f04747' : '#43b581';
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    async function api(url, opts = {}) {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    async function doAction(action, extra = {}) {
      try {
        const res = await api('/api/admin/action', {
          method: 'POST',
          body: JSON.stringify({ guildId: state.selectedGuildId, action, ...extra })
        });
        toast(res.message || 'Done');
        await loadOverview();
      } catch (err) {
        toast(err.message, true);
      }
    }

    async function promptOverride(podId, count) {
      const raw = prompt('Enter ' + count + ' space-separated placements (e.g. 1 2 3 4 5 6):');
      if (!raw) return;
      await doAction('override_pod', { podId, placements: raw });
    }

    async function promptTwoPlayers(action, podId, players) {
      const list = players.map((p, i) => (i + 1) + ': ' + p.username).join('\\n');
      const raw = prompt('Enter two player numbers separated by space for ' + action + ':\\n' + list);
      if (!raw) return;
      const idxs = raw.trim().split(/\\s+/).map(n => parseInt(n, 10) - 1);
      if (idxs.length !== 2 || idxs.some(i => !players[i])) return toast('Invalid player numbers', true);
      await doAction(action, { podId, player1Id: players[idxs[0]].user_id, player2Id: players[idxs[1]].user_id });
    }

    async function loadOverview() {
      const app = document.getElementById('app');
      const auth = document.getElementById('authArea');
      try {
        const data = await api('/api/admin/overview');
        state.user = data.user;
        state.guilds = data.guilds || [];
        if (!state.selectedGuildId && state.guilds.length > 0) {
          state.selectedGuildId = state.guilds[0].id;
        }
        auth.innerHTML = '<span class="muted">Signed in as <b>' + esc(state.user.username) + '</b></span>' +
          '<button class="sec" onclick="loadOverview()">Refresh</button>' +
          '<form method="POST" action="/auth/logout" style="margin:0"><button class="sec" type="submit">Log out</button></form>';
        render();
      } catch (err) {
        auth.innerHTML = OAUTH_CONFIGURED ? '<a class="btn" href="/auth/login">Sign in with Discord</a>' : '';
        app.innerHTML = '<div class="card">' +
          '<h2>Sign in required</h2>' +
          (OAUTH_CONFIGURED
            ? '<p class="muted">Sign in with Discord to view and manage tournaments where you are an Admin or Coordinator.</p><a class="btn" href="/auth/login">Sign in with Discord</a>'
            : '<p class="muted">Discord OAuth2 is not configured yet. Set <code>DISCORD_CLIENT_SECRET</code> and <code>OAUTH_REDIRECT_URI</code> in <code>.env</code>.</p>') +
          '</div>';
      }
    }

    function render() {
      const app = document.getElementById('app');
      if (state.guilds.length === 0) {
        app.innerHTML = '<div class="card"><p class="muted">No Discord servers found where you have Admin or Tournament Coordinator access.</p></div>';
        return;
      }

      const g = state.guilds.find(x => x.id === state.selectedGuildId) || state.guilds[0];
      state.selectedGuildId = g.id;
      const t = g.tournament;

      let html = '<div class="card row" style="justify-content:space-between">' +
        '<div class="row"><label class="muted">Server:</label>' +
        '<select onchange="state.selectedGuildId=this.value;render()">' +
        state.guilds.map(x => '<option value="' + esc(x.id) + '"' + (x.id === g.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') +
        '</select></div>' +
        '<div class="row"><a class="btn sec" href="/api/public/tournaments" target="_blank">Public JSON</a></div>' +
        '</div>';

      if (!t) {
        html += '<div class="card"><p class="muted">No active or recent tournament in <b>' + esc(g.name) + '</b>.</p></div>';
      } else {
        html += '<div class="card">' +
          '<div class="row" style="justify-content:space-between">' +
          '<div><h2 style="margin:0 0 4px 0">' + esc(t.name) + ' <span class="badge">' + esc(t.status) + ' / ' + esc(t.stage) + '</span></h2>' +
          '<div class="muted">ID #' + t.id + ' • Round ' + t.current_round + '/' + t.total_rounds +
          (t.finals_round_number ? ' • Finals Lobby #' + t.finals_round_number : '') +
          ' • Mode: ' + esc(t.channel_mode) + '</div></div>' +
          '<div class="row">' +
          '<button onclick="doAction(\\'start_round\\')">Start / Next Swiss Round</button>' +
          '<button class="warn" onclick="doAction(\\'start_finals\\')">Start / Next Finals</button>' +
          '<button class="sec" onclick="doAction(\\'cleanup\\')">Cleanup Channels</button>' +
          '</div></div></div>';

        const pods = g.pods || [];
        html += '<div class="card"><h3 style="margin-top:0">Pods (' + pods.length + ')</h3>' +
          (pods.length === 0 ? '<p class="muted">No pods created yet.</p>' : '<div class="grid">' + pods.map(p => {
            const pRows = (p.players || []).map(pl =>
              '<li>' + esc(pl.username) + (pl.user_id === p.leader_user_id ? ' 👑' : '') +
              (pl.placement ? ' — <b>Rank ' + pl.placement + '</b>' : ' — <span class="muted">pending</span>') + '</li>'
            ).join('');
            return '<div class="card" style="margin:0">' +
              '<div class="row" style="justify-content:space-between;margin-bottom:8px">' +
              '<b>' + (p.is_finals ? 'Finals #' + p.round_number : 'R' + p.round_number + ' Pod #' + p.pod_number) + ' (ID ' + p.id + ')</b>' +
              '<span class="badge ' + esc(p.status) + '">' + esc(p.status) + '</span></div>' +
              '<div class="muted" style="margin-bottom:8px">Code: <span class="code">' + esc(p.lobby_code || 'NONE') + '</span></div>' +
              '<ul style="margin:0 0 10px 18px;padding:0;font-size:13px">' + pRows + '</ul>' +
              '<div class="row">' +
                '<button class="sec" onclick="promptOverride(' + p.id + ',' + (p.players || []).length + ')">Override</button>' +
                (p.status === 'completed'
                  ? '<button class="warn" onclick="doAction(\\'restart_pod\\',{podId:' + p.id + '})">Restart Pod</button>'
                  : '<button class="sec" onclick="doAction(\\'crash_replay\\',{podId:' + p.id + '})">Crash Replay</button>' +
                    '<button class="warn" onclick=\\'promptTwoPlayers("rule_stuck",' + p.id + ',' + JSON.stringify(p.players || []).replace(/'/g, '&#39;') + ')\\'>Rule Stuck</button>' +
                    '<button class="warn" onclick=\\'promptTwoPlayers("crash_two",' + p.id + ',' + JSON.stringify(p.players || []).replace(/'/g, '&#39;') + ')\\'>Crash 2P</button>') +
              '</div></div>';
          }).join('') + '</div>') + '</div>';

        const standings = g.standings || [];
        html += '<div class="card"><h3 style="margin-top:0">Standings (' + standings.length + ')</h3>' +
          '<table><thead><tr><th>#</th><th>Player</th><th>Status</th><th>Swiss</th><th>Carry-Over</th><th>Finals</th><th>1sts</th><th>Action</th></tr></thead><tbody>' +
          standings.map((s, idx) =>
            '<tr><td>' + (idx + 1) + '</td><td>' + esc(s.username) + (s.is_eligible_to_win ? ' 🎯' : '') + '</td>' +
            '<td><span class="badge">' + esc(s.status) + '</span></td><td>' + s.points + '</td><td>' + s.carry_over_points + '</td>' +
            '<td>' + s.finals_points + '</td><td>' + s.first_places + '</td>' +
            '<td>' + (s.status === 'registered' || s.status === 'finalist'
              ? '<button class="danger" onclick="doAction(\\'drop_player\\',{userId:\\'' + esc(s.user_id) + '\\'})">Drop</button>' : '') +
            '</td></tr>'
          ).join('') + '</tbody></table></div>';
      }

      const issues = g.issueChannels || [];
      const casuals = g.casualLobbies || [];
      html += '<div class="grid">' +
        '<div class="card"><h3 style="margin-top:0">Open Issue Channels (' + issues.length + ')</h3>' +
        (issues.length ? '<ul>' + issues.map(c => '<li>Channel <span class="code">' + esc(c.channel_id) + '</span></li>').join('') + '</ul>' : '<p class="muted">None open.</p>') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Active Casual Queues (' + casuals.length + ')</h3>' +
        (casuals.length ? '<ul>' + casuals.map(l => '<li>Lobby #' + l.id + ' — ' + l.players.length + '/6 players (Code: <span class="code">' + esc(l.lobby_code || 'NONE') + '</span>)</li>').join('') + '</ul>' : '<p class="muted">None active.</p>') + '</div>' +
        '</div>';

      app.innerHTML = html;
    }

    loadOverview();
    setInterval(() => { if (state.user) loadOverview(); }, 10000);
  </script>
</body>
</html>`;
}

module.exports = { renderDashboardHtml };
