import test from "node:test";
import assert from "node:assert/strict";
import { report, NOW } from "./helpers.mjs";
import { PROVIDERS, assertProvider, detectedProviders } from "../mods/quota-manager/providers.js";
import { normalizeConfig, changeConfig, moveProvider, selectedProviders, machineFor } from "../mods/quota-manager/config.js";
import { normalizeReport, parseReport, safeText, headline, validWindow, displayPercent, isStale, countdown, recordHistory } from "../mods/quota-manager/model.js";
const cfg = normalizeConfig();
const lane = extra => normalizeReport(report("codex", extra), "codex", NOW)[0];

test("catalog contains 19 unique explicit provider ids", () => {
  assert.equal(PROVIDERS.length, 19); assert.equal(new Set(PROVIDERS.map(p => p.id)).size, 19);
  for (const id of ["codex; echo x", "codex,cursor", "__proto__", "", null]) assert.throws(() => assertProvider(id));
});
test("onboarding prevents all collection until consent", () => assert.deepEqual(selectedProviders(cfg), []));
test("malformed configuration is whitelisted and repaired", () => {
  const c = normalizeConfig({ interval: -1, language: "bad", order: ["grok", "grok", "attack"], providers: { codex: { query: "false" } } });
  assert.equal(c.interval, 120000); assert.equal(c.language, "en"); assert.equal(c.order[0], "grok");
  assert.equal(c.order.length, 19); assert.equal(c.providers.codex.query, true);
  assert.deepEqual(normalizeConfig(null), cfg);
});
test("configuration patches preserve other providers and increase revision", () => {
  const c = changeConfig(cfg, { providers: { codex: { query: false, show: true } }, kinds: { model: false } });
  assert.equal(c.providers.cursor.query, true); assert.equal(c.providers.codex.query, false);
  assert.equal(c.revision, 1); assert.equal(c.kinds.weekly, true);
});
test("Muse requires a separate side-effect consent", () => {
  assert.equal(normalizeConfig({ providers: { muse: { query: true } } }).providers.muse.query, false);
  assert.equal(normalizeConfig({ museConsent: true, providers: { muse: { query: true } } }).providers.muse.query, true);
});
test("move operations preserve a permutation and respect endpoints", () => {
  assert.equal(moveProvider(cfg, "codex", -1), cfg);
  assert.equal(moveProvider(cfg, "codex", 1).order[1], "codex");
  assert.deepEqual(moveProvider(moveProvider(cfg, "codex", 1), "codex", -1).order, cfg.order);
});
test("machine routing honors explicit pinned null and current remote", () => {
  const spaces = [{ active: true, machine: "prod" }];
  assert.equal(machineFor(cfg, spaces), "prod");
  assert.equal(machineFor(cfg, spaces, null), null);
  assert.equal(machineFor({ ...cfg, scope: "local" }, spaces), null);
  assert.equal(machineFor(cfg, spaces, "fixed"), "fixed");
});
test("detection is explicit CLI presence, not invented subscription identity", () => {
  assert.deepEqual(detectedProviders([{ key: "codex", installed: true }, { key: "cursor", installed: false }, { key: "omp", installed: true }]), ["codex"]);
});
test("JSON parser handles BOM and shell banners without logging them", () => {
  assert.deepEqual(parseReport(`\uFEFFwelcome\n{banner}\n${JSON.stringify(report())}\n`), report());
});
test("JSON parser fails closed on unknown schema, overflow, arrays, and trailing garbage", () => {
  for (const value of ["[]", "{}", "x".repeat(1048577), JSON.stringify({ ...report(), schemaVersion: 99 }), JSON.stringify(report()) + "x"])
    assert.throws(() => parseReport(value), /invalid_report/);
});
test("schema 6 preserves multiple distinct account lanes", () => {
  const r = report(); r.schemaVersion = 6;
  r.providers.push({ ...r.providers[0], accountKey: "another-private-profile" });
  const lanes = normalizeReport(r, "codex", NOW);
  assert.equal(lanes.length, 2); assert.notEqual(lanes[0].key, lanes[1].key);
  assert.equal(JSON.stringify(lanes).includes("private-profile"), false);
});
test("duplicate account lanes and missing requested providers fail closed", () => {
  const r = report(); r.providers.push(r.providers[0]);
  assert.throws(() => normalizeReport(r, "codex", NOW), /invalid_report/);
  assert.throws(() => normalizeReport(report("cursor"), "codex", NOW), /invalid_report/);
  assert.throws(() => normalizeReport({ ...report(), generatedAt: "no" }, "codex", NOW), /invalid_report/);
});
test("normalization does not retain raw account, token, error, or remedy data", () => {
  const l = lane({ account: { email: "private@example.com" }, accessToken: "secret", state: { status: "error", error: "Bearer sensitive", remedyCommand: "sh evil" } });
  const json = JSON.stringify(l);
  for (const secret of ["private@example.com", "sensitive", "sh evil", "secret"]) assert.equal(json.includes(secret), false);
  assert.equal(safeText("Bearer abc"), "[redacted]"); assert.equal(safeText("a@x.com"), "[account]");
});
test("remaining and used percentages normalize without inventing missing values", () => {
  const l = lane({ windows: [
    { id: "a", percentUsed: 25 }, { id: "b", percentRemaining: 0 },
    { id: "c", percentRemaining: "30" }, { id: "d", percentUsed: Infinity }, null,
  ] });
  assert.deepEqual(l.windows.map(w => w.remaining), [75, 0, null, null]);
  assert.equal(displayPercent(l.windows[0], { ...cfg, percentage: "used" }, NOW), 25);
});
test("used-share rows never manufacture a remaining allowance or become the headline", () => {
  const l = lane({ windows: [{ id: "share", shareOf: "parent", percentUsed: 91, percentRemaining: 9 }] });
  assert.equal(l.windows[0].remaining, null);
  assert.equal(displayPercent(l.windows[0], cfg, NOW), 91);
  assert.equal(headline(l, cfg, NOW), null);
});
test("expired windows are unknown until re-fetched, never automatically reset to full", () => {
  const l = lane(); const w = { ...l.windows[0], resetsAt: NOW };
  assert.equal(validWindow(w, NOW), false); assert.equal(displayPercent(w, cfg, NOW), null);
});
test("untrusted windows cannot participate in alert or headline calculations", () => {
  const l = lane({ state: { status: "fresh", stale: false, untrustedWindowIds: ["week"] } });
  assert.equal(headline(l, cfg, NOW), null); assert.equal(displayPercent(l.windows[0], cfg, NOW), null);
});
test("window-kind filters alter display only", () => {
  const l = lane(); assert.equal(headline(l, { ...cfg, kinds: { ...cfg.kinds, weekly: false } }, NOW), null);
  assert.equal(l.windows.length, 1);
});
test("source timestamps and stale evidence survive reused responses", () => {
  const l = lane({ state: { status: "fresh", stale: false, reused: true, refreshedAt: new Date(NOW - 900000).toISOString() } });
  assert.equal(l.refreshedAt, NOW - 900000); assert.equal(isStale(l, cfg, NOW), true);
});
test("future-dated source data is not treated as trustworthy fresh data", () => {
  assert.equal(lane({ state: { status: "fresh", refreshedAt: new Date(NOW + 900000).toISOString() } }).stale, true);
});
test("balances remain balances and do not invent a percentage denominator", () => {
  const l = lane({ windows: [], credits: { remaining: 42, unit: "usd" } });
  assert.equal(l.credits.remaining, 42); assert.equal(headline(l, cfg, NOW), null);
});
test("countdowns clamp elapsed resets and handle missing dates", () => {
  assert.equal(countdown(null, NOW), "—"); assert.equal(countdown(NOW - 1, NOW), "0m");
  assert.equal(countdown(NOW + 60000, NOW), "1m"); assert.equal(countdown(NOW + 86400000, NOW), "1d 0h");
});
test("history is bounded, expires, and excludes stale snapshots", () => {
  const old = Array.from({ length: 125 }, (_, i) => ({ at: NOW - i * 1000, rows: [] }));
  const result = recordHistory([...old, { at: NOW - 31 * 86400000, rows: [] }], [lane()], NOW);
  assert.equal(result.length, 120); assert.ok(result.every(r => r.at > NOW - 30 * 86400000));
  assert.equal(recordHistory(result, [{ ...lane(), stale: true }], NOW), result);
});
