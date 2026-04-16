/**
 * HABIT TRACKER SYSTEM V4 (14KO Compliant)
 * Features: Streaks, Charts, History, Reordering, Deletion
 */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const method = req.method;

    // --- 1. SESSION MANAGEMENT ---
    const cookie = req.headers.get('Cookie');
    const sessionId = cookie ? cookie.split(';').find(c => c.trim().startsWith('sess='))?.split('=')[1] : null;
    let user = null;

    if (sessionId) user = await env.AUTH_DB.prepare('SELECT * FROM sessions WHERE id = ? AND expires > ?').bind(sessionId, Date.now()).first();

    // --- 3. PROTECTED ROUTES --- redirect to central auth if not logged in
    if (!user) {
      return new Response(null, {
        status: 302,
        headers: { 'Location': `/auth/login?redirect=${encodeURIComponent(url.pathname)}` }
      });
    }

    // API: ADD HABIT
    if (url.pathname === '/habits/api/add' && method === 'POST') {
      const fd = await req.formData();
      await env.DB.prepare('INSERT INTO habits (id, username, name, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), user.username, fd.get('name'), Date.now()).run();
      return new Response("OK");
    }

    // API: DELETE HABIT
    if (url.pathname === '/habits/api/delete' && method === 'POST') {
      const fd = await req.formData();
      const habitId = fd.get('habitId');
      await env.DB.prepare('DELETE FROM habits WHERE id = ? AND username = ?').bind(habitId, user.username).run();
      await env.DB.prepare('DELETE FROM habit_logs WHERE habit_id = ? AND username = ?').bind(habitId, user.username).run();
      return new Response("OK");
    }

    // API: REORDER HABIT
    if (url.pathname === '/habits/api/reorder' && method === 'POST') {
      const fd = await req.formData();
      const habitId = fd.get('habitId'), direction = fd.get('direction');
      const { results: habits } = await env.DB.prepare('SELECT * FROM habits WHERE username = ? ORDER BY created_at ASC').bind(user.username).all();

      const idx = habits.findIndex(h => h.id === habitId);
      if (idx !== -1) {
        let targetTs = null;
        if (direction === 'up' && idx > 0) targetTs = habits[idx - 1].created_at - 1;
        if (direction === 'down' && idx < habits.length - 1) targetTs = habits[idx + 1].created_at + 1;

        if (targetTs !== null) {
          await env.DB.prepare('UPDATE habits SET created_at = ? WHERE id = ?').bind(targetTs, habitId).run();
        }
      }
      return new Response("OK");
    }

    // API: TOGGLE HABIT
    if (url.pathname === '/habits/api/toggle' && method === 'POST') {
      const fd = await req.formData();
      const existing = await env.DB.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ? AND username = ?').bind(fd.get('habitId'), fd.get('date'), user.username).first();
      if (existing) await env.DB.prepare('UPDATE habit_logs SET completed = ? WHERE id = ?').bind(existing.completed ? 0 : 1, existing.id).run();
      else await env.DB.prepare('INSERT INTO habit_logs (id, habit_id, username, date, completed) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), fd.get('habitId'), user.username, fd.get('date'), 1).run();
      return new Response("OK");
    }

    // API: PASSWORD
    if (url.pathname === '/habits/api/password' && method === 'POST') {
      const fd = await req.formData();
      await env.AUTH_DB.prepare('UPDATE users SET password = ? WHERE username = ?').bind(await hash(fd.get('p')), user.username).run();
      return new Response("OK");
    }

    // DATA FETCHING
    const { results: habits } = await env.DB.prepare('SELECT * FROM habits WHERE username = ? ORDER BY created_at ASC').bind(user.username).all();
    const { results: logs } = await env.DB.prepare('SELECT * FROM habit_logs WHERE username = ? AND completed = 1').bind(user.username).all();

    // --- 4. RENDER PAGES ---
    if (url.pathname === '/habits/settings') return new Response(renderSettings(user), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/habits/history') return new Response(renderHistory(user, habits, logs), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/habits' || url.pathname === '/habits/') return new Response(renderDash(user, habits, logs), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

    return new Response("404", { status: 404 });
  }
};

async function hash(str) {
  const buf = new TextEncoder().encode(str);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- CSS ---
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap');
:root{
  --bg:#0F1115;--surface:#1A1D24;--surface-hover:#20242C;--surface-soft:#151820;
  --text:#F1F5F9;--text-secondary:#94A3B8;--text-muted:#64748B;--border:#262A33;
  --accent:#A855F7;--accent-pink:#EC4899;
  --accent-soft:rgba(168,85,247,0.10);--accent-glow:rgba(168,85,247,0.20);
  --danger:#F43F5E;--danger-soft:rgba(244,63,94,0.12);
  --good:#10B981;--good-soft:rgba(16,185,129,0.12);
  --warn:#F59E0B;--warn-soft:rgba(245,158,11,0.12);
  --radius-sm:6px;--radius:8px;--radius-md:10px;--radius-lg:12px;--radius-xl:16px;
  --transition:150ms ease-out;
  --shadow-sm:0 1px 3px rgba(0,0,0,0.25);--shadow:0 4px 16px rgba(0,0,0,0.30);--shadow-lg:0 16px 48px rgba(0,0,0,0.40);
  --gradient:linear-gradient(135deg,#A855F7,#EC4899);
  --gradient-subtle:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(236,72,153,0.10));
  --font:"DM Sans",ui-sans-serif,system-ui,-apple-system,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*,*::before,*::after{box-sizing:border-box}
body{margin:0 auto;font-family:var(--font);background:var(--bg);color:var(--text);max-width:1080px;padding:24px;line-height:1.5;font-size:14px;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{letter-spacing:-0.01em;font-weight:700}
h3{font-size:1.02rem;margin:0 0 12px}
p{margin:6px 0}
::selection{background:rgba(168,85,247,0.30)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
input,button{font:inherit;color:inherit}
input{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:var(--radius);margin:4px 0;transition:all var(--transition);font-size:0.9em}
input::placeholder{color:var(--text-muted)}
input:focus{outline:none;border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px var(--accent-glow)}
button{cursor:pointer;background:var(--gradient);color:#fff;font-weight:600;border:none;padding:9px 16px;border-radius:var(--radius);transition:all var(--transition);font-size:0.9em;box-shadow:0 2px 8px rgba(168,85,247,0.30)}
button:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(168,85,247,0.40)}
button:active{transform:translateY(0)}
.card{background:var(--surface);padding:22px;border-radius:var(--radius-lg);margin-bottom:20px;border:1px solid var(--border);box-shadow:var(--shadow-sm)}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
table{width:100%;border-collapse:separate;border-spacing:0;margin-top:14px;font-size:0.88em}
th,td{border:1px solid var(--border);padding:10px 8px;text-align:center;min-width:44px;transition:background var(--transition)}
th{background:var(--surface-soft);color:var(--text-muted);font-size:0.72rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase}
td{background:var(--surface-soft)}
tr td:first-child{border-top-left-radius:var(--radius);border-bottom-left-radius:var(--radius)}
tr td:last-child{border-top-right-radius:var(--radius);border-bottom-right-radius:var(--radius)}
.done{background:var(--good-soft)!important;color:var(--good);cursor:pointer;font-weight:700;text-shadow:0 0 10px rgba(16,185,129,0.35)}
.done:hover{background:rgba(16,185,129,0.22)!important}
.missed{color:var(--text-muted);cursor:pointer}
.missed:hover{background:var(--surface-hover)}
.week-label{background:transparent!important;color:var(--text-muted);text-transform:uppercase;font-size:0.62rem;letter-spacing:0.1em;border-bottom:none;padding-bottom:4px;font-family:var(--font-mono)}
.streak{background:var(--gradient-subtle);color:var(--accent-pink);padding:2px 10px;border-radius:999px;font-size:0.72rem;margin-left:8px;display:inline-flex;align-items:center;border:1px solid rgba(236,72,153,0.25);font-weight:700;letter-spacing:0.02em}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media (max-width:768px){.stats-grid{grid-template-columns:1fr}}
canvas{max-width:100%;background:var(--surface-soft);border-radius:var(--radius-lg);padding:16px;border:1px solid var(--border);margin-top:14px}
a{color:var(--accent);text-decoration:none;transition:color var(--transition)}
a:hover{color:var(--accent-pink)}
.nav-link{padding:7px 14px;border-radius:999px;background:var(--surface-soft);border:1px solid var(--border);color:var(--text-secondary);font-weight:600;font-size:0.82rem;transition:all var(--transition);display:inline-flex;align-items:center;gap:6px}
.nav-link:hover{background:var(--surface-hover);color:var(--text)}
.nav-link.active{background:var(--gradient);color:#fff;border-color:transparent;box-shadow:0 2px 8px rgba(168,85,247,0.35)}
.ctrl-btn{background:transparent;color:var(--text-muted);border:1px solid transparent;padding:4px 8px;border-radius:var(--radius-sm);font-size:0.82em;cursor:pointer;margin-left:4px;box-shadow:none;font-weight:500}
.ctrl-btn:hover{background:var(--surface-hover);color:var(--text);border-color:var(--border);transform:none;box-shadow:none}
.ctrl-btn.del:hover{background:var(--danger-soft);color:var(--danger);border-color:rgba(244,63,94,0.25)}
.today-col{border-left:2px solid var(--accent)!important;border-right:2px solid var(--accent)!important;position:relative;background:var(--accent-soft)!important}
.today-col.missed{background:var(--accent-soft)!important}
.today-label{background:var(--gradient);color:#fff;font-weight:700;padding:2px 7px;border-radius:var(--radius-sm);font-size:0.58rem;margin-top:4px;display:inline-block;letter-spacing:0.1em;box-shadow:0 2px 8px rgba(168,85,247,0.4);font-family:var(--font-mono)}
header{display:flex;justify-content:space-between;align-items:center;min-height:64px;padding:12px 24px!important;background:var(--surface)!important;border:1px solid var(--border)!important;margin-bottom:24px!important;border-radius:var(--radius-lg)!important;box-shadow:var(--shadow-sm)!important;flex-wrap:nowrap;gap:12px}
header strong{font-size:1.05em;letter-spacing:-0.02em}
.user-wrap{position:relative}
.user-btn{display:flex;align-items:center;gap:8px;color:var(--text);font-size:0.84rem;font-weight:500;padding:6px 12px 6px 10px;border-radius:var(--radius);background:transparent;border:1px solid var(--border);cursor:pointer;transition:all var(--transition);white-space:nowrap;box-shadow:none}
.user-btn:hover{background:var(--surface-hover);transform:none;box-shadow:none}
.user-btn .caret{transition:transform var(--transition);margin-left:2px;color:var(--text-muted)}
.user-wrap.open .user-btn .caret{transform:rotate(180deg)}
.user-dropdown{display:none;position:absolute;right:0;top:calc(100% + 8px);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);min-width:220px;box-shadow:var(--shadow-lg);z-index:999;overflow:hidden}
.user-wrap.open .user-dropdown{display:block;animation:fadeInDropdown 150ms ease-out}
@keyframes fadeInDropdown{from{opacity:0;transform:translateY(-4px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.user-dropdown-header{padding:14px 16px 10px;border-bottom:1px solid var(--border)}
.user-dropdown-header .uname{font-weight:700;color:var(--text);font-size:0.92rem}
.user-dropdown-header .role{color:var(--text-muted);font-size:0.76rem;margin-top:2px}
.user-dropdown a{display:flex;align-items:center;gap:10px;padding:10px 16px;color:var(--text);text-decoration:none;font-size:0.86rem;font-weight:500;transition:background var(--transition)}
.user-dropdown a:hover{background:var(--accent-soft);color:var(--text)}
.user-dropdown .sep{height:1px;background:var(--border);margin:4px 0}
.user-dropdown .signout{color:var(--danger)}
.user-dropdown .signout:hover{background:var(--danger-soft);color:var(--danger)}
`;

const FAVICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23A855F7'/%3E%3Cstop offset='1' stop-color='%23EC4899'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='url(%23g)'/%3E%3Ctext x='16' y='21' font-family='Arial,sans-serif' font-weight='900' font-size='12' fill='white' text-anchor='middle'%3E111%3C/text%3E%3C/svg%3E`;

function renderBrand(appName) {
  return `<a href="/" style="text-decoration:none;display:flex;align-items:center;gap:10px;flex-shrink:0">
    <span style="width:36px;height:36px;background:linear-gradient(135deg,#A855F7,#EC4899);border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.9em;color:#fff;flex-shrink:0;box-shadow:0 2px 8px rgba(168,85,247,0.3)">111</span>
    <div style="display:flex;flex-direction:column;line-height:1.25">
      <span style="font-weight:700;font-size:1.1em;color:#fff;letter-spacing:-0.02em">111<span style="color:#A855F7;text-shadow:0 0 20px rgba(168,85,247,0.5)">iridescence</span></span>
      <span style="font-size:0.72em;color:#94a3b8;font-weight:500;letter-spacing:0.03em">${appName}</span>
    </div>
  </a>`;
}

function renderUserDropdown(username) {
  return `<div class="user-wrap" id="uw">
    <button class="user-btn" onclick="document.getElementById('uw').classList.toggle('open')">
      ${username}
      <svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="user-dropdown">
      <div class="user-dropdown-header"><div class="uname">${username}</div><div class="role">Habit Tracker</div></div>
      <a href="/auth/account">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
        Account Preferences
      </a>
      <a href="/auth/admin">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        Admin Panel
      </a>
      <div class="sep"></div>
      <a href="/auth/logout" class="signout">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sign Out
      </a>
    </div>
  </div>
  <script>document.addEventListener('click',e=>{const w=document.getElementById('uw');if(w&&!w.contains(e.target))w.classList.remove('open')});</script>`;
}

function renderNav(active, username) {
  return `<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
    <a href="/habits" class="nav-link ${active === 'dash' ? 'active' : ''}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
      Tracker</a>
    <a href="/habits/history" class="nav-link ${active === 'hist' ? 'active' : ''}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      History</a>
    ${renderUserDropdown(username)}
  </div>`;
}


function renderSettings(user) {
  return `<!DOCTYPE html><html lang="en"><head><title>111 Habit Tracker</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="${FAVICON}"><style>${CSS}</style></head><body>
    <header>
      ${renderBrand('Habit Tracker')}
      ${renderNav('set', user.username)}
    </header>
    <div class="card"><h3>App Settings</h3><p style="color:var(--txt-muted);margin-bottom:16px">Manage your account from the user menu in the top right.</p><a href="/auth/account" class="nav-link active" style="display:inline-flex">Open Account Preferences</a></div>
  </body></html>`;
}

function renderHistory(user, habits, logs) { /* Unchanged from V3 */
  const historyData = {};
  logs.forEach(l => { const yr = l.date.slice(0, 4), mo = l.date.slice(5, 7); if (!historyData[yr]) historyData[yr] = {}; if (!historyData[yr][mo]) historyData[yr][mo] = {}; historyData[yr][mo][l.habit_id] = (historyData[yr][mo][l.habit_id] || 0) + 1; });
  const years = Object.keys(historyData).sort((a, b) => b - a);
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'], monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `<!DOCTYPE html><html lang="en"><head><title>111 Habit Tracker</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="${FAVICON}"><style>${CSS}</style></head><body>
    <header>
      ${renderBrand('Habit Tracker')}
      ${renderNav('hist', user.username)}
    </header>
    ${years.length === 0 ? '<div class="card">No history available yet.</div>' : years.map(yr => `<div class="card"><h3>📅 ${yr} Breakdown</h3><div style="overflow-x:auto"><table><tr><th style="background:#121212">Habit</th>${monthNames.map(m => `<th>${m}</th>`).join('')}<th>Total</th></tr>${habits.map(h => { let yTot = 0; const mCols = months.map(m => { const count = historyData[yr]?.[m]?.[h.id] || 0; yTot += count; const alpha = count / 30; return `<td style="background:rgba(76, 175, 80, ${alpha}); color:${count > 0 ? '#fff' : '#444'}">${count}</td>`; }).join(''); return `<tr><td style="font-weight:bold">${h.name}</td>${mCols}<td style="font-weight:bold;color:var(--p)">${yTot}</td></tr>`; }).join('')}</table></div></div>`).join('')}
  </body></html>`;
}

function renderDash(user, habits, logs) {
  const allDays = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return d.toISOString().split('T')[0]; });
  const logMap = new Set(logs.map(l => l.habit_id + '_' + l.date));

  const habitsWithData = habits.map(h => {
    let streak = 0, d = new Date();
    for (let i = 0; i < 3000; i++) { if (logMap.has(h.id + '_' + d.toISOString().split('T')[0])) streak++; else if (i !== 0) break; d.setDate(d.getDate() - 1); }
    let last30 = 0, d30 = new Date();
    for (let i = 0; i < 30; i++) { if (logMap.has(h.id + '_' + d30.toISOString().split('T')[0])) last30++; d30.setDate(d30.getDate() - 1); }
    return { ...h, streak, last30 };
  });

  const sorted = [...habitsWithData].sort((a, b) => b.last30 - a.last30);
  const best = sorted.length ? sorted[0] : { name: 'N/A', last30: 0 };
  const worst = sorted.length ? sorted[sorted.length - 1] : { name: 'N/A', last30: 0 };
  const dailyTotals = allDays.map(d => logs.filter(l => l.date === d).length);

  return `<!DOCTYPE html><html lang="en"><head><title>111 Habit Tracker</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="${FAVICON}"><style>${CSS}</style><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body>
    <header>
      ${renderBrand('Habit Tracker')}
      ${renderNav('dash', user.username)}
    </header>

    <div class="card">
      <div class="row"><h3>📊 14-Day Grid</h3><form onsubmit="event.preventDefault();addHabit(this)" style="display:flex;gap:5px"><input type="text" name="name" placeholder="New Habit..." required><button>Add</button></form></div>
      <div style="overflow-x:auto"><table>
        <tr><th rowspan="2" style="background:#121212">Habit</th><th colspan="7" class="week-label">This Week</th><th colspan="7" class="week-label" style="border-left:2px solid #555">Last Week</th></tr>
        <tr>${allDays.map((d, i) => `<th class="${i === 0 ? 'today-col' : ''}" style="${i === 7 ? 'border-left:2px solid #555;' : ''}"><div>${d.slice(8, 10)}/${d.slice(5, 7)}</div>${i === 0 ? '<div class="today-label">TODAY</div>' : ''}</th>`).join('')}</tr>
        ${habitsWithData.map(h => `<tr>
          <td style="font-weight:bold;text-align:left;display:flex;justify-content:space-between;align-items:center;border:none">
            <span>${h.name} ${h.streak >= 3 ? `<span class="streak">🔥 ${h.streak}d</span>` : ''}</span>
            <div style="white-space:nowrap">
              <button class="ctrl-btn" onclick="reorder('${h.id}', 'up')" title="Move Up">▲</button>
              <button class="ctrl-btn" onclick="reorder('${h.id}', 'down')" title="Move Down">▼</button>
              <button class="ctrl-btn del" onclick="delHabit('${h.id}', '${h.name}')" title="Delete">🗑</button>
            </div>
          </td>
          ${allDays.map((d, i) => `<td class="${logMap.has(h.id + '_' + d) ? 'done' : 'missed'} ${i === 0 ? 'today-col' : ''}" style="${i === 7 ? 'border-left:2px solid #555;' : ''}" onclick="toggle('${h.id}', '${d}')">${logMap.has(h.id + '_' + d) ? '✓' : '✗'}</td>`).join('')}</tr>`).join('')}
      </table></div>
    </div>

    <div class="stats-grid">
      <div class="card">
        <h3>🏆 30-Day Summary</h3>
        <p><strong>Most Respected:</strong> ${best.name} (${best.last30}/30)</p>
        <p><strong>Needs Attention:</strong> ${worst.name} (${worst.last30}/30)</p>
        <canvas id="habitChart"></canvas>
      </div>
      <div class="card">
        <h3>📈 Daily Momentum (14 Days)</h3>
        <canvas id="dailyChart"></canvas>
      </div>
    </div>

    <script>
      async function addHabit(f) { await fetch('/habits/api/add', {method:'POST', body:new FormData(f)}); location.reload(); }
      async function toggle(id, d) { const fd = new FormData(); fd.append('habitId', id); fd.append('date', d); await fetch('/habits/api/toggle', {method:'POST', body:fd}); location.reload(); }
      
      async function delHabit(id, name) {
        if(!confirm('Permanently delete "' + name + '" and all its history?')) return;
        const fd = new FormData(); fd.append('habitId', id);
        await fetch('/habits/api/delete', {method:'POST', body:fd}); location.reload();
      }

      async function reorder(id, dir) {
        const fd = new FormData(); fd.append('habitId', id); fd.append('direction', dir);
        await fetch('/habits/api/reorder', {method:'POST', body:fd}); location.reload();
      }

      new Chart(document.getElementById('habitChart'), { type: 'bar', data: { labels: ${JSON.stringify(habitsWithData.map(h => h.name))}, datasets: [{ label: 'Days Completed (30d)', data: ${JSON.stringify(habitsWithData.map(h => h.last30))}, backgroundColor: '#A855F7', borderRadius: 4 }] }, options: { scales: { y: { max: 30, grid: {color: 'rgba(255,255,255,0.05)'}, ticks: {color: '#94a3b8'} }, x: { grid: {display:false}, ticks: {color: '#94a3b8'} } }, plugins:{legend:{labels:{color:'#F1F5F9', font: {family: 'DM Sans'}}}} } });
      new Chart(document.getElementById('dailyChart'), { type: 'line', data: { labels: ${JSON.stringify(allDays.slice().reverse().map(d => d.slice(5)))}, datasets: [{ label: 'Habits Done', data: ${JSON.stringify(dailyTotals.slice().reverse())}, borderColor: '#EC4899', tension: 0.4, fill:true, backgroundColor:'rgba(236,72,153,0.1)', pointBackgroundColor: '#EC4899' }] }, options: { scales: { y: { beginAtZero: true, grid: {color: 'rgba(255,255,255,0.05)'}, ticks: {color: '#94a3b8'} }, x: { grid: {display:false}, ticks: {color: '#94a3b8'} } }, plugins:{legend:{labels:{color:'#F1F5F9', font: {family: 'DM Sans'}}}} } });
    </script>
  </body></html>`;
}
