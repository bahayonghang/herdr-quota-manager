import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryLocalQuota } from "../mods/quota-manager/vendor/quota-axi/index.js";
import { parseReport, normalizeReport } from "../mods/quota-manager/model.js";
import { report, NOW } from "./helpers.mjs";

async function sandbox(t) {
  const dir = await mkdtemp(join(tmpdir(), "quota-local-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, "home");
  const appHome = join(dir, "app-home");
  await mkdir(home, { recursive: true });
  await mkdir(appHome, { recursive: true });
  return { dir, home, appHome };
}

test("queryLocalQuota rejects non-allowlisted provider ids", async () => {
  await assert.rejects(() => queryLocalQuota("bogus"), /Unsupported provider/);
});

test("empty isolated home makes zero network calls and parses via model helpers", async t => {
  const { home, appHome } = await sandbox(t);
  let fetchCalls = 0;
  const raw = await queryLocalQuota("codex", {
    force: false,
    home,
    appHome,
    platform: "windows",
    fetchImpl: async () => { fetchCalls++; throw new Error("unexpected fetch"); },
  });
  assert.equal(fetchCalls, 0);
  const parsed = parseReport(raw);
  assert.ok([5, 6].includes(parsed.schemaVersion));
  const lanes = normalizeReport(parsed, "codex", Date.now());
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].windows.length, 0);
});

test("snapshot fixture reads quota without invoking fetch", async t => {
  const { dir, home, appHome } = await sandbox(t);
  const snapPath = join(dir, "snapshot.json");
  const now = Date.now();
  await writeFile(snapPath, JSON.stringify({
    schemaVersion: 1,
    providers: [{
      provider: "codex",
      label: "Codex",
      source: "oauth",
      plan: "pro",
      windows: [{ id: "weekly", label: "week", kind: "weekly", percentRemaining: 25, resetsAt: new Date(now + 86400000).toISOString() }],
      state: { status: "fresh", stale: false, sourcesTried: ["oauth"], refreshedAt: new Date(now).toISOString() },
    }],
  }));
  let fetchCalls = 0;
  const raw = await queryLocalQuota("codex", {
    force: false,
    home,
    appHome,
    platform: "windows",
    snapshot: snapPath,
    fetchImpl: async () => { fetchCalls++; throw new Error("unexpected fetch"); },
  });
  assert.equal(fetchCalls, 0);
  const lanes = normalizeReport(parseReport(raw), "codex", now);
  assert.equal(lanes[0].status, "fresh");
  assert.equal(lanes[0].windows[0].remaining, 25);
});

test("mocked Codex query persists cache under appHome, redacts PII/secrets, reuses cache, and force bypasses it", async t => {
  const { home, appHome } = await sandbox(t);
  await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".codex", "auth.json"), JSON.stringify({
    tokens: { access_token: "secret-tok-123", account_id: "acct_1" },
  }));
  let fetchCalls = 0;
  const fetchImpl = async url => {
    fetchCalls++;
    assert.match(String(url), /wham\/usage/);
    return {
      status: 200,
      ok: true,
      url: String(url),
      async text() {
        return JSON.stringify({
          plan_type: "pro",
          email: "alice@example.com",
          account_id: "acct_1",
          rate_limit: {
            primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: 3600 },
            secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_after_seconds: 86400 },
          },
        });
      },
    };
  };

  const firstRaw = await queryLocalQuota("codex", { force: false, home, appHome, platform: "windows", fetchImpl });
  assert.equal(fetchCalls, 1);
  assert.equal(firstRaw.includes("alice@example.com"), false);
  assert.equal(firstRaw.includes("secret-tok-123"), false);
  const firstLanes = normalizeReport(parseReport(firstRaw), "codex", Date.now());
  assert.equal(firstLanes[0].status, "fresh");
  assert.equal(firstLanes[0].plan, "pro");
  assert.deepEqual(firstLanes[0].windows.map(w => w.remaining), [75, 60]);

  const cacheText = await readFile(join(appHome, "quota-manager-collector", "quota-axi", "quotas.json"), "utf8");
  assert.equal(cacheText.includes("secret-tok-123"), false);

  const secondRaw = await queryLocalQuota("codex", { force: false, home, appHome, platform: "windows", fetchImpl });
  assert.equal(fetchCalls, 1);
  assert.equal(normalizeReport(parseReport(secondRaw), "codex", Date.now())[0].status, "fresh");

  await queryLocalQuota("codex", { force: true, home, appHome, platform: "windows", fetchImpl });
  assert.equal(fetchCalls, 2);
});

test("oversized response body past 262144 bytes is bounded and redacted", async t => {
  const { home, appHome } = await sandbox(t);
  await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".codex", "auth.json"), JSON.stringify({
    tokens: { access_token: "secret-tok-big", account_id: "acct_big" },
  }));
  const huge = "x".repeat(262145);
  const raw = await queryLocalQuota("codex", {
    force: true,
    home,
    appHome,
    platform: "windows",
    fetchImpl: async url => ({
      status: 200,
      ok: true,
      url: String(url),
      async text() { return huge; },
    }),
  });
  assert.equal(raw.includes("xxxxxxxx"), false);
  assert.equal(raw.includes("secret-tok-big"), false);
  const lanes = normalizeReport(parseReport(raw), "codex", Date.now());
  assert.notEqual(lanes[0].status, "fresh");
});

test("Muse query strips api_key and writes read-gate ledger under appHome", async t => {
  const { home, appHome } = await sandbox(t);
  await mkdir(join(home, ".config", "muse"), { recursive: true });
  await writeFile(join(home, ".config", "muse", "auth.json"), JSON.stringify({
    providers: { meta: { access_token: "muse-secret-tok" } },
  }));
  let fetchCalls = 0;
  const raw = await queryLocalQuota("muse", {
    force: false,
    home,
    appHome,
    platform: "linux",
    fetchImpl: async url => {
      fetchCalls++;
      assert.match(String(url), /muse-code\/key/);
      return {
        status: 200,
        ok: true,
        url: String(url),
        async text() {
          return JSON.stringify({
            api_key: "leaked-api-key-xyz",
            is_subs_active: true,
            subs_tier_name: "pro",
            subs_usage: {
              window: { used_percent: 20, window_duration_mins: 300, resets_at: Math.floor(Date.now() / 1000) + 3600 },
            },
          });
        },
      };
    },
  });
  assert.equal(fetchCalls, 1);
  assert.equal(raw.includes("leaked-api-key-xyz"), false);
  assert.equal(raw.includes("muse-secret-tok"), false);
  const lanes = normalizeReport(parseReport(raw), "muse", Date.now());
  assert.equal(lanes[0].status, "fresh");
  assert.equal(lanes[0].windows[0].remaining, 80);
  const ledger = JSON.parse(await readFile(join(appHome, "quota-manager-collector", "quota-axi", "muse-key-reads.json"), "utf8"));
  assert.equal(ledger.schemaVersion, 1);
});
