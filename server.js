const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

const app = express();
// CORS: set ALLOWED_ORIGINS (comma-separated) to restrict browser origins.
// Unset keeps the old open behaviour so an existing deployment does not break.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);
if (allowedOrigins.length === 0) {
  console.warn("[telc-backend] WARNING: ALLOWED_ORIGINS is not set - CORS is open to all origins.");
}
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
app.use(express.json());

// SECURITY: never hardcode this. Set JWT_SECRET in your deployment's
// environment variables (e.g. Render > Environment) for stable sessions
// across restarts. Without it, a random secret is generated at boot,
// which means every restart invalidates existing login tokens.
if (!process.env.JWT_SECRET) {
  console.warn(
    "[telc-backend] WARNING: JWT_SECRET is not set. Using a temporary " +
      "random secret for this process only — all users will be logged " +
      "out on the next restart. Set JWT_SECRET in your environment for " +
      "production."
  );
}
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

/* ===== In-memory rate limiting (best effort, per process) =====
 * Two separate limiters, both bounded in memory:
 *  - login:  per-username failure counter (one account can be locked out
 *    by guessing, everybody else keeps working; no IP logic, so it behaves
 *    the same behind Render's proxy as it does locally)
 *  - register: global counter, so the open /register endpoint cannot be
 *    used to mass-create accounts
 * This resets on restart and is not shared between instances - a real
 * distributed limiter is out of scope here, this only has to stop the
 * obvious online guessing / spam.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 10;
const MAX_REGISTRATIONS = 20;
const loginFailures = new Map(); // username -> [timestamps]
let registrations = []; // timestamps
const MAX_TRACKED_USERS = 5000;

function prune(list, now) {
  return list.filter(t => now - t < WINDOW_MS);
}

function loginLocked(username) {
  const now = Date.now();
  const list = prune(loginFailures.get(username) || [], now);
  loginFailures.set(username, list);
  if (loginFailures.size > MAX_TRACKED_USERS) loginFailures.clear();
  return list.length >= MAX_LOGIN_FAILURES;
}

function recordLoginFailure(username) {
  const now = Date.now();
  const list = prune(loginFailures.get(username) || [], now);
  list.push(now);
  loginFailures.set(username, list);
}

function registrationBlocked() {
  const now = Date.now();
  registrations = prune(registrations, now);
  return registrations.length >= MAX_REGISTRATIONS;
}

/* ===== DB ===== */
const db = new sqlite3.Database(process.env.TELC_DB_PATH || "./telc.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teil TEXT,
      title TEXT,
      text TEXT
    )
  `);
});

/* ===== TEST ===== */
app.get("/", (req, res) => {
  res.send("TELC Backend läuft 🚀");
});

/* ===== AUTH HELPERS ===== */
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // keep the comparison non-empty
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Who is allowed to create accounts with a role other than "user":
// either the REGISTRATION_TOKEN env var (sent as X-Registration-Token)
// or an already-valid admin JWT. If neither is configured, admin
// creation is simply impossible - fail closed, never open.
function isRegistrationAuthorized(req) {
  const regToken = process.env.REGISTRATION_TOKEN;
  const provided = req.get("x-registration-token");
  if (regToken && provided && timingSafeStringEqual(provided, regToken)) {
    return true;
  }
  const auth = req.get("authorization") || "";
  if (auth.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(auth.slice(7), SECRET);
      if (payload && payload.role === "admin") return true;
    } catch (_) {
      // expired or invalid token - falls through to "not authorized"
    }
  }
  return false;
}

/* ===== REGISTER (ADMIN) ===== */
app.post("/register", async (req, res) => {
  const { username, password, role } = req.body || {};
  if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  // `role` comes straight from the client. Without this check anyone
  // could POST {"role": "admin"} and mint themselves an admin account -
  // regular self-registration stays open, privileged creation does not.
  const requestedRole = typeof role === "string" && role ? role : "user";
  if (requestedRole !== "user" && !isRegistrationAuthorized(req)) {
    return res.status(403).json({ error: "creating a non-user account requires authorization" });
  }

  if (registrationBlocked()) {
    return res.status(429).json({ error: "Too many registrations, try again later" });
  }
  registrations.push(Date.now());

  let hash;
  try {
    hash = await bcrypt.hash(password, 10);
  } catch (_) {
    return res.status(400).json({ error: "Invalid password" });
  }

  db.run(
    "INSERT INTO users (username, password, role) VALUES (?,?,?)",
    [username.trim(), hash, requestedRole],
    err => {
      if (err) return res.status(400).json({ error: "User exists" });
      res.json({ success: true });
    }
  );
});

/* ===== LOGIN ===== */
let dummyHash = null; // equalises timing when the username does not exist

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (loginLocked(username)) {
    return res.status(429).json({ error: "Too many attempts, try again later" });
  }

  // One generic answer whether the account exists or not, so the
  // endpoint cannot be used to enumerate usernames.
  const invalid = () => res.status(401).json({ error: "Invalid credentials" });

  db.get(
    "SELECT * FROM users WHERE username=?",
    [username],
    async (err, user) => {
      if (err) return res.status(500).json({ error: "Login failed" });

      if (!user || typeof user.password !== "string") {
        if (!dummyHash) dummyHash = await bcrypt.hash("not-a-real-password", 10);
        await bcrypt.compare(password, dummyHash);
        recordLoginFailure(username);
        return invalid();
      }

      let ok = false;
      try {
        if (user.password.startsWith("$2")) {
          ok = await bcrypt.compare(password, user.password);
        } else {
          // Legacy row holding a plaintext password (pre-bcrypt data):
          // verify it in constant time, then upgrade it to bcrypt in place
          // so the plaintext copy is gone after this successful login.
          ok = timingSafeStringEqual(password, user.password);
          if (ok) {
            const upgraded = await bcrypt.hash(password, 10);
            db.run("UPDATE users SET password=? WHERE id=?", [upgraded, user.id]);
          }
        }
      } catch (_) {
        return res.status(500).json({ error: "Login failed" });
      }

      if (!ok) {
        recordLoginFailure(username);
        return invalid();
      }
      loginFailures.delete(username);

      const token = jwt.sign(
        { id: user.id, role: user.role },
        SECRET,
        { expiresIn: "2h" }
      );

      res.json({ token, role: user.role });
    }
  );
});

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
}

module.exports = app;
