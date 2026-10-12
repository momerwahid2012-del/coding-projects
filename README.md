# Rehan School Coding Projects

A simple public portfolio with a private, SQLite-backed admin dashboard.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create the one admin account (run this once):
   ```bash
   node app.js create-admin your-email@example.com your-password
   ```
3. Start the website:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000` for the public portfolio or `http://localhost:3000/admin` to sign in.

By default, the database is stored in `data.sqlite` beside the app. Set `DATA_DIR` to choose another directory:

```bash
DATA_DIR="/var/data" npm start
```

In production, set `SESSION_SECRET` to a private random value with at least 32 bytes, for example `openssl rand -base64 48`. If it is missing, the app generates a secure temporary secret and can start, but admin sessions will be invalidated when the service restarts. An explicitly configured secret shorter than 32 bytes is rejected. Production automatically trusts the single reverse proxy used by Render so HTTPS admin session cookies work without additional proxy settings.

SQLite's native module must be compiled against Render's system libraries. The `postinstall` script explicitly rebuilds `sqlite3` from source even when Render reuses its dependency cache. Confirm the Render build log shows `node-gyp rebuild` during this step. If it does not, set the Render build command to `npm install && npm_config_build_from_source=true npm rebuild sqlite3 --foreground-scripts`, then use **Manual Deploy → Clear build cache & deploy** once.

### Render persistent storage

Render's normal filesystem is temporary, so SQLite data can disappear when a service is redeployed or restarted. Add a **persistent disk** to the web service in the Render dashboard with mount path `/var/data`, then add `DATA_DIR=/var/data` to the service's environment variables and redeploy. This makes the database survive deployments. Persistent disks are a Render plan feature; the downloadable project backup below is an additional recovery option, not a replacement for persistent storage.

If logs still show `GLIBC_2.38 not found`, verify the build log includes the source rebuild and that the service deploys the commit containing this `postinstall` script. Use **Manual Deploy → Clear build cache & deploy** after changing the build command or updating the code.

## Admin account settings

Sign in at `/admin` and use the **Account settings** panel to change the admin email, password, or both. Confirm every change with the current password; a new password must be at least 12 characters and no more than 72 UTF-8 bytes. Changing account credentials signs out other active sessions. This is handled directly by the website and does not require email, SMTP, or another service. Keep your current password safe; if you lose access, the account must be recovered by someone with access to the server.

The Rehan School logo is served from `assets/rehan-school-logo.png` and is used in the site, admin, and project-detail headers.

Only the admin session can create, edit, or delete projects. Day number and title are the only required fields; all other fields may be left blank. Check “Feature this project on the homepage” to include it in the homepage’s Featured Projects section. Use **Project backup → Download backup** before deployments; select, paste, or drop a downloaded JSON backup onto the restore area to replace the site's current projects with those from the backup. Existing projects keep the previous behavior: the four newest projects are featured when the database is first upgraded.
