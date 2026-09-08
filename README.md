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
SESSION_SECRET="a-long-private-value" npm start
```

Only the admin session can create, edit, or delete projects. Day number and title are the only required fields; all other fields may be left blank.
