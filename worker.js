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

    // --- 2. PUBLIC ROUTES ---
    if (url.pathname === '/habits/login' && method === 'POST') {
      const fd = await req.formData();
      const dbUser = await env.AUTH_DB.prepare('SELECT * FROM users WHERE username = ? AND password = ?').bind(fd.get('username'), await hash(fd.get('password'))).first();
      if (!dbUser) return new Response('Invalid credentials', { status: 401 });
      const newSess = crypto.randomUUID();
      await env.AUTH_DB.prepare('INSERT INTO sessions (id, username, role, expires) VALUES (?, ?, ?, ?)').bind(newSess, dbUser.username, dbUser.role, Date.now() + 86400000).run();
      return new Response('OK', { headers: { 'Set-Cookie': `sess=${newSess}; HttpOnly; Secure; SameSite=Strict; Path=/` } });
    }

    if (url.pathname === '/habits/register' && method === 'POST') {
      const fd = await req.formData();
      const existing = await env.AUTH_DB.prepare('SELECT username FROM users WHERE username = ?').bind(fd.get('username')).first();
      if (existing) return new Response('Username taken', { status: 400 });
      await env.AUTH_DB.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').bind(fd.get('username'), await hash(fd.get('password')), 'user').run();
      return new Response('OK');
    }

    if (url.pathname === '/habits/logout') {
      if (sessionId) await env.AUTH_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
      return new Response('Logged out', { status: 302, headers: { 'Location': '/habits', 'Set-Cookie': 'sess=; Max-Age=0; Path=/' } });
    }

    // --- 3. PROTECTED ROUTES ---
    if (!user) return new Response(renderLogin(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

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
:root{--bg:#121212;--card:#1e1e1e;--txt:#e0e0e0;--p:#bb86fc;--s:#03dac6;--err:#cf6679;--good:#4caf50}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--txt);max-width:900px;margin:0 auto;padding:20px}
input{background:#333;border:1px solid #444;color:#fff;padding:8px;border-radius:4px;margin:5px 0}
button{cursor:pointer;background:var(--p);color:#000;font-weight:bold;border:none;padding:8px;border-radius:4px;}
button:hover{opacity:0.9}
.card{background:var(--card);padding:20px;border-radius:8px;margin-bottom:20px;border:1px solid #333}
.row{display:flex;justify-content:space-between;align-items:center}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{border:1px solid #333;padding:8px;text-align:center;min-width:40px;}
th{background:#2a2a2a;color:var(--s);font-size:0.85em}
.done{background:var(--good);color:#000;cursor:pointer}
.missed{background:#333;color:#777;cursor:pointer}
.week-label{background:#121212;color:#aaa;text-transform:uppercase;font-size:0.75em;letter-spacing:1px}
.streak{background:rgba(255,165,0,0.1);color:#ffa500;padding:2px 6px;border-radius:10px;font-size:0.75em;margin-left:5px;display:inline-block;border:1px solid #ffa500}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
canvas{max-width:100%;background:#1a1a1a;border-radius:4px;padding:10px;}
a{color:var(--s);text-decoration:none}
.nav-link{padding:5px 10px;border-radius:4px;background:#333;color:#fff;}
.nav-link.active{background:var(--p);color:#000}
.ctrl-btn{background:transparent;color:#777;border:none;padding:2px 6px;font-size:1.1em;cursor:pointer}
.ctrl-btn:hover{color:#fff}
.ctrl-btn.del:hover{color:var(--err)}
.today-col{border-left:3px solid var(--p)!important;border-right:3px solid var(--p)!important;position:relative}
.today-col.missed{background:rgba(187,134,252,0.15)!important}
.today-label{background:var(--p);color:#000;font-weight:bold;padding:2px 6px;border-radius:4px;font-size:0.7em}
`;

function renderNav(active) {
  return `<div style="display:flex;gap:10px">
    <a href="/habits" class="nav-link ${active === 'dash' ? 'active' : ''}"><span style="font-size:1.2em">📅</span> Tracker</a>
    <a href="/habits/history" class="nav-link ${active === 'hist' ? 'active' : ''}"><span style="font-size:1.2em">📚</span> History</a>
    <a href="/habits/settings" class="nav-link ${active === 'set' ? 'active' : ''}"><span style="font-size:1.2em">⚙</span> Settings</a>
    <a href="/habits/logout" style="color:var(--err);align-self:center;margin-left:auto">Logout</a>
  </div>`;
}

function renderLogin() {
  return `<!DOCTYPE html><html lang="en"><head><title>Login</title><style>${CSS}</style></head>
  <body style="display:flex;justify-content:center;align-items:center;height:100vh">
    <div class="card" style="width:350px;text-align:center">
      <h2 style="margin-bottom:5px">🎯 Habit Tracker</h2>
      <p style="color:#aaa;font-size:0.9em;margin-top:0">Track your daily habits</p>
      
      <div id="forms">
        <form id="loginForm" onsubmit="event.preventDefault();doLogin(this)" autocomplete="on">
          <input type="text" name="username" id="username" placeholder="Username" required autocomplete="username" style="width:90%"><br>
          <input type="password" name="password" id="password" placeholder="Password" required autocomplete="current-password" style="width:90%"><br>
          <button type="submit" style="width:100%;margin-top:5px">LOGIN</button>
        </form>
        <button onclick="toggleReg()" style="width:96%;margin-top:10px;background:var(--s);color:#000">CREATE ACCOUNT</button>
      </div>
      
      <div id="reg" style="display:none">
        <form id="registerForm" onsubmit="event.preventDefault();doReg(this)" autocomplete="on">
          <input type="text" name="username" placeholder="New Username" required autocomplete="username" style="width:90%"><br>
          <input type="password" name="password" placeholder="New Password" required autocomplete="new-password" style="width:90%"><br>
          <button type="submit" style="width:100%;background:var(--s);margin-top:5px">REGISTER</button>
        </form>
        <button onclick="toggleReg()" style="width:96%;margin-top:10px;background:#444;color:#fff">BACK TO LOGIN</button>
      </div>
      
      <div id="msg" style="color:var(--err);margin-top:10px;font-size:0.9em"></div>
    </div>
    <script>
      function toggleReg(){ 
        document.getElementById('forms').style.display = document.getElementById('forms').style.display === 'none' ? 'block' : 'none'; 
        document.getElementById('reg').style.display = document.getElementById('reg').style.display === 'none' ? 'block' : 'none'; 
        document.getElementById('msg').innerText=''; 
      } 
      async function doLogin(f){ 
        const fd = new FormData(f);
        const r = await fetch('/habits/login', {method:'POST', body:fd}); 
        if(r.ok) location.reload(); 
        else document.getElementById('msg').innerText = "Invalid credentials"; 
      } 
      async function doReg(f){ 
        const fd = new FormData(f);
        const r = await fetch('/habits/register', {method:'POST', body:fd}); 
        if(r.ok) { 
          alert('Account created! Please log in.'); 
          toggleReg(); 
        } else {
          document.getElementById('msg').innerText = "Username already taken"; 
        }
      }
    </script>
  </body></html>`;
}

function renderSettings(user) { /* Unchanged from V3 */
  return `<!DOCTYPE html><html lang="en"><head><title>Settings</title><style>${CSS}</style></head><body>
    <header class="row card" style="padding:15px"><div><strong>Settings</strong> | ${user.username}</div>${renderNav('set')}</header>
    <div class="card"><h3>Change Password</h3><form onsubmit="event.preventDefault();changePw(this)"><input type="password" name="p" placeholder="New Password" required><br><button>Update</button></form></div>
    <script>async function changePw(f){ const r=await fetch('/habits/api/password',{method:'POST',body:new FormData(f)}); if(r.ok) alert('Updated.'); }</script></body></html>`;
}

function renderHistory(user, habits, logs) { /* Unchanged from V3 */
  const historyData = {};
  logs.forEach(l => { const yr = l.date.slice(0, 4), mo = l.date.slice(5, 7); if (!historyData[yr]) historyData[yr] = {}; if (!historyData[yr][mo]) historyData[yr][mo] = {}; historyData[yr][mo][l.habit_id] = (historyData[yr][mo][l.habit_id] || 0) + 1; });
  const years = Object.keys(historyData).sort((a, b) => b - a);
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'], monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `<!DOCTYPE html><html lang="en"><head><title>History</title><style>${CSS}</style></head><body>
    <header class="row card" style="padding:15px"><div><strong>Global History</strong> | ${user.username}</div>${renderNav('hist')}</header>
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

  return `<!DOCTYPE html><html lang="en"><head><title>Habits</title><style>${CSS}</style><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body>
    <header class="row card" style="padding:15px"><div><strong>Habit Tracker</strong> | ${user.username}</div>${renderNav('dash')}</header>

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

      new Chart(document.getElementById('habitChart'), { type: 'bar', data: { labels: ${JSON.stringify(habitsWithData.map(h => h.name))}, datasets: [{ label: 'Days Completed (30d)', data: ${JSON.stringify(habitsWithData.map(h => h.last30))}, backgroundColor: '#03dac6' }] }, options: { scales: { y: { max: 30 } }, plugins:{legend:{labels:{color:'#fff'}}} } });
      new Chart(document.getElementById('dailyChart'), { type: 'line', data: { labels: ${JSON.stringify(allDays.slice().reverse().map(d => d.slice(5)))}, datasets: [{ label: 'Habits Done', data: ${JSON.stringify(dailyTotals.slice().reverse())}, borderColor: '#bb86fc', tension: 0.3, fill:true, backgroundColor:'rgba(187,134,252,0.1)' }] }, options: { scales: { y: { beginAtZero: true } } } });
    </script>
  </body></html>`;
}