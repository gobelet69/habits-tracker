/**
 * HABIT TRACKER SYSTEM V2 (14KO Handshake Compliant)
 * Features: Streaks, History, Weekly Views, Account Management
 */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const method = req.method;

    // --- 1. SESSION MANAGEMENT ---
    const cookie = req.headers.get('Cookie');
    const sessionId = cookie ? cookie.split(';').find(c => c.trim().startsWith('sess='))?.split('=')[1] : null;
    let user = null;

    if (sessionId) {
      user = await env.DB.prepare('SELECT * FROM sessions WHERE id = ? AND expires > ?').bind(sessionId, Date.now()).first();
    }

    // --- 2. PUBLIC ROUTES (Login & Register) ---
    if (url.pathname === '/habits/login' && method === 'POST') {
      const fd = await req.formData();
      const u = fd.get('u'), p = fd.get('p');
      const dbUser = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND password = ?').bind(u, await hash(p)).first();
      
      if (!dbUser) return new Response('Invalid credentials', { status: 401 });

      const newSess = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO sessions (id, username, role, expires) VALUES (?, ?, ?, ?)').bind(newSess, dbUser.username, dbUser.role, Date.now() + 86400000).run();

      return new Response('OK', { headers: { 'Set-Cookie': `sess=${newSess}; HttpOnly; Secure; SameSite=Strict; Path=/` } });
    }

    if (url.pathname === '/habits/register' && method === 'POST') {
      const fd = await req.formData();
      const u = fd.get('u'), p = fd.get('p');
      const existing = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(u).first();
      if(existing) return new Response('Username taken', {status: 400});

      await env.DB.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').bind(u, await hash(p), 'user').run();
      return new Response('OK');
    }

    if (url.pathname === '/habits/logout') {
      if (sessionId) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
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

    // API: TOGGLE HABIT
    if (url.pathname === '/habits/api/toggle' && method === 'POST') {
      const fd = await req.formData();
      const habitId = fd.get('habitId'), date = fd.get('date');
      const existing = await env.DB.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ? AND username = ?').bind(habitId, date, user.username).first();
      
      if (existing) {
        await env.DB.prepare('UPDATE habit_logs SET completed = ? WHERE id = ?').bind(existing.completed ? 0 : 1, existing.id).run();
      } else {
        await env.DB.prepare('INSERT INTO habit_logs (id, habit_id, username, date, completed) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), habitId, user.username, date, 1).run();
      }
      return new Response("OK");
    }

    // API: UPDATE PASSWORD
    if (url.pathname === '/habits/api/password' && method === 'POST') {
      const fd = await req.formData();
      await env.DB.prepare('UPDATE users SET password = ? WHERE username = ?').bind(await hash(fd.get('p')), user.username).run();
      return new Response("OK");
    }

    // --- 4. RENDER PAGES ---
    if (url.pathname === '/habits/settings') {
      return new Response(renderSettings(user), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/habits' || url.pathname === '/habits/') {
      const { results: habits } = await env.DB.prepare('SELECT * FROM habits WHERE username = ? ORDER BY created_at ASC').bind(user.username).all();
      // We fetch ALL logs to calculate correct streaks, not just 30 days. History is preserved indefinitely.
      const { results: logs } = await env.DB.prepare('SELECT * FROM habit_logs WHERE username = ? AND completed = 1').bind(user.username).all();

      return new Response(renderDash(user, habits, logs), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return new Response("404", { status: 404 });
  }
};

async function hash(str) {
  const buf = new TextEncoder().encode(str);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- HTML / UI GENERATION ---
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
a{color:var(--s);text-decoration:none}
`;

function renderLogin() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title><style>${CSS}</style></head>
  <body style="display:flex;justify-content:center;align-items:center;height:100vh">
    <div class="card" style="width:300px;text-align:center"><h2>Habit Tracker</h2>
      <div id="forms">
        <form onsubmit="event.preventDefault();doLogin(this)">
          <input type="text" name="u" placeholder="Username" required style="width:90%"><br>
          <input type="password" name="p" placeholder="Password" required style="width:90%"><br>
          <button style="width:100%">LOGIN</button>
        </form>
        <p style="font-size:0.8em;color:#aaa;cursor:pointer;margin-top:15px" onclick="toggleReg()">Create an account</p>
      </div>
      <div id="reg" style="display:none">
        <form onsubmit="event.preventDefault();doReg(this)">
          <input type="text" name="u" placeholder="New Username" required style="width:90%"><br>
          <input type="password" name="p" placeholder="New Password" required style="width:90%"><br>
          <button style="width:100%;background:var(--s)">REGISTER</button>
        </form>
        <p style="font-size:0.8em;color:#aaa;cursor:pointer;margin-top:15px" onclick="toggleReg()">Back to login</p>
      </div>
      <div id="msg" style="color:var(--err);margin-top:10px"></div>
    </div>
    <script>
      function toggleReg(){ document.getElementById('forms').style.display = document.getElementById('forms').style.display === 'none' ? 'block' : 'none'; document.getElementById('reg').style.display = document.getElementById('reg').style.display === 'none' ? 'block' : 'none'; document.getElementById('msg').innerText=''; }
      async function doLogin(f){ const r=await fetch('/habits/login',{method:'POST',body:new FormData(f)}); if(r.ok) location.reload(); else document.getElementById('msg').innerText = "Access Denied"; }
      async function doReg(f){ const r=await fetch('/habits/register',{method:'POST',body:new FormData(f)}); if(r.ok) { alert('Account created! Please log in.'); toggleReg(); } else document.getElementById('msg').innerText = "Username taken"; }
    </script>
  </body></html>`;
}

function renderSettings(user) {
  return `<!DOCTYPE html><html lang="en"><head><title>Settings</title><style>${CSS}</style></head><body>
    <header class="row card" style="padding:15px">
      <div><strong>⚙ Settings</strong> <span style="color:#777">| ${user.username}</span></div>
      <a href="/habits">← Back to Tracker</a>
    </header>
    <div class="card">
      <h3>Change Password</h3>
      <form onsubmit="event.preventDefault();changePw(this)">
        <input type="password" name="p" placeholder="New Password" required><br>
        <button>Update Password</button>
      </form>
    </div>
    <script>
      async function changePw(f){ const r=await fetch('/habits/api/password',{method:'POST',body:new FormData(f)}); if(r.ok) alert('Password updated successfully.'); }
    </script>
  </body></html>`;
}

function renderDash(user, habits, logs) {
  // DATE GENERATION (Last 14 days, split into This Week vs Last Week)
  const todayDate = new Date();
  const todayStr = todayDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const allDays = Array.from({length: 14}, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d.toISOString().split('T')[0];
  });
  const lastWeek = allDays.slice(0, 7);
  const thisWeek = allDays.slice(7, 14);

  // STREAK CALCULATION LOGIC
  const logMap = new Set(logs.map(l => l.habit_id + '_' + l.date));
  
  const habitsWithStreaks = habits.map(h => {
    let streak = 0;
    let d = new Date();
    // Check backwards from today to infinity
    for(let i=0; i<3000; i++) {
      const dateStr = d.toISOString().split('T')[0];
      if(logMap.has(h.id + '_' + dateStr)) streak++;
      else if (i !== 0) break; // If not found and it's not today, streak breaks.
      d.setDate(d.getDate() - 1);
    }
    return { ...h, streak };
  });

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Habits</title><style>${CSS}</style></head>
  <body>
    <header class="row card" style="padding:15px">
      <div>
        <strong style="font-size:1.2em">Habit Tracker</strong> <span style="color:#777">| ${user.username}</span><br>
        <small style="color:var(--s)">📅 Today is ${todayStr}</small>
      </div>
      <div style="display:flex;gap:10px">
        <a href="/habits/settings" style="background:#333;padding:5px 10px;border-radius:4px;">⚙ Settings</a>
        <a href="/habits/logout" style="color:var(--err);align-self:center;">Logout</a>
      </div>
    </header>

    <div class="card">
      <div class="row">
        <h3>📊 Weekly Tracker</h3>
        <form onsubmit="event.preventDefault();addHabit(this)" style="display:flex;gap:5px">
          <input type="text" name="name" placeholder="New Habit..." required>
          <button>Add</button>
        </form>
      </div>
      <div style="overflow-x:auto">
        <table>
          <tr>
            <th rowspan="2" style="background:#121212">Habit</th>
            <th colspan="7" class="week-label">Last Week</th>
            <th colspan="7" class="week-label" style="border-left:2px solid #555">This Week</th>
          </tr>
          <tr>
            ${allDays.map(d => `<th style="${d === thisWeek[0] ? 'border-left:2px solid #555;' : ''}">${d.slice(8,10)}/${d.slice(5,7)}</th>`).join('')}
          </tr>
          ${habitsWithStreaks.map(h => `
            <tr>
              <td style="font-weight:bold;text-align:left">
                ${h.name}
                ${h.streak >= 3 ? `<span class="streak">🔥 ${h.streak} Day Streak!</span>` : ''}
              </td>
              ${allDays.map(d => {
                const isDone = logMap.has(h.id + '_' + d);
                const borderLeft = d === thisWeek[0] ? 'border-left:2px solid #555;' : '';
                return `<td class="${isDone ? 'done' : 'missed'}" style="${borderLeft}" onclick="toggle('${h.id}', '${d}')">${isDone ? '✓' : '✗'}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </table>
      </div>
    </div>

    <script>
      async function addHabit(f) { await fetch('/habits/api/add', {method:'POST', body:new FormData(f)}); location.reload(); }
      async function toggle(habitId, date) {
        const fd = new FormData(); fd.append('habitId', habitId); fd.append('date', date);
        await fetch('/habits/api/toggle', {method:'POST', body:fd}); location.reload();
      }
    </script>
  </body></html>`;
}