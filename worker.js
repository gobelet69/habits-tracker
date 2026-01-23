/**
 * HABIT TRACKER SYSTEM (14KO Handshake Compliant)
 * Features: User-specific data, Daily Tracking, Advanced Stats & Graphs
 * Path: /habits
 */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const method = req.method;

    // --- 1. SESSION CHECK (Same as Vault) ---
    const cookie = req.headers.get('Cookie');
    const sessionId = cookie ? cookie.split(';').find(c => c.trim().startsWith('sess='))?.split('=')[1] : null;
    let user = null;

    if (sessionId) {
      try {
        const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ? AND expires > ?').bind(sessionId, Date.now()).first();
        if (session) user = session;
      } catch (e) { console.error("Session DB Error:", e); }
    }

    // --- 2. PUBLIC ROUTES ---
    if (url.pathname === '/habits/login' && method === 'POST') {
      try {
        const fd = await req.formData();
        const u = fd.get('u'), p = fd.get('p');
        const pwHash = await hash(p);
        
        const dbUser = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND password = ?').bind(u, pwHash).first();
        if (!dbUser) return new Response('Invalid credentials', { status: 401 });

        const newSess = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO sessions (id, username, role, expires) VALUES (?, ?, ?, ?)').bind(newSess, dbUser.username, dbUser.role, Date.now() + 86400000).run();

        return new Response('OK', { headers: { 'Set-Cookie': `sess=${newSess}; HttpOnly; Secure; SameSite=Strict; Path=/` } });
      } catch (e) { return new Response("Login Error", { status: 500 }); }
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
      const habitName = fd.get('name');
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO habits (id, username, name, created_at) VALUES (?, ?, ?, ?)').bind(id, user.username, habitName, Date.now()).run();
      return new Response("OK");
    }

    // API: TOGGLE HABIT FOR A DATE
    if (url.pathname === '/habits/api/toggle' && method === 'POST') {
      const fd = await req.formData();
      const habitId = fd.get('habitId');
      const date = fd.get('date'); // YYYY-MM-DD
      
      const existing = await env.DB.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ? AND username = ?').bind(habitId, date, user.username).first();
      
      if (existing) {
        const newVal = existing.completed ? 0 : 1;
        await env.DB.prepare('UPDATE habit_logs SET completed = ? WHERE id = ?').bind(newVal, existing.id).run();
      } else {
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO habit_logs (id, habit_id, username, date, completed) VALUES (?, ?, ?, ?, ?)').bind(id, habitId, user.username, date, 1).run();
      }
      return new Response("OK");
    }

    // --- 4. RENDER DASHBOARD ---
    if (url.pathname === '/habits' || url.pathname === '/habits/') {
      // 1. Fetch Habits for this user
      const { results: habits } = await env.DB.prepare('SELECT * FROM habits WHERE username = ? ORDER BY created_at ASC').bind(user.username).all();
      
      // 2. Fetch Logs for this user for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

      const { results: logs } = await env.DB.prepare('SELECT * FROM habit_logs WHERE username = ? AND date >= ?').bind(user.username, dateStr).all();

      return new Response(renderDash(user, habits, logs), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return new Response("404", { status: 404 });
  }
};

async function hash(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
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
th,td{border:1px solid #333;padding:8px;text-align:center}
th{background:#2a2a2a;color:var(--s)}
.done{background:var(--good);color:#000;cursor:pointer}
.missed{background:#333;color:#777;cursor:pointer}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
canvas{max-width:100%;background:#1a1a1a;border-radius:4px;padding:10px;}
`;

function renderLogin() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title><style>${CSS}</style></head>
  <body style="display:flex;justify-content:center;align-items:center;height:100vh">
    <div class="card" style="width:300px;text-align:center"><h2>Habits Access</h2>
      <form onsubmit="event.preventDefault();doLogin(this)">
        <input type="text" name="u" placeholder="Username" required style="width:90%"><br>
        <input type="password" name="p" placeholder="Password" required style="width:90%"><br>
        <button style="width:100%">LOGIN</button>
      </form><div id="msg" style="color:var(--err)"></div>
    </div>
    <script>
      async function doLogin(f){
        const res = await fetch('/habits/login',{method:'POST',body:new FormData(f)});
        if(res.ok) location.reload(); else document.getElementById('msg').innerText = "Access Denied";
      }
    </script>
  </body></html>`;
}

function renderDash(user, habits, logs) {
  // Generate last 14 days for the grid
  const days = [];
  for(let i=13; i>=0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  // Calculate Stats
  let habitScores = habits.map(h => ({ name: h.name, id: h.id, completed: 0, total: 30 }));
  logs.forEach(l => {
    if(l.completed === 1) {
      const target = habitScores.find(hs => hs.id === l.habit_id);
      if(target) target.completed++;
    }
  });
  
  // Sort for Most/Least respected
  habitScores.sort((a,b) => b.completed - a.completed);
  const mostRespected = habitScores.length > 0 ? habitScores[0] : {name: 'N/A', completed:0};
  const leastRespected = habitScores.length > 0 ? habitScores[habitScores.length-1] : {name: 'N/A', completed:0};

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Habit Tracker</title><style>${CSS}</style><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head>
  <body>
    <header class="row card" style="padding:15px">
      <div><strong>Habit Tracker</strong> <span style="color:#777">| ${user.username}</span></div>
      <a href="/habits/logout" style="color:var(--err);text-decoration:none">Logout</a>
    </header>

    <div class="card">
      <div class="row">
        <h3>📅 14-Day Tracking</h3>
        <form onsubmit="event.preventDefault();addHabit(this)" style="display:flex;gap:5px">
          <input type="text" name="name" placeholder="New Habit..." required>
          <button>Add</button>
        </form>
      </div>
      <div style="overflow-x:auto">
        <table>
          <tr><th>Habit</th>${days.map(d => `<th>${d.slice(8,10)}/${d.slice(5,7)}</th>`).join('')}</tr>
          ${habits.map(h => `
            <tr>
              <td style="font-weight:bold;text-align:left">${h.name}</td>
              ${days.map(d => {
                const log = logs.find(l => l.habit_id === h.id && l.date === d);
                const isDone = log && log.completed;
                return `<td class="${isDone ? 'done' : 'missed'}" onclick="toggle('${h.id}', '${d}')">${isDone ? '✓' : '✗'}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </table>
      </div>
    </div>

    <div class="stats-grid">
      <div class="card">
        <h3>🏆 30-Day Summary</h3>
        <p><strong>Most Respected:</strong> ${mostRespected.name} (${mostRespected.completed}/30 days)</p>
        <p><strong>Needs Attention:</strong> ${leastRespected.name} (${leastRespected.completed}/30 days)</p>
        <canvas id="habitChart"></canvas>
      </div>
      <div class="card">
        <h3>📈 Daily Momentum (Last 14 Days)</h3>
        <canvas id="dailyChart"></canvas>
      </div>
    </div>

    <script>
      async function addHabit(f) {
        await fetch('/habits/api/add', {method:'POST', body:new FormData(f)});
        location.reload();
      }
      async function toggle(habitId, date) {
        const fd = new FormData(); fd.append('habitId', habitId); fd.append('date', date);
        await fetch('/habits/api/toggle', {method:'POST', body:fd});
        location.reload();
      }

      // Render Charts
      const habitNames = ${JSON.stringify(habitScores.map(h => h.name))};
      const habitData = ${JSON.stringify(habitScores.map(h => h.completed))};
      
      new Chart(document.getElementById('habitChart'), {
        type: 'bar',
        data: { labels: habitNames, datasets: [{ label: 'Days Completed (30d)', data: habitData, backgroundColor: '#03dac6' }] },
        options: { scales: { y: { beginAtZero: true, max: 30 } }, plugins:{legend:{labels:{color:'#fff'}}} }
      });

      // Daily Momentum Prep
      const days = ${JSON.stringify(days)};
      const logs = ${JSON.stringify(logs)};
      const dailyTotals = days.map(d => logs.filter(l => l.date === d && l.completed).length);

      new Chart(document.getElementById('dailyChart'), {
        type: 'line',
        data: { labels: days.map(d=>d.slice(5)), datasets: [{ label: 'Habits Completed', data: dailyTotals, borderColor: '#bb86fc', tension: 0.3, fill:true, backgroundColor:'rgba(187,134,252,0.1)' }] },
        options: { scales: { y: { beginAtZero: true } } }
      });
    </script>
  </body></html>`;
}