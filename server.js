const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

const app = express();
app.use(cors());
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

/* ===== DB ===== */
const db = new sqlite3.Database("./telc.db");

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

/* ===== REGISTER (ADMIN) ===== */
app.post("/register", async (req, res) => {
  const { username, password, role } = req.body;
  const hash = await bcrypt.hash(password, 10);

  db.run(
    "INSERT INTO users (username, password, role) VALUES (?,?,?)",
    [username, hash, role || "user"],
    err => {
      if (err) return res.status(400).json({ error: "User exists" });
      res.json({ success: true });
    }
  );
});

/* ===== LOGIN ===== */
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    "SELECT * FROM users WHERE username=?",
    [username],
    async (err, user) => {
      if (!user) return res.status(401).json({ error: "User not found" });

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: "Wrong password" });

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
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
