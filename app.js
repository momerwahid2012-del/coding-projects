/**
 * app.js
 * Rehan School Coding Projects — single-file portfolio server
 *
 * Usage:
 *   # create admin (one-time)
 *   node app.js create-admin admin@example.com yourpassword
 *
 *   # start server
 *   node app.js
 *
 * Optional env:
 *   PORT (default 3000)
 *   SESSION_SECRET (set this in Codespaces! see README)
 *
 * Notes:
 *   - Screenshot is a URL field (optional) to avoid file uploads and keep repo tiny.
 *   - DB file: data.sqlite (created automatically, compatible with the old schema).
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'rehan-portfolio-secret';
const DB_FILE = path.join(__dirname, 'data.sqlite');
const PAGE_SIZE = 9;

if (!process.env.SESSION_SECRET) {
  console.warn('⚠  SESSION_SECRET is not set — using an insecure default. Set it in your .env file.');
}

const db = new sqlite3.Database(DB_FILE);

// Initialize DB (unchanged schema — safe to run against an existing data.sqlite)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    screenshot_url TEXT,
    live_demo_url TEXT,
    source_code_url TEXT,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// CLI: create-admin
if (process.argv[2] === 'create-admin') {
  const email = process.argv[3];
  const password = process.argv[4];
  if (!email || !password) {
    console.error('Usage: node app.js create-admin email password');
    process.exit(1);
  }
  (async () => {
    try {
      const hash = await bcrypt.hash(password, 10);
      db.run(`INSERT INTO admins (email, password_hash) VALUES (?, ?)`, [email, hash], function (err) {
        if (err) {
          console.error('Error creating admin:', err.message);
          process.exit(1);
        }
        console.log('Admin created:', email);
        process.exit(0);
      });
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  })();
  return;
}

// --- Express app ---
const app = express();

// Security headers. CSP is disabled because the whole UI is inline <style>/<script>
// in this single-file app — re-enable and configure it if you split assets out later.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Try again in a few minutes.'
});

app.use((req, res, next) => {
  res.locals.admin = req.session && req.session.admin;
  next();
});

// --- Helpers ---
function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function padDay(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return escapeHtml(n);
  return String(num).padStart(3, '0');
}

// Deterministic accent colour per category, so the same category always
// gets the same colour without needing to store one.
const CATEGORY_PALETTE = ['#D98E2B', '#2F6F5E', '#4A6FA5', '#B0432B', '#7A5CC0', '#3E8E7E', '#B0812F'];
function categoryColor(cat) {
  if (!cat) return 'var(--muted)';
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = cat.charCodeAt(i) + ((hash << 5) - hash);
  return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d.replace(' ', 'T') + 'Z');
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Builds a query string from current params, overriding some keys — used to
// keep filters/search/sort intact across pagination and sort links.
function withParams(base, overrides) {
  const merged = Object.assign({}, base, overrides);
  const parts = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// --- Layout / design system ---
function layout(title, bodyHtml, req, opts = {}) {
  const adminLinks = req && req.session && req.session.admin
    ? `<a href="/admin/dashboard">Dashboard</a><a href="/admin/logout">Log out</a>`
    : `<a href="/admin">Admin</a>`;

  const flash = req.query.msg
    ? `<div class="toast toast-${escapeHtml(req.query.type === 'error' ? 'error' : 'ok')}" role="status">
        <span>${escapeHtml(req.query.msg)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()" aria-label="Dismiss">×</button>
      </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)} · Rehan School Coding Projects</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%23101620"/><text x="16" y="22" font-family="monospace" font-size="18" fill="%23E2A63A" text-anchor="middle">/&gt;</text></svg>')}" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#EEF1F6; --paper:#FFFFFF; --ink:#1B2333; --muted:#5C6579; --border:#DBE0EA;
  --accent:#D98E2B; --accent-ink:#5B3B0C; --teal:#2F6F5E; --danger:#B0432B;
  --radius:4px; --max-width:1120px;
  --shadow:0 1px 2px rgba(27,35,51,0.06);
}
html[data-theme="dark"]{
  --bg:#101620; --paper:#171E2A; --ink:#ECEAE2; --muted:#95A0B4; --border:#28303F;
  --accent:#E2A63A; --accent-ink:#2A1B03; --teal:#4FA98A; --danger:#E2665A;
  --shadow:0 1px 3px rgba(0,0,0,0.4);
}
*{box-sizing:border-box}
body{margin:0;font-family:'IBM Plex Sans',system-ui,Arial,sans-serif;background:var(--bg);color:var(--ink);
  transition:background .15s ease,color .15s ease;}
.mono{font-family:'IBM Plex Mono',Consolas,monospace;}
a{color:var(--teal)}
.container{max-width:var(--max-width);margin:0 auto;padding:0 20px}
.header{background:var(--paper);border-bottom:1px solid var(--border);padding:14px 0;position:sticky;top:0;z-index:20}
.header .container{display:flex;justify-content:space-between;align-items:center;gap:12px}
.brand{font-weight:600;text-decoration:none;color:var(--ink);font-size:17px;display:flex;align-items:baseline;gap:8px}
.brand .mono{color:var(--accent);font-size:14px}
.header nav{display:flex;align-items:center;gap:18px}
.header nav a{color:var(--muted);text-decoration:none;font-size:14px;font-weight:500}
.header nav a:hover{color:var(--ink)}
.theme-toggle{background:none;border:1px solid var(--border);border-radius:var(--radius);width:32px;height:32px;
  cursor:pointer;color:var(--ink);display:flex;align-items:center;justify-content:center;font-size:15px}
.theme-toggle:hover{border-color:var(--accent)}

.hero{padding:44px 0 18px;border-bottom:1px solid var(--border);margin-bottom:28px}
.hero .stamp{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--muted);
  border:1px solid var(--border);border-radius:999px;padding:3px 10px;margin-bottom:14px}
.hero h1{font-size:28px;line-height:1.25;margin:0 0 8px;font-weight:600;max-width:640px}
.hero p{color:var(--muted);margin:0 0 20px;max-width:60ch}

.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.filters input[type=text]{flex:1;min-width:180px}
.filters input,.filters select{padding:9px 12px;border-radius:var(--radius);border:1px solid var(--border);
  background:var(--paper);color:var(--ink);font-size:14px;font-family:inherit}
.filters .prompt{font-family:'IBM Plex Mono',monospace;color:var(--accent);align-self:center}
.btn{background:var(--ink);color:var(--paper);border:none;padding:9px 16px;border-radius:var(--radius);
  cursor:pointer;font-size:14px;font-weight:500;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.btn:hover{opacity:.88}
.btn-accent{background:var(--accent);color:var(--accent-ink)}
.btn-outline{background:transparent;color:var(--ink);border:1px solid var(--border)}
.btn-outline:hover{border-color:var(--ink)}
.btn-danger{background:transparent;color:var(--danger);border:1px solid var(--danger);padding:6px 12px;font-size:13px}
.btn-sm{padding:6px 12px;font-size:13px}

.result-meta{display:flex;justify-content:space-between;align-items:center;margin:22px 0 14px;color:var(--muted);font-size:13px}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:8px}
.card{background:var(--paper);border:1px solid var(--border);border-left:4px solid var(--cat-color,var(--accent));
  border-radius:0 var(--radius) var(--radius) 0;box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden}
.card-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
.day-tag{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--cat-color,var(--accent));font-weight:600}
.card h3{margin:0;font-size:17px;font-weight:600;line-height:1.35}
.card h3 a{color:var(--ink);text-decoration:none}
.card h3 a:hover{color:var(--teal)}
.screenshot{width:100%;height:150px;object-fit:cover;display:block;background:var(--bg)}
.card p.desc{color:var(--muted);font-size:14px;line-height:1.5;margin:0;flex:1}
.chip{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb, var(--cat-color, var(--accent)) 16%, transparent);
  color:var(--cat-color,var(--accent));font-weight:600;width:fit-content}
.card-links{display:flex;gap:14px;font-size:13px;margin-top:2px}
.card-links a{text-decoration:none;font-weight:500}

.empty{text-align:center;padding:60px 20px;color:var(--muted)}
.empty .mono{display:block;font-size:13px;margin-bottom:8px}

.pagination{display:flex;justify-content:center;gap:8px;align-items:center;margin:28px 0 44px;font-size:14px}
.pagination a, .pagination span{padding:7px 12px;border-radius:var(--radius);border:1px solid var(--border);
  text-decoration:none;color:var(--ink)}
.pagination .current{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.pagination .disabled{opacity:.4;pointer-events:none}

.footer{padding:28px 0 40px;text-align:center;color:var(--muted);font-size:13px}
.footer .mono{color:var(--muted)}

.form-page{max-width:760px;margin:0 auto}
.panel{background:var(--paper);border:1px solid var(--border);border-radius:var(--radius);padding:22px 24px;box-shadow:var(--shadow)}
.panel h2{margin-top:0;font-size:20px}
.field{margin-bottom:14px}
.field label{display:block;font-size:13.5px;font-weight:500;margin-bottom:5px;color:var(--muted)}
.input, textarea, select.input{width:100%;padding:10px 12px;border-radius:var(--radius);border:1px solid var(--border);
  background:var(--bg);color:var(--ink);font-family:inherit;font-size:14px}
.input:focus, textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.hint{font-size:12.5px;color:var(--muted);margin-top:4px}
.error-box{color:var(--danger);padding:10px 12px;border-radius:var(--radius);background:color-mix(in srgb, var(--danger) 12%, transparent);margin-bottom:16px;font-size:14px}
.field-row{display:flex;gap:14px}
.field-row .field{flex:1}
.checkbox-row{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--muted);margin-top:8px}

.stats{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px}
.stat{background:var(--paper);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;min-width:130px}
.stat .num{font-family:'IBM Plex Mono',monospace;font-size:24px;font-weight:600;color:var(--accent)}
.stat .label{font-size:12.5px;color:var(--muted);margin-top:2px}

.table-wrap{background:var(--paper);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.table{width:100%;border-collapse:collapse;font-size:14px}
.table th{text-align:left;font-size:12.5px;color:var(--muted);font-weight:600;padding:10px 14px;border-bottom:1px solid var(--border)}
.table td{padding:11px 14px;border-bottom:1px solid var(--border);vertical-align:middle}
.table tr:last-child td{border-bottom:none}
.table tr:hover{background:var(--bg)}
.actions{display:flex;gap:10px;align-items:center}
.actions a{font-size:13px;text-decoration:none;color:var(--teal)}
.actions form{display:inline}

.toast{position:fixed;top:16px;right:16px;z-index:50;background:var(--paper);border:1px solid var(--border);
  border-left:4px solid var(--teal);box-shadow:var(--shadow);border-radius:var(--radius);padding:11px 14px;
  display:flex;align-items:center;gap:12px;font-size:14px;max-width:320px}
.toast-error{border-left-color:var(--danger)}
.toast-close{background:none;border:none;font-size:16px;cursor:pointer;color:var(--muted);line-height:1}

.login-wrap{max-width:380px;margin:70px auto}

@media(max-width:700px){
  .header .container{flex-wrap:wrap}
  .header nav{gap:12px;font-size:13px}
  .filters input[type=text]{width:100%}
  .field-row{flex-direction:column;gap:0}
  .table th:nth-child(3),.table td:nth-child(3){display:none}
}
</style>
</head>
<body>
${flash}
<header class="header">
  <div class="container">
    <a class="brand" href="/">Rehan School <span class="mono">/&gt; coding-log</span></a>
    <nav>
      ${adminLinks}
      <button class="theme-toggle" id="themeToggle" title="Toggle theme" aria-label="Toggle theme">◐</button>
    </nav>
  </div>
</header>
<main class="container">${bodyHtml}</main>
<footer class="footer container">
  <span class="mono">// built for Rehan School coding tasks</span>
</footer>
<script>
(function(){
  var root = document.documentElement;
  var saved = localStorage.getItem('theme');
  var initial = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (initial === 'dark') root.setAttribute('data-theme','dark');
  var btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', function(){
    var isDark = root.getAttribute('data-theme') === 'dark';
    if (isDark) { root.removeAttribute('data-theme'); localStorage.setItem('theme','light'); }
    else { root.setAttribute('data-theme','dark'); localStorage.setItem('theme','dark'); }
  });
  var toast = document.querySelector('.toast');
  if (toast) setTimeout(function(){ toast.remove(); }, 5000);
})();
</script>
</body>
</html>`;
}

function projectCard(p) {
  const color = categoryColor(p.category);
  const desc = p.description ? (p.description.length > 130 ? p.description.slice(0, 130) + '…' : p.description) : '';
  return `<article class="card" style="--cat-color:${color}">
    ${p.screenshot_url ? `<img class="screenshot" src="${escapeHtml(p.screenshot_url)}" alt="${escapeHtml(p.title)} screenshot" loading="lazy">` : ''}
    <div class="card-body">
      <span class="day-tag">day.${padDay(p.day_number)}</span>
      <h3><a href="/projects/${p.id}">${escapeHtml(p.title)}</a></h3>
      ${p.category ? `<span class="chip" style="--cat-color:${color}">${escapeHtml(p.category)}</span>` : ''}
      <p class="desc">${escapeHtml(desc)}</p>
      <div class="card-links">
        ${p.live_demo_url ? `<a href="${escapeHtml(p.live_demo_url)}" target="_blank" rel="noopener">Live demo</a>` : ''}
        ${p.source_code_url ? `<a href="${escapeHtml(p.source_code_url)}" target="_blank" rel="noopener">Source</a>` : ''}
      </div>
    </div>
  </article>`;
}

// --- Public routes ---

app.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  const sort = req.query.sort || 'newest';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const where = [];
  const params = [];
  if (q) {
    where.push(`(day_number = ? OR title LIKE ? OR description LIKE ? OR category LIKE ?)`);
    params.push(Number.isNaN(Number(q)) ? -1 : Number(q), `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category) {
    where.push(`category = ?`);
    params.push(category);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = sort === 'oldest' ? 'day_number ASC' : sort === 'title' ? 'title ASC' : 'day_number DESC';

  db.get(`SELECT COUNT(*) as c FROM projects ${whereSql}`, params, (err, countRow) => {
    if (err) return res.status(500).send('DB error');
    const total = countRow.c;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * PAGE_SIZE;

    db.all(`SELECT id, day_number, title, description, screenshot_url, live_demo_url, source_code_url, category
            FROM projects ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE, offset], (err2, rows) => {
      if (err2) return res.status(500).send('DB error');

      db.all(`SELECT DISTINCT category FROM projects WHERE category IS NOT NULL AND category != '' ORDER BY category`, [], (err3, catRows) => {
        if (err3) return res.status(500).send('DB error');

        db.get(`SELECT COUNT(*) as c, MAX(day_number) as maxDay FROM projects`, [], (err4, meta) => {
          if (err4) return res.status(500).send('DB error');

          const baseParams = { q, category, sort };
          const catOptions = catRows.map(c => `<option value="${escapeHtml(c.category)}" ${c.category === category ? 'selected' : ''}>${escapeHtml(c.category)}</option>`).join('');

          const cards = rows.map(projectCard).join('\n') || `<div class="empty">
            <span class="mono">// no entries found</span>
            Try a different search, or clear your filters.
          </div>`;

          const pager = totalPages > 1 ? `<div class="pagination">
            <a class="${safePage <= 1 ? 'disabled' : ''}" href="/${withParams(baseParams, { page: safePage - 1 })}">← Prev</a>
            <span class="current mono">${safePage} / ${totalPages}</span>
            <a class="${safePage >= totalPages ? 'disabled' : ''}" href="/${withParams(baseParams, { page: safePage + 1 })}">Next →</a>
          </div>` : '';

          const body = `<section class="hero">
            <span class="stamp mono">entry log · ${meta.c} project${meta.c === 1 ? '' : 's'}${meta.maxDay ? ` · through day ${padDay(meta.maxDay)}` : ''}</span>
            <h1>A running log of my coding tasks</h1>
            <p>Every project I build gets logged here — day number, what it does, and links to try it or read the code.</p>
            <form class="filters" action="/" method="get">
              <span class="prompt mono">$</span>
              <input type="text" name="q" placeholder="search by day, title, description…" value="${escapeHtml(q)}">
              <select name="category">
                <option value="">All categories</option>
                ${catOptions}
              </select>
              <select name="sort">
                <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest first</option>
                <option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>Oldest first</option>
                <option value="title" ${sort === 'title' ? 'selected' : ''}>Title A–Z</option>
              </select>
              <button class="btn btn-accent" type="submit">Filter</button>
            </form>
          </section>
          <div class="result-meta">
            <span>${total} result${total === 1 ? '' : 's'}${q ? ` for "${escapeHtml(q)}"` : ''}${category ? ` in ${escapeHtml(category)}` : ''}</span>
          </div>
          <section class="grid">${cards}</section>
          ${pager}`;

          res.send(layout('Home', body, req));
        });
      });
    });
  });
});

// Project detail
app.get('/projects/:id', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM projects WHERE id = ?`, [id], (err, p) => {
    if (err) return res.status(500).send('DB error');
    if (!p) return res.status(404).send(layout('Not found', `<div class="empty"><span class="mono">// 404</span>That project doesn't exist. <a href="/">Back to the log</a>.</div>`, req));
    const color = categoryColor(p.category);
    const body = `<article class="form-page" style="max-width:760px">
      <span class="day-tag" style="--cat-color:${color}">day.${padDay(p.day_number)}</span>
      <h1 style="margin:6px 0 4px">${escapeHtml(p.title)}</h1>
      ${p.category ? `<span class="chip" style="--cat-color:${color}">${escapeHtml(p.category)}</span>` : ''}
      ${p.screenshot_url ? `<img class="screenshot" style="height:auto;border-radius:var(--radius);margin-top:18px" src="${escapeHtml(p.screenshot_url)}" alt="${escapeHtml(p.title)} screenshot">` : ''}
      <div class="panel" style="margin-top:18px">
        <p style="margin:0;line-height:1.7;white-space:pre-wrap">${escapeHtml(p.description || 'No description yet.')}</p>
        <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
          ${p.live_demo_url ? `<a class="btn btn-accent" href="${escapeHtml(p.live_demo_url)}" target="_blank" rel="noopener">View live demo</a>` : ''}
          ${p.source_code_url ? `<a class="btn btn-outline" href="${escapeHtml(p.source_code_url)}" target="_blank" rel="noopener">View source</a>` : ''}
        </div>
      </div>
      <p style="margin-top:16px"><a href="/">← Back to all projects</a></p>
    </article>`;
    res.send(layout(p.title, body, req));
  });
});

// --- Admin routes ---

app.get('/admin', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/dashboard');
  const body = `<div class="login-wrap">
    <div class="panel">
      <h2>Admin login</h2>
      ${req.query.e ? `<div class="error-box">${escapeHtml(req.query.e)}</div>` : ''}
      <form method="post" action="/admin/login">
        <div class="field"><label>Email</label><input class="input" type="email" name="email" required autofocus></div>
        <div class="field"><label>Password</label><input class="input" type="password" name="password" required></div>
        <button class="btn btn-accent" style="width:100%;justify-content:center" type="submit">Log in</button>
      </form>
      <p class="hint" style="margin-top:14px">First time? Create an admin from the terminal:<br><span class="mono">node app.js create-admin email password</span></p>
    </div>
  </div>`;
  res.send(layout('Admin Login', body, req));
});

app.post('/admin/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM admins WHERE email = ?`, [email], async (err, admin) => {
    if (err) return res.status(500).send('DB error');
    if (!admin) return res.redirect('/admin?e=Invalid+credentials');
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.redirect('/admin?e=Invalid+credentials');
    req.session.admin = { id: admin.id, email: admin.email };
    res.redirect('/admin/dashboard');
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/?msg=Logged+out'));
});

function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.redirect('/admin');
}

// Dashboard
app.get('/admin/dashboard', requireAuth, (req, res) => {
  db.all(`SELECT * FROM projects ORDER BY day_number DESC`, [], (err, rows) => {
    if (err) return res.status(500).send('DB error');
    const categories = new Set(rows.map(r => r.category).filter(Boolean));
    const lastUpdated = rows.reduce((acc, r) => (r.updated_at > acc ? r.updated_at : acc), '');

    const rowsHtml = rows.map(p => `<tr>
      <td class="mono">${padDay(p.day_number)}</td>
      <td>${escapeHtml(p.title)}</td>
      <td>${p.category ? `<span class="chip" style="--cat-color:${categoryColor(p.category)}">${escapeHtml(p.category)}</span>` : ''}</td>
      <td class="actions">
        <a href="/projects/${p.id}" target="_blank">View</a>
        <a href="/admin/edit/${p.id}">Edit</a>
        <form method="post" action="/admin/delete/${p.id}" onsubmit="return confirm('Delete “${escapeHtml(p.title).replace(/"/g, '')}”? This can\\'t be undone.');">
          <button class="btn-danger btn-sm" style="border:none;background:none;padding:0;cursor:pointer;color:var(--danger)" type="submit">Delete</button>
        </form>
      </td>
    </tr>`).join('\n') || `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px">No projects logged yet.</td></tr>`;

    const body = `<section>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <h2 style="margin:0">Dashboard</h2>
        <a class="btn btn-accent" href="/admin/new">+ New project</a>
      </div>
      <div class="stats">
        <div class="stat"><div class="num">${rows.length}</div><div class="label">Total projects</div></div>
        <div class="stat"><div class="num">${categories.size}</div><div class="label">Categories</div></div>
        <div class="stat"><div class="num">${rows.length ? padDay(rows[0].day_number) : '—'}</div><div class="label">Latest day</div></div>
        <div class="stat"><div class="num" style="font-size:15px">${lastUpdated ? fmtDate(lastUpdated) : '—'}</div><div class="label">Last updated</div></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Day</th><th>Title</th><th>Category</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </section>`;
    res.send(layout('Admin Dashboard', body, req));
  });
});

app.get('/admin/new', requireAuth, (req, res) => {
  res.send(layout('Add Project', renderProjectForm(), req));
});

app.post('/admin/new', requireAuth, (req, res) => {
  const { day_number, title, description, screenshot_url, live_demo_url, source_code_url, category } = req.body;
  if (!day_number || !title) {
    return res.send(layout('Add Project', renderProjectForm(req.body, 'Day number and title are required'), req));
  }
  db.run(`INSERT INTO projects (day_number,title,description,screenshot_url,live_demo_url,source_code_url,category) VALUES (?,?,?,?,?,?,?)`,
    [day_number, title, description || null, screenshot_url || null, live_demo_url || null, source_code_url || null, category || null],
    function (err) {
      if (err) return res.status(500).send('DB error');
      res.redirect('/admin/dashboard?msg=Project+added&type=ok');
    });
});

app.get('/admin/edit/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM projects WHERE id = ?`, [id], (err, p) => {
    if (err) return res.status(500).send('DB error');
    if (!p) return res.status(404).send('Not found');
    res.send(layout('Edit Project', renderProjectForm(p, null, `/admin/edit/${id}`, 'POST', true), req));
  });
});

app.post('/admin/edit/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const { day_number, title, description, screenshot_url, live_demo_url, source_code_url, category, remove_screenshot } = req.body;
  if (!day_number || !title) {
    return res.send(layout('Edit Project', renderProjectForm(Object.assign({}, req.body, { id }), 'Day number and title are required', `/admin/edit/${id}`, 'POST', true), req));
  }
  const finalScreenshot = remove_screenshot ? null : (screenshot_url || null);
  db.run(`UPDATE projects SET day_number=?, title=?, description=?, screenshot_url=?, live_demo_url=?, source_code_url=?, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [day_number, title, description || null, finalScreenshot, live_demo_url || null, source_code_url || null, category || null, id],
    function (err) {
      if (err) return res.status(500).send('DB error');
      res.redirect('/admin/dashboard?msg=Project+updated&type=ok');
    });
});

app.post('/admin/delete/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM projects WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).send('DB error');
    res.redirect('/admin/dashboard?msg=Project+deleted&type=ok');
  });
});

function renderProjectForm(project = {}, error = null, action = '/admin/new', method = 'POST', isEdit = false) {
  return `<div class="form-page">
    <div class="panel">
      <h2>${isEdit ? 'Edit project' : 'Add project'}</h2>
      ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ''}
      <form method="${method}" action="${action}">
        <div class="field-row">
          <div class="field">
            <label>Day number</label>
            <input class="input" type="number" name="day_number" value="${escapeHtml(project.day_number || '')}" required>
          </div>
          <div class="field">
            <label>Category</label>
            <input class="input" type="text" name="category" value="${escapeHtml(project.category || '')}" placeholder="e.g. Web, CLI, Game">
          </div>
        </div>
        <div class="field">
          <label>Project title</label>
          <input class="input" type="text" name="title" value="${escapeHtml(project.title || '')}" required>
        </div>
        <div class="field">
          <label>Description</label>
          <textarea class="input" name="description" rows="5">${escapeHtml(project.description || '')}</textarea>
        </div>
        <div class="field">
          <label>Screenshot URL <span class="hint">optional — link to an image, e.g. from an image host</span></label>
          <input class="input" type="url" name="screenshot_url" value="${escapeHtml(project.screenshot_url || '')}">
          ${isEdit && project.screenshot_url ? `<div style="margin-top:10px">
            <img src="${escapeHtml(project.screenshot_url)}" style="max-width:220px;border-radius:var(--radius);display:block">
            <label class="checkbox-row"><input type="checkbox" name="remove_screenshot"> Remove screenshot</label>
          </div>` : ''}
        </div>
        <div class="field-row">
          <div class="field">
            <label>Live demo URL</label>
            <input class="input" type="url" name="live_demo_url" value="${escapeHtml(project.live_demo_url || '')}">
          </div>
          <div class="field">
            <label>Source code URL</label>
            <input class="input" type="url" name="source_code_url" value="${escapeHtml(project.source_code_url || '')}">
          </div>
        </div>
        <div style="margin-top:6px;display:flex;gap:10px">
          <button class="btn btn-accent" type="submit">Save project</button>
          <a class="btn btn-outline" href="/admin/dashboard">Cancel</a>
        </div>
      </form>
    </div>
  </div>`;
}

// --- 404 ---
app.use((req, res) => {
  res.status(404).send(layout('Not found', `<div class="empty"><span class="mono">// 404</span>Nothing logged at this URL. <a href="/">Back to the log</a>.</div>`, req));
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
