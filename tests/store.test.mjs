import test from "node:test";
import assert from "node:assert/strict";
import { setup, report, NOW, deferred, flush } from "./helpers.mjs";
import { CONFIG_KEY, changeConfig } from "../mods/quota-manager/config.js";
import { QuotaStore, stateKey } from "../mods/quota-manager/store.js";

test("no consent means zero subprocesses", async () => {
  const h = setup({ config: { consent: false } }); await h.store.refresh(null, "windows", { force: true }); assert.equal(h.calls.length, 0);
});
test("disabled query is never executed, while hidden-but-enabled still is", async () => {
  const h = setup(); const c = h.read(CONFIG_KEY);
  h.write(CONFIG_KEY, changeConfig(c, { providers: { codex: { query: true, show: false }, cursor: { query: false, show: true } } }));
  await h.store.refresh(null, "linux");
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].args[2], "codex");
});
test("empty selection never invokes the collector's default all-provider query", async () => {
  const h = setup(); h.write(CONFIG_KEY, changeConfig(h.read(CONFIG_KEY), { providers: { codex: { query: false, show: true } } }));
  await h.store.refresh(null, "windows", { force: true }); assert.equal(h.calls.length, 0);
});
test("manual-only mode never auto-queries, including the first run", async () => {
  const h = setup({ config: { interval: 0 } }); await h.store.refresh(null, "linux"); assert.equal(h.calls.length, 0);
  await h.store.refresh(null, "linux", { force: true }); assert.equal(h.calls.length, 1);
});
test("successful cache prevents poll bursts and force has a five-second cooldown", async () => {
  const h = setup(); await h.store.refresh(null, "linux");
  await h.store.refresh(null, "linux"); await h.store.refresh(null, "linux", { force: true }); assert.equal(h.calls.length, 1);
  h.advance(5001); await h.store.refresh(null, "linux", { force: true }); assert.equal(h.calls.length, 2);
});
test("machine caches are distinct and subprocesses receive the machine", async () => {
  const h = setup(); await h.store.refresh(null, "linux"); await h.store.refresh("remote", "unknown");
  assert.ok(h.store.snapshot(null, "codex")); assert.ok(h.store.snapshot("remote", "codex"));
  assert.equal(h.calls[1].options.on, "remote"); assert.notEqual(stateKey("cache", null, "codex"), stateKey("cache", "null", "codex"));
});
test("concurrent copies share a provider lease", async () => {
  const gate = deferred(), h = setup({ execute: () => gate.promise });
  const other = new QuotaStore({ read: h.read, write: h.write, exec: h.exec, now: h.now });
  const pending = h.store.refresh(null, "linux");
  await other.refresh(null, "linux", { force: true }); assert.equal(h.calls.length, 1);
  gate.resolve({ code: 0, stdout: JSON.stringify(report()) }); await pending;
  assert.equal(h.store.busy(null, "codex"), false);
});
test("global host admission is capped at two simultaneous provider reads", async () => {
  const gate = deferred(), h = setup({ execute: () => gate.promise });
  h.write(CONFIG_KEY, changeConfig(h.read(CONFIG_KEY), { providers: { cursor: { query: true, show: true }, grok: { query: true, show: true } } }));
  const other = new QuotaStore({ read: h.read, write: h.write, exec: h.exec, now: h.now });
  const first = h.store.refresh(null, "linux"), second = other.refresh(null, "linux");
  assert.equal(h.calls.length, 2);
  gate.resolve({ code: 1, stdout: JSON.stringify({ ...report(), providers: [report().providers[0], report("cursor").providers[0], report("grok").providers[0]] }) });
  await Promise.all([first, second]);
});
test("in-flight response is discarded if settings change or provider is disabled", async () => {
  const gate = deferred(), h = setup({ execute: () => gate.promise });
  const pending = h.store.refresh(null, "linux");
  h.write(CONFIG_KEY, changeConfig(h.read(CONFIG_KEY), { providers: { codex: { query: false, show: true } } }));
  gate.resolve({ code: 0, stdout: JSON.stringify(report()) }); await pending;
  assert.equal(h.store.snapshot(null, "codex"), null); assert.equal(h.store.busy(null, "codex"), false);
});
test("closed views do not publish late results", async () => {
  const gate = deferred(), h = setup({ execute: () => gate.promise });
  const pending = h.store.refresh(null, "linux"); h.store.close();
  gate.resolve({ code: 0, stdout: JSON.stringify(report()) }); await pending;
  assert.equal(h.store.snapshot(null, "codex"), null);
});
test("expired leases recover without requiring a restart", async () => {
  const h = setup(); h.write(stateKey("lease", null, "codex"), { token: "old", until: NOW - 1 });
  await h.store.refresh(null, "linux"); assert.equal(h.calls.length, 1);
});
test("failed refresh retains explicitly stale cached numbers and increases backoff", async () => {
  let bad = false;
  const h = setup({ execute: () => bad ? { code: 2, stderr: "Bearer secret" } : { code: 0, stdout: JSON.stringify(report()) } });
  await h.store.refresh(null, "linux"); bad = true; h.advance(130000);
  await h.store.refresh(null, "linux"); const state = h.store.snapshot(null, "codex");
  assert.equal(state.lanes[0].stale, true); assert.equal(state.error, "cli_failed");
  assert.ok(state.nextAt > h.now() + 120000); assert.equal(JSON.stringify(state).includes("secret"), false);
});
test("structured auth failure does not retain another account's old quota", async () => {
  let bad = false;
  const h = setup({ execute: () => ({ code: bad ? 1 : 0, stdout: JSON.stringify(report("codex", bad ? { state: { status: "auth_required" }, windows: [] } : {})) }) });
  await h.store.refresh(null, "linux"); h.advance(130000); bad = true; await h.store.refresh(null, "linux");
  assert.equal(h.store.snapshot(null, "codex").lanes[0].windows.length, 0);
});
test("Retry-After blocks even forced reads", async () => {
  const h = setup({ execute: () => ({ code: 1, stdout: JSON.stringify(report("codex", { windows: [], state: { status: "rate_limited", retryAfter: new Date(NOW + 600000).toISOString() } })) }) });
  await h.store.refresh(null, "linux"); h.advance(10000);
  await h.store.refresh(null, "linux", { force: true }); assert.equal(h.calls.length, 1);
});
test("no history is persisted unless enabled", async () => {
  const h = setup(); await h.store.refresh(null, "linux"); assert.equal(h.read(stateKey("history", null, "codex")), undefined);
});
test("history records only fresh snapshots and clear is machine-scoped", async () => {
  const h = setup({ config: { history: true } });
  await h.store.refresh(null, "linux"); await h.store.refresh("remote", "unknown");
  h.store.clearHistory(null, ["codex"]);
  assert.equal(h.read(stateKey("history", null, "codex")).length, 0);
  assert.equal(h.read(stateKey("history", "remote", "codex")).length, 1);
});
test("history retention is pruned even while queries are paused", async () => {
  const h = setup({ config: { consent: false } });
  h.write(stateKey("history", null, "codex"), [{ at: NOW - 31 * 86400000 }, { at: NOW }]);
  await h.store.refresh(null, "linux"); assert.equal(h.read(stateKey("history", null, "codex")).length, 1);
});
test("alerts are opt-in and deduplicated by account/window/reset", async () => {
  const alerts = [], h = setup({ config: { threshold: 20 }, alert: e => alerts.push(e), execute: () => ({ code: 0, stdout: JSON.stringify(report("codex", { windows: [{ id: "w", label: "5h", percentRemaining: 10, resetsAt: new Date(NOW + 86400000).toISOString() }] })) }) });
  await h.store.refresh(null, "linux"); h.advance(130000); await h.store.refresh(null, "linux");
  assert.equal(alerts.length, 1); assert.equal(alerts[0].remaining, 10);
});
test("stale or untrusted windows do not generate low-quota alerts", async () => {
  const alerts = [], h = setup({ config: { threshold: 20 }, alert: e => alerts.push(e), execute: () => ({ code: 0, stdout: JSON.stringify(report("codex", { windows: [{ id: "w", percentRemaining: 0 }], state: { status: "fresh", stale: false, untrustedWindowIds: ["w"] } })) }) });
  await h.store.refresh(null, "linux"); assert.equal(alerts.length, 0);
});
