const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");

process.env.TELC_DB_PATH = path.join(os.tmpdir(), `telc-test-${process.pid}.db`);
process.env.JWT_SECRET = "test-secret";
process.env.REGISTRATION_TOKEN = "reg-token";

const app = require("../server");

let server, base;
test.before(async () => {
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await new Promise(r => setTimeout(r, 300)); // let CREATE TABLE settle
});
test.after(() => server.close());

const post = (p, body, headers = {}) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("register + login round trip returns a user token", async () => {
  assert.strictEqual((await post("/register", { username: "alice", password: "pw" })).status, 200);
  const r = await post("/login", { username: "alice", password: "pw" });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.role, "user");
  assert.ok(body.token);
});

test("duplicate username is rejected", async () => {
  await post("/register", { username: "bob", password: "pw" });
  assert.strictEqual((await post("/register", { username: "bob", password: "pw" })).status, 400);
});

test("self-registering as admin is forbidden without a token", async () => {
  const r = await post("/register", { username: "mallory", password: "pw", role: "admin" });
  assert.strictEqual(r.status, 403);
});

test("admin can be created with the registration token", async () => {
  const r = await post("/register", { username: "root", password: "pw", role: "admin" }, { "x-registration-token": "reg-token" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await (await post("/login", { username: "root", password: "pw" })).json()).role, "admin");
});

test("wrong password and unknown user give the same generic 401", async () => {
  const a = await post("/login", { username: "alice", password: "nope" });
  const b = await post("/login", { username: "ghost", password: "nope" });
  assert.strictEqual(a.status, 401);
  assert.strictEqual(b.status, 401);
  assert.deepStrictEqual(await a.json(), await b.json());
});

test("missing fields are rejected", async () => {
  assert.strictEqual((await post("/register", {})).status, 400);
  assert.strictEqual((await post("/login", {})).status, 401);
});

test("repeated failed logins lock the account", async () => {
  await post("/register", { username: "carol", password: "pw" });
  let last;
  for (let i = 0; i < 11; i++) last = await post("/login", { username: "carol", password: "bad" });
  assert.strictEqual(last.status, 429);
  assert.strictEqual((await post("/login", { username: "carol", password: "pw" })).status, 429);
});
