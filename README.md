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

The database is stored in `data.sqlite`. Add `SESSION_SECRET` in the environment when deploying so sessions use a private value:

```bash
SESSION_SECRET="$(openssl rand -base64 48)" npm start
```

## Admin account settings

Sign in at `/admin` and use the **Account settings** panel to change the admin email, password, or both. Confirm every change with the current password; a new password must be at least 12 characters and no more than 72 UTF-8 bytes. Changing account credentials signs out other active sessions. This is handled directly by the website and does not require email, SMTP, or another service. Keep your current password safe; if you lose access, the account must be recovered by someone with access to the server.

The Rehan School logo is served from `assets/rehan-school-logo.png` and is used in the site, admin, and project-detail headers.

Only the admin session can create, edit, or delete projects. Day number and title are the only required fields; all other fields may be left blank. Check “Feature this project on the homepage” to include it in the homepage’s Featured Projects section. Existing projects keep the previous behavior: the four newest projects are featured when the database is first upgraded.
