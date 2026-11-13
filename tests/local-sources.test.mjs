import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryLocalQuota } from "../mods/quota-manager/vendor/quota-axi/index.js";
import { parseReport, normalizeReport } from "../mods/quota-manager/model.js";

async function sandbox(t) {
  const dir = await mkdtemp(join(tmpdir(), "quota-sources-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, "home"), appHome = join(dir, "app-home");
  await mkdir(home, { recursive: true });
  await mkdir(appHome, { recursive: true });
  return { home, appHome };
}
function response(data, status = 200) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data) };
}
function deadline(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("provider_timeout")), ms);
  })]).finally(() => clearTimeout(timer));
}
const summary = () => ({ response: { groups: [{ displayName: "Gemini", buckets: [
  { bucketId: "gemini_5h", remainingFraction: 0.8, resetTime: new Date(Date.now() + 3600000).toISOString() },
] }] } });
const billing = (used = 25, kind = "WEEKLY") => ({ config: {
  creditUsagePercent: used,
  currentPeriod: { type: `USAGE_PERIOD_TYPE_${kind}`, start: new Date(Date.now() - 3600000).toISOString(), end: new Date(Date.now() + 86400000).toISOString() },
  productUsage: [{ product: "PRODUCT_GROK_BUILD", usagePercent: 40 }],
  prepaidBalance: { val: 1234 },
} });
async function daemon(home, port, patch = {}) {
  const dir = join(home, ".gemini", "antigravity", "daemon");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `hub_${port}.json`), JSON.stringify({ pid: 10, httpPort: port, csrfToken: `synthetic-csrf-${port}`, ...patch }));
}
async function grokAuth(home) {
  await mkdir(join(home, ".grok"), { recursive: true });
  const key = ["e30", Buffer.from(JSON.stringify({ sub: "synthetic-user" })).toString("base64url"), "signature"].join(".");
  await writeFile(join(home, ".grok", "auth.json"), JSON.stringify({ key }));
  return key;
}
const lanes = (raw, id) => normalizeReport(parseReport(raw), id, Date.now());

test("local Antigravity discovers a valid daemon beyond sixteen stale native-shaped inputs", async t => {
  const paths = await sandbox(t);
  for (let i = 0; i < 24; i++) await daemon(paths.home, 5000 + i);
  const calls = [];
  const raw = await queryLocalQuota("agy", { ...paths, force: true, platform: "windows", deadline,
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      assert.equal(new URL(url).hostname, "127.0.0.1");
      assert.equal(new URL(url).pathname, "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary");
      assert.deepEqual(JSON.parse(init.body), { request: {}, forceRefresh: false });
      assert.equal(init.headers["x-codeium-csrf-token"], `synthetic-csrf-${new URL(url).port}`);
      if (new URL(url).port !== "5023") throw new Error("ECONNREFUSED");
      return response(summary());
    },
  });
  const lane = lanes(raw, "agy")[0];
  assert.equal(lane.status, "fresh");
  assert.equal(lane.windows[0].remaining, 80);
  assert.ok(calls.length > 16);
  assert.equal(raw.includes("synthetic-csrf"), false);
  const cache = await readFile(join(paths.appHome, "quota-manager-collector", "quota-axi", "quotas.json"), "utf8");
  assert.equal(cache.includes("synthetic-csrf"), false);
});

test("local Grok reads one aggregate JSON allowance with native text-only responses", async t => {
  const paths = await sandbox(t), key = await grokAuth(paths.home), calls = [];
  const raw = await queryLocalQuota("grok", { ...paths, force: true, platform: "windows", deadline,
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      assert.equal(String(url), "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      assert.equal(init.headers["X-XAI-Token-Auth"], "xai-grok-cli");
      assert.equal(init.headers["x-userid"], "synthetic-user");
      return response(billing());
    },
  });
  const lane = lanes(raw, "grok")[0];
  assert.equal(lane.status, "fresh");
  assert.deepEqual(lane.windows.map(w => [w.kind, w.remaining]), [["weekly", 75]]);
  assert.equal(lane.credits, null);
  assert.equal(calls.length, 1);
  assert.equal(raw.includes(key), false);
  assert.equal(raw.includes("synthetic-user"), false);
});

test("local daemon metadata is validated before any loopback request", async t => {
  const paths = await sandbox(t);
  await daemon(paths.home, 6000, { httpPort: 6001 });
  await daemon(paths.home, 6001, { pid: 0 });
  await daemon(paths.home, 6002, { csrfToken: "" });
  await daemon(paths.home, 6003, { csrfToken: "x".repeat(4097) });
  await daemon(paths.home, 6004, { csrfToken: "header\r\ninjection" });
  await daemon(paths.home, 65536);
  const directory = join(paths.home, ".gemini", "antigravity", "daemon");
  await writeFile(join(directory, "hub_6005.json"), "bad json");
  await writeFile(join(directory, "hub_6006.json"), JSON.stringify({ padding: "x".repeat(16385) }));
  let calls = 0;
  const raw = await queryLocalQuota("agy", { ...paths, force: true, deadline,
    fetchImpl: async () => { calls++; return response(summary()); },
  });
  assert.equal(calls, 0);
  assert.equal(lanes(raw, "agy")[0].status, "unavailable");
});

test("missing daemon state is unavailable without claiming that Antigravity is uninstalled", async t => {
  const paths = await sandbox(t);
  let calls = 0;
  const raw = await queryLocalQuota("agy", { ...paths, force: true, deadline,
    fetchImpl: async () => { calls++; return response(summary()); },
  });
  assert.equal(calls, 0);
  assert.equal(lanes(raw, "agy")[0].status, "unavailable");
  assert.notEqual(parseReport(raw).providers[0].notSetUp, true);
});

test("daemon discovery reports its limit rather than silently truncating candidates", async t => {
  const paths = await sandbox(t);
  for (let i = 0; i < 257; i++) await daemon(paths.home, 10000 + i);
  let calls = 0;
  const raw = await queryLocalQuota("agy", { ...paths, force: true, deadline,
    fetchImpl: async () => { calls++; return response(summary()); },
  });
  assert.equal(calls, 0);
  const parsed = parseReport(raw);
  assert.equal(lanes(raw, "agy")[0].status, "unavailable");
  assert.match(parsed.providers[0].state.error, /discovery limit/);
});

test("daemon discovery awaits at most four workers when requests settle and rereads remembered tokens", async t => {
  const paths = await sandbox(t);
  for (let i = 0; i < 12; i++) await daemon(paths.home, 7000 + i);
  let active = 0, maxActive = 0;
  const fetchImpl = async url => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return new URL(url).port === "7011" ? response(summary()) : response({}, 503);
  };
  const options = { ...paths, force: true, deadline, fetchImpl };
  assert.equal(lanes(await queryLocalQuota("agy", options), "agy")[0].status, "fresh");
  assert.ok(maxActive > 1 && maxActive <= 4);
  await daemon(paths.home, 7011, { csrfToken: "rotated-synthetic-csrf" });
  let sawRotated = false;
  const raw = await queryLocalQuota("agy", { ...options, fetchImpl: async (url, init) => {
    if (new URL(url).port === "7011") {
      sawRotated = init.headers["x-codeium-csrf-token"] === "rotated-synthetic-csrf";
      return response(summary());
    }
    return response({}, 503);
  } });
  assert.equal(lanes(raw, "agy")[0].status, "fresh");
  assert.equal(sawRotated, true);
  assert.equal(raw.includes("rotated-synthetic-csrf"), false);
});

test("per-request daemon deadlines allow search past hanging candidates", async t => {
  const paths = await sandbox(t);
  for (let i = 0; i < 5; i++) await daemon(paths.home, 7500 + i);
  const pending = [];
  let calls = 0, requestDeadlines = 0;
  const raw = await queryLocalQuota("agy", { ...paths, force: true,
    deadline: (promise, ms) => {
      if (ms === 1000) { requestDeadlines++; return deadline(promise, 10); }
      assert.equal(ms, 10000); return deadline(promise, 500);
    },
    fetchImpl: async url => {
      calls++;
      return new URL(url).port === "7504" ? response(summary()) : new Promise(resolve => pending.push(resolve));
    },
  });
  assert.equal(lanes(raw, "agy")[0].status, "fresh");
  assert.equal(calls, 5);
  assert.equal(requestDeadlines, 5);
  // Timed-out native requests are ignored, not falsely claimed to be cancelled.
  for (const resolve of pending) resolve(response(summary()));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 5);
});

test("daemon retries bound candidate origins without claiming to cancel timed-out native requests", async t => {
  const paths = await sandbox(t);
  for (let i = 0; i < 256; i++) await daemon(paths.home, 20000 + i);
  const calls = [], pending = [];
  let unsettled = 0;
  const raw = await queryLocalQuota("agy", { ...paths, force: true,
    deadline: (promise, ms) => {
      if (ms === 10000) return promise;
      assert.equal(ms, 1000);
      return Promise.race([promise, Promise.reject(new Error("provider_timeout"))]);
    },
    fetchImpl: url => {
      calls.push(String(url));
      unsettled++;
      return new Promise(resolve => pending.push(value => { unsettled--; resolve(value); }));
    },
  });
  assert.equal(lanes(raw, "agy")[0].status, "unavailable");
  assert.equal(calls.length, 256);
  assert.equal(new Set(calls).size, 256);
  // Native fetch cannot be cancelled: four awaited workers do not imply a
  // four-socket cap after their per-request waiting deadlines expire.
  assert.equal(unsettled, 256);
  for (const resolve of pending) resolve(response(summary()));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(unsettled, 0);
  assert.equal(calls.length, 256);
});

test("Grok handles finite allowance edges and monthly periods without adding product breakdown", async t => {
  const paths = await sandbox(t); await grokAuth(paths.home);
  for (const used of [0, 100, 12.5]) {
    const raw = await queryLocalQuota("grok", { ...paths, force: true, deadline,
      fetchImpl: async () => response(billing(used, "MONTHLY")),
    });
    assert.deepEqual(lanes(raw, "grok")[0].windows.map(w => [w.kind, w.remaining]), [["monthly", 100 - used]]);
  }
});

test("Grok never fabricates a percentage from missing or malformed allowance JSON", async t => {
  const paths = await sandbox(t); await grokAuth(paths.home);
  const malformed = [billing(undefined), billing(null), billing(-1), billing(101), billing("25"),
    { config: { currentPeriod: billing().config.currentPeriod } },
    { config: { ...billing().config, currentPeriod: { type: "UNKNOWN", start: "bad", end: "bad" } } },
    { config: { ...billing().config, currentPeriod: { ...billing().config.currentPeriod, end: "invalid" } } },
    { config: null }, {}];
  // An explicit missing field is separate from a valid zero-valued scalar.
  delete malformed[0].config.creditUsagePercent;
  for (const payload of malformed) {
    const raw = await queryLocalQuota("grok", { ...paths, force: true, deadline, fetchImpl: async () => response(payload) });
    const lane = lanes(raw, "grok")[0];
    assert.notEqual(lane.status, "fresh");
    assert.deepEqual(lane.windows, []);
  }
});

test("Grok preserves safe auth, rate-limit and response-size failures", async t => {
  const paths = await sandbox(t), key = await grokAuth(paths.home);
  for (const [status, expected] of [[401, "auth_required"], [403, "auth_required"], [429, "rate_limited"], [500, "error"]]) {
    const raw = await queryLocalQuota("grok", { ...paths, force: true, deadline,
      fetchImpl: async () => response({ error: "private raw error " + key }, status),
    });
    const lane = lanes(raw, "grok")[0];
    assert.equal(lane.status, expected);
    assert.equal(raw.includes(key), false);
    assert.equal(raw.includes("private raw error"), false);
  }
  const raw = await queryLocalQuota("grok", { ...paths, force: true, deadline,
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => "x".repeat(65537) }),
  });
  assert.notEqual(lanes(raw, "grok")[0].status, "fresh");
  assert.equal(raw.includes("xxxxxxxx"), false);
});

test("Grok deadline includes text reading and late completion cannot publish into a later provider", async t => {
  const paths = await sandbox(t); await grokAuth(paths.home);
  let finishBody;
  const raw = await queryLocalQuota("grok", { ...paths, force: true,
    deadline: (promise, ms) => { assert.equal(ms, 15000); return deadline(promise, 10); },
    fetchImpl: async () => ({ status: 200, ok: true, text: () => new Promise(resolve => { finishBody = resolve; }) }),
  });
  assert.notEqual(lanes(raw, "grok")[0].status, "fresh");
  await mkdir(join(paths.home, ".codex"), { recursive: true });
  await writeFile(join(paths.home, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: "synthetic-codex", account_id: "test" } }));
  let finishCodex, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const codex = queryLocalQuota("codex", { ...paths, force: true, fetchImpl: async () => {
    started();
    return new Promise(resolve => { finishCodex = resolve; });
  } });
  await waiting;
  finishBody(JSON.stringify(billing()));
  await new Promise(resolve => setImmediate(resolve));
  finishCodex(response({ rate_limit: { primary_window: { used_percent: 60, limit_window_seconds: 18000, reset_after_seconds: 3600 } } }));
  assert.equal(lanes(await codex, "codex")[0].windows[0].remaining, 40);
  const cache = JSON.parse(await readFile(join(paths.appHome, "quota-manager-collector", "quota-axi", "quotas.json"), "utf8"));
  const grok = cache.providers.find(p => p.provider === "grok");
  assert.notEqual(grok?.state.status, "fresh");
});

test("daemon overall deadline releases runtime and late successful requests stop scheduling", async t => {
  const paths = await sandbox(t);
  for (let i = 0; i < 12; i++) await daemon(paths.home, 8000 + i);
  let calls = 0;
  const pending = [];
  const raw = await queryLocalQuota("agy", { ...paths, force: true,
    deadline: (promise, ms) => ms === 10000 ? deadline(promise, 15) : promise,
    fetchImpl: async () => { calls++; return new Promise(resolve => pending.push(resolve)); },
  });
  assert.equal(lanes(raw, "agy")[0].status, "unavailable");
  assert.equal(calls, 4);
  // Another provider can acquire the runtime even while old native fetches are pending.
  await mkdir(join(paths.home, ".codex"), { recursive: true });
  await writeFile(join(paths.home, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: "synthetic-codex", account_id: "test" } }));
  const other = await queryLocalQuota("codex", { ...paths, force: true,
    fetchImpl: async () => response({ rate_limit: { primary_window: { used_percent: 60, limit_window_seconds: 18000, reset_after_seconds: 3600 } } }),
  });
  assert.equal(lanes(other, "codex")[0].windows[0].remaining, 40);
  for (const resolve of pending) resolve(response(summary()));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 4);
  const cache = JSON.parse(await readFile(join(paths.appHome, "quota-manager-collector", "quota-axi", "quotas.json"), "utf8"));
  assert.notEqual(cache.providers.find(p => p.provider === "agy")?.state.status, "fresh");
});
