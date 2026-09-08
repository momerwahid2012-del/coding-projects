/**
 * app.js
 * Minimal portfolio server (single-file)
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
 *   SESSION_SECRET (default provided)
 *
 * Notes:
 *   - Screenshot is a URL field (optional) to avoid file uploads and keep repo tiny.
 *   - DB file: data.sqlite (created automatically).
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'rehan-portfolio-secret';
const DB_FILE = path.join(__dirname, 'data.sqlite');

const db = new sqlite3.Database(DB_FILE);

// Initialize DB
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
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Simple middleware to expose admin to templates
app.use((req, res, next) => {
  res.locals.admin = req.session && req.session.admin;
  next();
});

// --- Templates (inline) ---
function layout(title, bodyHtml, req) {
  const adminLinks = req && req.session && req.session.admin
    ? `<a href="/admin/dashboard">Admin</a> <a href="/admin/logout">Logout</a>`
    : `<a href="/admin">Admin Login</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#f7f8fb;--card:#fff;--muted:#6b7280;--accent:#2563eb;--max-width:1100px;--radius:10px}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,Arial;background:var(--bg);color:#111}
.container{max-width:var(--max-width);margin:0 auto;padding:20px}
.header{background:linear-gradient(90deg,#fff,#f8fafc);border-bottom:1px solid #e6e9ef;padding:12px 20px;display:flex;justify-content:space-between;align-items:center}
.brand{font-weight:700;text-decoration:none;color:#111}
.header a{margin-left:12px;color:var(--muted);text-decoration:none}
.hero{text-align:center;padding:28px 0}
.search{margin-top:14px;display:flex;justify-content:center;gap:8px}
.search input{width:60%;max-width:520px;padding:10px;border-radius:8px;border:1px solid #e2e8f0}
.search button{background:var(--accent);color:#fff;border:none;padding:10px 14px;border-radius:8px;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:18px}
.card{background:var(--card);padding:14px;border-radius:10px;box-shadow:0 6px 18px rgba(15,23,42,0.06)}
.day{background:#eef2ff;color:#1e3a8a;padding:6px 10px;border-radius:8px;font-weight:600;display:inline-block}
.screenshot{width:100%;height:150px;object-fit:cover;border-radius:8px;margin-top:10px}
.footer{padding:18px;text-align:center;color:var(--muted)}
.form{background:var(--card);padding:16px;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,0.06);max-width:760px;margin:12px auto}
.input, textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #e6e9ef;margin-top:6px}
.btn{background:var(--accent);color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;border:none;cursor:pointer}
.small{font-size:13px;color:var(--muted)}
.table{width:100%;border-collapse:collapse;margin-top:12px}
.table th,.table td{padding:8px;border-bottom:1px solid #f1f5f9;text-align:left}
.actions a, .actions form{display:inline-block;margin-right:8px}
@media(max-width:700px){.search input{width:100%}.header{flex-direction:column;align-items:flex-start;gap:8px}}
</style>
</head>
<body>
<header class="header container">
  <a class="brand" href="/">Rehan School Coding Projects</a>
  <nav>${adminLinks}</nav>
</header>
<main class="container">${bodyHtml}</main>
<footer class="footer container"><small>Built for Rehan School coding tasks</small></footer>
</body>
</html>`;
}

// --- Helpers ---
function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- Public routes ---

// Home with search
app.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = `SELECT id, day_number, title, description, screenshot_url, live_demo_url, source_code_url, category FROM projects`;
  const params = [];
  if (q) {
    sql += ` WHERE day_number = ? OR title LIKE ? OR description LIKE ? OR category LIKE ?`;
    params.push(q, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY day_number DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).send('DB error');
    const cards = rows.map(p => {
      return `<article class="card">
        <div><span class="day">Day <strong>${escapeHtml(p.day_number)}</strong></span></div>
        <h3><a href="/projects/${p.id}">${escapeHtml(p.title)}</a></h3>
        ${p.screenshot_url ? `<img class="screenshot" src="${escapeHtml(p.screenshot_url)}" alt="screenshot">` : ''}
        <p class="small">${escapeHtml(p.description ? (p.description.length>140 ? p.description.slice(0,140)+'…' : p.description) : '')}</p>
        <div class="small">${p.category ? `<strong>${escapeHtml(p.category)}</strong>` : ''} ${p.live_demo_url ? `<a href="${escapeHtml(p.live_demo_url)}" target="_blank">Live</a>` : ''} ${p.source_code_url ? `<a href="${escapeHtml(p.source_code_url)}" target="_blank">Code</a>` : ''}</div>
      </article>`;
    }).join('\n') || '<p>No projects yet.</p>';

    const body = `<section class="hero">
      <h1>Rehan School Coding Projects</h1>
      <p class="small">A public list of my coding tasks and projects.</p>
      <form class="search" action="/" method="get">
        <input name="q" placeholder="Search by day, title, description, category" value="${escapeHtml(q)}" />
        <button class="btn" type="submit">Search</button>
      </form>
    </section>
    <section class="grid">${cards}</section>`;

    res.send(layout('Home', body, req));
  });
});

// Project detail
app.get('/projects/:id', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM projects WHERE id = ?`, [id], (err, p) => {
    if (err) return res.status(500).send('DB error');
    if (!p) return res.status(404).send('Not found');
    const body = `<article>
      <div><span class="day">Day <strong>${escapeHtml(p.day_number)}</strong></span></div>
      <h1>${escapeHtml(p.title)}</h1>
      ${p.category ? `<div class="small">${escapeHtml(p.category)}</div>` : ''}
      ${p.screenshot_url ? `<img class="screenshot" src="${escapeHtml(p.screenshot_url)}" alt="screenshot">` : ''}
      <div class="form"><p>${escapeHtml(p.description || '')}</p>
      <p>${p.live_demo_url ? `<a class="btn" href="${escapeHtml(p.live_demo_url)}" target="_blank">View Live Demo</a>` : ''} ${p.source_code_url ? `<a class="btn" href="${escapeHtml(p.source_code_url)}" target="_blank">View Source Code</a>` : ''}</p></div>
    </article>`;
    res.send(layout(p.title, body, req));
  });
});

// --- Admin routes ---

// Login page & handler
app.get('/admin', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/dashboard');
  const body = `<section class="form">
    <h2>Admin Login</h2>
    ${req.query.e ? `<div style="color:#b91c1c;padding:8px;border-radius:6px;background:#fff1f2">${escapeHtml(req.query.e)}</div>` : ''}
    <form method="post" action="/admin/login">
      <label>Email<input class="input" type="email" name="email" required></label>
      <label>Password<input class="input" type="password" name="password" required></label>
      <div style="margin-top:8px"><button class="btn" type="submit">Login</button></div>
    </form>
    <p class="small">Create admin with: <code>node app.js create-admin email password</code></p>
  </section>`;
  res.send(layout('Admin Login', body, req));
});

app.post('/admin/login', (req, res) => {
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
  req.session.destroy(() => res.redirect('/'));
});

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.redirect('/admin');
}

// Dashboard
app.get('/admin/dashboard', requireAuth, (req, res) => {
  db.all(`SELECT * FROM projects ORDER BY day_number DESC`, [], (err, rows) => {
    if (err) return res.status(500).send('DB error');
    const rowsHtml = rows.map(p => `<tr>
      <td>${escapeHtml(p.day_number)}</td>
      <td>${escapeHtml(p.title)}</td>
      <td>${escapeHtml(p.category || '')}</td>
      <td class="actions">
        <a href="/projects/${p.id}" target="_blank">View</a>
        <a href="/admin/edit/${p.id}">Edit</a>
        <form method="post" action="/admin/delete/${p.id}" style="display:inline" onsubmit="return confirm('Delete this project?');">
          <button style="background:none;border:none;color:#2563eb;cursor:pointer" type="submit">Delete</button>
        </form>
      </td>
    </tr>`).join('\n') || '<tr><td colspan="4">No projects yet.</td></tr>';

    const body = `<section class="form">
      <h2>Admin Dashboard</h2>
      <p><a class="btn" href="/admin/new">Add New Project</a></p>
      <table class="table"><thead><tr><th>Day</th><th>Title</th><th>Category</th><th>Actions</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    </section>`;
    res.send(layout('Admin Dashboard', body, req));
  });
});

// New project form
app.get('/admin/new', requireAuth, (req, res) => {
  const body = renderProjectForm();
  res.send(layout('Add Project', body, req));
});

// Create project
app.post('/admin/new', requireAuth, (req, res) => {
  const { day_number, title, description, screenshot_url, live_demo_url, source_code_url, category } = req.body;
  if (!day_number || !title) {
    return res.send(layout('Add Project', renderProjectForm(req.body, 'Day Number and Title are required'), req));
  }
  db.run(`INSERT INTO projects (day_number,title,description,screenshot_url,live_demo_url,source_code_url,category) VALUES (?,?,?,?,?,?,?)`,
    [day_number, title, description || null, screenshot_url || null, live_demo_url || null, source_code_url || null, category || null],
    function (err) {
      if (err) return res.status(500).send('DB error');
      res.redirect('/admin/dashboard');
    });
});

// Edit form
app.get('/admin/edit/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM projects WHERE id = ?`, [id], (err, p) => {
    if (err) return res.status(500).send('DB error');
    if (!p) return res.status(404).send('Not found');
    const body = renderProjectForm(p, null, `/admin/edit/${id}`, 'POST', true);
    res.send(layout('Edit Project', body, req));
  });
});

// Update
app.post('/admin/edit/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const { day_number, title, description, screenshot_url, live_demo_url, source_code_url, category, remove_screenshot } = req.body;
  if (!day_number || !title) {
    return res.send(layout('Edit Project', renderProjectForm(Object.assign({}, req.body, { id }), 'Day Number and Title are required', `/admin/edit/${id}`, 'POST', true), req));
  }
  const finalScreenshot = remove_screenshot ? null : (screenshot_url || null);
  db.run(`UPDATE projects SET day_number=?, title=?, description=?, screenshot_url=?, live_demo_url=?, source_code_url=?, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [day_number, title, description || null, finalScreenshot, live_demo_url || null, source_code_url || null, category || null, id],
    function (err) {
      if (err) return res.status(500).send('DB error');
      res.redirect('/admin/dashboard');
    });
});

// Delete
app.post('/admin/delete/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM projects WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).send('DB error');
    res.redirect('/admin/dashboard');
  });
});

// --- Helper to render project form ---
function renderProjectForm(project = {}, error = null, action = '/admin/new', method = 'POST', isEdit = false) {
  return `<section class="form">
    <h2>${isEdit ? 'Edit Project' : 'Add Project'}</h2>
    ${error ? `<div style="color:#b91c1c;padding:8px;border-radius:6px;background:#fff1f2">${escapeHtml(error)}</div>` : ''}
    <form method="${method}" action="${action}">
      <label>Day Number (required)
        <input class="input" type="number" name="day_number" value="${escapeHtml(project.day_number || '')}" required>
      </label>
      <label>Project Title (required)
        <input class="input" type="text" name="title" value="${escapeHtml(project.title || '')}" required>
      </label>
      <label>Description
        <textarea class="input" name="description" rows="4">${escapeHtml(project.description || '')}</textarea>
      </label>
      <label>Category
        <input class="input" type="text" name="category" value="${escapeHtml(project.category || '')}">
      </label>
      <label>Screenshot URL (optional)
        <input class="input" type="url" name="screenshot_url" value="${escapeHtml(project.screenshot_url || '')}">
      </label>
      ${isEdit && project.screenshot_url ? `<div style="margin-top:8px"><img src="${escapeHtml(project.screenshot_url)}" style="max-width:200px;border-radius:8px"><label style="display:block;margin-top:6px"><input type="checkbox" name="remove_screenshot"> Remove screenshot</label></div>` : ''}
      <label>Live Demo URL
        <input class="input" type="url" name="live_demo_url" value="${escapeHtml(project.live_demo_url || '')}">
      </label>
      <label>Source Code URL
        <input class="input" type="url" name="source_code_url" value="${escapeHtml(project.source_code_url || '')}">
      </label>
      <div style="margin-top:10px">
        <button class="btn" type="submit">Save</button>
        <a class="small" href="/admin/dashboard" style="margin-left:12px">Cancel</a>
      </div>
    </form>
  </section>`;
}

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
