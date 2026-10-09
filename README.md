# telc-backend

The API backend for a TELC C1 listening-comprehension exam practice app. Pairs with [telc-frontend](https://github.com/Kutlu24/telc-frontend), which is the deployed client for this service.

🇩🇪 German version: [README.de.md](README.de.md)

## What it does

A small Express + SQLite service handling user accounts and (eventually) exam content:

- `POST /register` — create a user, password hashed with bcrypt.
- `POST /login` — verify credentials, issue a JWT valid for 2 hours.
- SQLite tables for `users` and `exams`.

## Tech stack

Node.js, Express 5, SQLite3, bcrypt, jsonwebtoken, cors.

## Running it

```bash
npm install
node server.js
```

Set the `PORT` environment variable to control the listen port (defaults to 3000).

## Configuration

Set **`JWT_SECRET`** in your deployment's environment variables (e.g. Render → Environment). If it's unset, the server generates a random secret at boot as a safety net — sessions still work, but every restart invalidates existing tokens, so this is not suitable for production.

Optional:

- **`REGISTRATION_TOKEN`** — required if you ever want to create an account whose `role` is not `"user"`. Send it as the `X-Registration-Token` header on `POST /register`. Without it (and without a valid admin JWT), `POST /register` only ever creates regular `"user"` accounts — a caller can no longer post `{"role": "admin"}` and grant themselves admin. Plain user sign-up is unaffected.
- **`ALLOWED_ORIGINS`** — comma-separated list of browser origins allowed by CORS (e.g. the telc-frontend URL). If unset, CORS stays open to all origins and a warning is logged.
- `PORT` — listen port (defaults to 3000).

Login/register are rate-limited in memory (10 failed logins per username and 20 registrations per 15 minutes per process, reset on restart) — best effort, not a distributed limiter.

`telc.db` is git-ignored; the schema is created on boot (`CREATE TABLE IF NOT EXISTS`), so a fresh clone starts with an empty database.

## Security note (fixed 2026-09)

This repository previously committed a hardcoded JWT secret in `server.js` and a plaintext admin password in `admin.json`, in a **public** repository. Both have been removed from the current code. If an admin account was ever created with the password that was in `admin.json`, **change that account's password now** — the old value was exposed publicly and must be treated as compromised regardless of any code fix. To create a fresh admin account, use `POST /register` with `"role": "admin"`.

## Known gap

`telc-frontend` calls `/exams` and `/questions` endpoints on this backend that are not implemented in the current `server.js` — only `/register` and `/login` exist here. If the live deployment serves those routes, the running code is ahead of what's committed to this repository; worth reconciling before further work.
