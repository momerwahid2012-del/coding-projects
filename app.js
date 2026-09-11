const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.sqlite');
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';
const db = new sqlite3.Database(DB_FILE);

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
    description TEXT DEFAULT '',
    screenshot_url TEXT DEFAULT '',
    live_demo_url TEXT DEFAULT '',
    source_code_url TEXT DEFAULT '',
    category TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function configureAdminFromEnvironment() {
  const email = String(process.env.ADMIN_EMAIL || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const forceReset = process.env.ADMIN_FORCE_RESET === 'true';
  if (!email || !password) return;

  bcrypt.hash(password, 10).then(hash => {
    db.get('SELECT id FROM admins WHERE email = ?', [email], (lookupError, admin) => {
      if (lookupError) return console.error('Could not configure admin:', lookupError.message);
      if (admin && !forceReset) return console.log(`Admin already exists: ${email}`);

      const query = admin
        ? 'UPDATE admins SET password_hash = ? WHERE id = ?'
        : 'INSERT INTO admins (email, password_hash) VALUES (?, ?)';
      const values = admin ? [hash, admin.id] : [email, hash];
      db.run(query, values, err => {
        if (err) console.error('Could not configure admin:', err.message);
        else console.log(`Admin ${admin ? 'password reset' : 'created'}: ${email}`);
      });
    });
  }).catch(err => console.error('Could not hash admin password:', err.message));
}

configureAdminFromEnvironment();

if (process.argv[2] === 'create-admin') {
  const email = process.argv[3];
  const password = process.argv[4];
  if (!email || !password) {
    console.error('Usage: node app.js create-admin email password');
    process.exit(1);
  }
  bcrypt.hash(password, 10).then(hash => {
    db.run('INSERT INTO admins (email, password_hash) VALUES (?, ?)', [email, hash], err => {
      if (err) console.error('Could not create admin:', err.message);
      else console.log(`Admin created: ${email}`);
      process.exit(err ? 1 : 0);
    });
  });
} else {
  startServer();
}

function startServer() {
  app.use(express.json({ limit: '1mb' }));
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 }
  }));
  app.use(express.static(__dirname, { index: 'index.html' }));

  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

  app.get('/api/projects', (req, res) => {
    const query = String(req.query.q || '').trim();
    const like = `%${query}%`;
    const sql = query
      ? `SELECT * FROM projects WHERE CAST(day_number AS TEXT) LIKE ? OR title LIKE ? OR description LIKE ? OR category LIKE ? ORDER BY day_number DESC, id DESC`
      : 'SELECT * FROM projects ORDER BY day_number DESC, id DESC';
    const params = query ? [like, like, like, like] : [];
    db.all(sql, params, (err, projects) => {
      if (err) return res.status(500).json({ error: 'Could not load projects.' });
      res.json(projects);
    });
  });

  app.get('/api/projects/:id', (req, res) => {
    db.get('SELECT * FROM projects WHERE id = ?', [req.params.id], (err, project) => {
      if (err) return res.status(500).json({ error: 'Could not load project.' });
      if (!project) return res.status(404).json({ error: 'Project not found.' });
      res.json(project);
    });
  });

  app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    db.get('SELECT * FROM admins WHERE email = ?', [email.trim()], async (err, admin) => {
      if (err) return res.status(500).json({ error: 'Login is unavailable.' });
      if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
      }
      req.session.admin = { id: admin.id, email: admin.email };
      res.json({ email: admin.email });
    });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/session', (req, res) => {
    res.json({ authenticated: Boolean(req.session.admin), email: req.session.admin?.email || null });
  });

  app.put('/api/account', requireAdmin, async (req, res) => {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
    if (password && password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    try {
      const hash = password ? await bcrypt.hash(password, 10) : null;
      const sql = hash
        ? 'UPDATE admins SET email = ?, password_hash = ? WHERE id = ?'
        : 'UPDATE admins SET email = ? WHERE id = ?';
      const params = hash ? [email, hash, req.session.admin.id] : [email, req.session.admin.id];
      db.run(sql, params, function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'That email is already in use.' });
          return res.status(500).json({ error: 'Could not update account.' });
        }
        req.session.admin.email = email;
        res.json({ email });
      });
    } catch (error) {
      res.status(500).json({ error: 'Could not update account.' });
    }
  });

  app.use('/api/projects', requireAdmin);
  app.post('/api/projects', saveProject);
  app.put('/api/projects/:id', saveProject);
  app.delete('/api/projects/:id', (req, res) => {
    db.run('DELETE FROM projects WHERE id = ?', [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: 'Could not delete project.' });
      if (!this.changes) return res.status(404).json({ error: 'Project not found.' });
      res.json({ ok: true });
    });
  });

  app.listen(PORT, () => console.log(`Rehan portfolio running at http://localhost:${PORT}`));
}

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Admin login required.' });
}

function projectValues(body) {
  const day = body.day_number === '' || body.day_number === undefined || body.day_number === null
    ? 0
    : Number(body.day_number);
  const title = String(body.title || '').trim();
  if (!Number.isInteger(day) || day < 0 || !title) return null;
  return [
    day,
    title,
    String(body.description || '').trim(),
    String(body.screenshot_url || '').trim(),
    String(body.live_demo_url || '').trim(),
    String(body.source_code_url || '').trim(),
    String(body.category || '').trim()
  ];
}

function saveProject(req, res) {
  const values = projectValues(req.body || {});
  if (!values) return res.status(400).json({ error: 'Project title is required. Day number must be a whole number when provided.' });
  const fields = 'day_number, title, description, screenshot_url, live_demo_url, source_code_url, category';
  if (req.method === 'POST') {
    db.run(`INSERT INTO projects (${fields}) VALUES (?, ?, ?, ?, ?, ?, ?)`, values, function (err) {
      if (err) return res.status(500).json({ error: 'Could not save project.' });
      db.get('SELECT * FROM projects WHERE id = ?', [this.lastID], (getErr, project) => {
        if (getErr) return res.status(500).json({ error: 'Project saved but could not be loaded.' });
        res.status(201).json(project);
      });
    });
  } else {
    db.run(`UPDATE projects SET day_number = ?, title = ?, description = ?, screenshot_url = ?, live_demo_url = ?, source_code_url = ?, category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, req.params.id], function (err) {
      if (err) return res.status(500).json({ error: 'Could not update project.' });
      if (!this.changes) return res.status(404).json({ error: 'Project not found.' });
      db.get('SELECT * FROM projects WHERE id = ?', [req.params.id], (getErr, project) => {
        if (getErr) return res.status(500).json({ error: 'Project updated but could not be loaded.' });
        res.json(project);
      });
    });
  }
}
