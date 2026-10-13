const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'data.sqlite');
const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const configuredSessionSecret = process.env.SESSION_SECRET;
const SESSION_SECRET = configuredSessionSecret || crypto.randomBytes(48).toString('base64');
const db = new sqlite3.Database(DB_FILE);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    dbGet('SELECT sess, expires_at FROM sessions WHERE sid = ?', [sid]).then(row => {
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        return dbRun('DELETE FROM sessions WHERE sid = ?', [sid])
          .then(() => callback(null, null), callback);
      }
      let storedSession;
      try {
        storedSession = JSON.parse(row.sess);
      } catch (error) {
        return callback(error);
      }
      callback(null, storedSession);
    }, callback);
  }

  set(sid, sessionData, callback) {
    const cookie = sessionData.cookie || {};
    const cookieExpiry = cookie.expires ? new Date(cookie.expires).getTime() : NaN;
    const expiresAt = Number.isFinite(cookieExpiry)
      ? cookieExpiry
      : Date.now() + (Number(cookie.maxAge) || ADMIN_SESSION_TTL_MS);
    dbRun(
      `INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at`,
      [sid, JSON.stringify(sessionData), expiresAt]
    ).then(() => callback(null), callback);
  }

  touch(sid, sessionData, callback) {
    const cookie = sessionData.cookie || {};
    const cookieExpiry = cookie.expires ? new Date(cookie.expires).getTime() : NaN;
    const expiresAt = Number.isFinite(cookieExpiry)
      ? cookieExpiry
      : Date.now() + (Number(cookie.maxAge) || ADMIN_SESSION_TTL_MS);
    dbRun('UPDATE sessions SET sess = ?, expires_at = ? WHERE sid = ?', [
      JSON.stringify(sessionData),
      expiresAt,
      sid
    ])
      .then(() => callback(null), callback);
  }

  destroy(sid, callback) {
    dbRun('DELETE FROM sessions WHERE sid = ?', [sid]).then(() => callback(null), callback);
  }
}

function runOn(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function initializeDatabase() {
  await dbRun(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS projects (
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
  await dbRun(`CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)');
  await dbRun('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]);

  const adminColumns = await dbAll('PRAGMA table_info(admins)');
  if (!adminColumns.some(column => column.name === 'session_version')) {
    await dbRun('ALTER TABLE admins ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
  }

  const projectColumns = await dbAll('PRAGMA table_info(projects)');
  if (!projectColumns.some(column => column.name === 'featured')) {
    await dbRun('ALTER TABLE projects ADD COLUMN featured INTEGER NOT NULL DEFAULT 0');
    await dbRun(
      'UPDATE projects SET featured = 1 WHERE id IN (SELECT id FROM projects ORDER BY day_number DESC, id DESC LIMIT 4)'
    );
  }

}

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
        ? 'UPDATE admins SET password_hash = ?, session_version = session_version + 1 WHERE id = ?'
        : 'INSERT INTO admins (email, password_hash) VALUES (?, ?)';
      const values = admin ? [hash, admin.id] : [email, hash];
      db.run(query, values, err => {
        if (err) console.error('Could not configure admin:', err.message);
        else {
          console.log(`Admin ${admin ? 'password reset' : 'created'}: ${email}`);
        }
      });
    });
  }).catch(err => console.error('Could not hash admin password:', err.message));
}

initializeDatabase().then(() => {
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
}).catch(error => {
  console.error('Could not initialize database:', error.message);
  process.exitCode = 1;
});

function startServer() {
  if (configuredSessionSecret && Buffer.byteLength(configuredSessionSecret, 'utf8') < 32) {
    console.error('SESSION_SECRET must contain at least 32 bytes.');
    process.exitCode = 1;
    return;
  }
  if (process.env.NODE_ENV === 'production' && !process.env.DATA_DIR) {
    console.warn('DATA_DIR is not configured. SQLite is stored beside the application, which may be temporary on Render. Mount a persistent disk and set DATA_DIR to its mount path to keep projects across deployments.');
  }
  if (process.env.NODE_ENV === 'production' && !configuredSessionSecret) {
    console.warn('SESSION_SECRET is not configured. A secure temporary secret was generated; persisted admin sessions will be invalidated when the service restarts. Set SESSION_SECRET in the service environment to keep the secret stable.');
  }
  console.log(`Using SQLite database at ${DB_FILE}`);

  const sessionCleanup = setInterval(() => {
    dbRun('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()])
      .catch(error => console.error('Could not clean expired sessions:', error.message));
  }, 60 * 60 * 1000);
  sessionCleanup.unref();

  app.use(express.json({ limit: '10mb' }));
  if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }
  app.use(session({
    secret: SESSION_SECRET,
    store: new SQLiteSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ADMIN_SESSION_TTL_MS
    }
  }));
  app.use(express.static(__dirname, { index: 'index.html' }));

  app.get('/admin', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.sendFile(path.join(__dirname, 'admin.html'));
  });

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
      req.session.regenerate(sessionError => {
        if (sessionError) return res.status(500).json({ error: 'Login is unavailable.' });
        req.session.admin = { id: admin.id, email: admin.email, version: admin.session_version };
        req.session.save(saveError => {
          if (saveError) return res.status(500).json({ error: 'Login is unavailable.' });
          res.json({ email: admin.email });
        });
      });
    });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/session', (req, res) => {
    if (!req.session.admin) return res.json({ authenticated: false, email: null });
    db.get('SELECT email, session_version FROM admins WHERE id = ?', [req.session.admin.id], (err, admin) => {
      if (err) return res.status(500).json({ error: 'Could not check the admin session.' });
      if (!admin || admin.session_version !== req.session.admin.version) {
        return req.session.destroy(() => res.json({ authenticated: false, email: null }));
      }
      res.json({ authenticated: true, email: admin.email });
    });
  });

  app.get('/api/admin/backup', requireAdmin, async (req, res) => {
    try {
      const projects = await dbAll(
        `SELECT id, day_number, title, COALESCE(description, '') AS description,
          COALESCE(screenshot_url, '') AS screenshot_url,
          COALESCE(live_demo_url, '') AS live_demo_url,
          COALESCE(source_code_url, '') AS source_code_url,
          COALESCE(category, '') AS category, COALESCE(featured, 0) AS featured,
          created_at, updated_at FROM projects ORDER BY id`
      );
      res.set('Cache-Control', 'no-store');
      res.set('Content-Type', 'application/json; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="rehan-project-backup.json"');
      res.json({
        format: 'rehan-school-project-backup',
        version: 1,
        exported_at: new Date().toISOString(),
        projects
      });
    } catch (error) {
      console.error('Could not create project backup:', error.message);
      res.status(500).json({ error: 'Could not create project backup.' });
    }
  });

  app.post('/api/admin/backup/import', requireAdmin, async (req, res) => {
    const backup = req.body;
    if (
      !backup ||
      backup.format !== 'rehan-school-project-backup' ||
      backup.version !== 1 ||
      !Array.isArray(backup.projects) ||
      backup.projects.length > 10000
    ) {
      return res.status(400).json({ error: 'This is not a supported project backup file.' });
    }

    const ids = new Set();
    const projects = [];
    for (const project of backup.projects) {
      if (!project || typeof project !== 'object' || Array.isArray(project)) {
        return res.status(400).json({ error: 'Backup contains an invalid project record.' });
      }
      const projectId = Number(project.id);
      const day = Number(project.day_number ?? 0);
      if (!Number.isSafeInteger(projectId) || projectId < 1 || ids.has(projectId)) {
        return res.status(400).json({ error: 'Backup contains a missing, invalid, or duplicate project ID.' });
      }
      if (!Number.isSafeInteger(day) || day < 0) {
        return res.status(400).json({ error: `Backup contains an invalid day number for project ${projectId}.` });
      }
      if (typeof project.title !== 'string' || !project.title.trim() || project.title.length > 500) {
        return res.status(400).json({ error: `Backup contains an invalid title for project ${projectId}.` });
      }

      const text = (field, maxLength) => {
        const value = project[field] ?? '';
        return typeof value === 'string' && value.length <= maxLength ? value : null;
      };
      const description = text('description', 50000);
      const screenshotUrl = text('screenshot_url', 2048);
      const liveDemoUrl = text('live_demo_url', 2048);
      const sourceCodeUrl = text('source_code_url', 2048);
      const category = text('category', 200);
      if ([description, screenshotUrl, liveDemoUrl, sourceCodeUrl, category].includes(null)) {
        return res.status(400).json({ error: `Backup contains invalid fields for project ${projectId}.` });
      }
      if (![undefined, 0, 1, false, true].includes(project.featured)) {
        return res.status(400).json({ error: `Backup contains an invalid featured value for project ${projectId}.` });
      }

      ids.add(projectId);
      projects.push({
        id: projectId,
        day_number: day,
        title: project.title.trim(),
        description,
        screenshot_url: screenshotUrl,
        live_demo_url: liveDemoUrl,
        source_code_url: sourceCodeUrl,
        category,
        featured: project.featured === true || project.featured === 1 ? 1 : 0,
        created_at: typeof project.created_at === 'string' ? project.created_at : null,
        updated_at: typeof project.updated_at === 'string' ? project.updated_at : null
      });
    }

    const importDb = new sqlite3.Database(DB_FILE);
    importDb.configure('busyTimeout', 5000);
    let transactionStarted = false;
    try {
      await runOn(importDb, 'BEGIN IMMEDIATE');
      transactionStarted = true;
      await runOn(importDb, 'DELETE FROM projects');
      for (const project of projects) {
        await runOn(
          importDb,
          `INSERT INTO projects (
            id, day_number, title, description, screenshot_url, live_demo_url,
            source_code_url, category, featured, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))`,
          [
            project.id,
            project.day_number,
            project.title,
            project.description,
            project.screenshot_url,
            project.live_demo_url,
            project.source_code_url,
            project.category,
            project.featured,
            project.created_at,
            project.updated_at
          ]
        );
      }
      await runOn(importDb, 'COMMIT');
      transactionStarted = false;
      res.json({ imported: projects.length });
    } catch (error) {
      if (transactionStarted) {
        try {
          await runOn(importDb, 'ROLLBACK');
        } catch (rollbackError) {
          console.error('Could not roll back backup import:', rollbackError.message);
        }
      }
      console.error('Could not restore project backup:', error.message);
      res.status(500).json({ error: 'Could not restore project backup. Check the project list and restore a known-good backup if needed.' });
    } finally {
      importDb.close(error => {
        if (error) console.error('Could not close backup import database:', error.message);
      });
    }
  });

  app.put('/api/account', requireAdmin, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const currentPassword = String(req.body?.current_password || '');
    const password = String(req.body?.password || '');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    if (!currentPassword) return res.status(400).json({ error: 'Enter your current password to confirm this change.' });
    if (password && (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72)) {
      return res.status(400).json({ error: 'Use a password that is at least 12 characters and no more than 72 bytes.' });
    }

    try {
      const admin = await dbGet('SELECT password_hash, session_version FROM admins WHERE id = ?', [req.session.admin.id]);
      if (!admin || !(await bcrypt.compare(currentPassword, admin.password_hash))) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      const hash = password ? await bcrypt.hash(password, 12) : admin.password_hash;
      await dbRun(
        'UPDATE admins SET email = ?, password_hash = ?, session_version = session_version + 1 WHERE id = ?',
        [email, hash, req.session.admin.id]
      ).catch(error => {
        if (error.message.includes('UNIQUE')) {
          const conflict = new Error('That email is already in use.');
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      });
      req.session.admin.email = email;
      req.session.admin.version = admin.session_version + 1;
      res.json({ email });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      console.error('Could not update account:', error.message);
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
  if (!req.session.admin) return res.status(401).json({ error: 'Admin login required.' });
  db.get('SELECT session_version FROM admins WHERE id = ?', [req.session.admin.id], (err, admin) => {
    if (err) return res.status(500).json({ error: 'Could not validate the admin session.' });
    if (!admin || admin.session_version !== req.session.admin.version) {
      return req.session.destroy(() => res.status(401).json({ error: 'Admin login required.' }));
    }
    next();
  });
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
    String(body.category || '').trim(),
    body.featured === true || body.featured === 1 ? 1 : 0
  ];
}

function saveProject(req, res) {
  const values = projectValues(req.body || {});
  if (!values) return res.status(400).json({ error: 'Project title is required. Day number must be a whole number when provided.' });
  const fields = 'day_number, title, description, screenshot_url, live_demo_url, source_code_url, category, featured';
  if (req.method === 'POST') {
    db.run(`INSERT INTO projects (${fields}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, values, function (err) {
      if (err) return res.status(500).json({ error: 'Could not save project.' });
      db.get('SELECT * FROM projects WHERE id = ?', [this.lastID], (getErr, project) => {
        if (getErr) return res.status(500).json({ error: 'Project saved but could not be loaded.' });
        res.status(201).json(project);
      });
    });
  } else {
    db.run(`UPDATE projects SET day_number = ?, title = ?, description = ?, screenshot_url = ?, live_demo_url = ?, source_code_url = ?, category = ?, featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, req.params.id], function (err) {
      if (err) return res.status(500).json({ error: 'Could not update project.' });
      if (!this.changes) return res.status(404).json({ error: 'Project not found.' });
      db.get('SELECT * FROM projects WHERE id = ?', [req.params.id], (getErr, project) => {
        if (getErr) return res.status(500).json({ error: 'Project updated but could not be loaded.' });
        res.json(project);
      });
    });
  }
}
