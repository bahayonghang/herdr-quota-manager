import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG_KEY, normalizeConfig } from "../mods/quota-manager/config.js";
import { normalizeReport } from "../mods/quota-manager/model.js";
import { stateKey } from "../mods/quota-manager/store.js";
import { report, flush } from "./helpers.mjs";
let folder, Mod, host;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), "quota-ui-"));
  await cp(fileURLToPath(new URL("../mods/quota-manager/", import.meta.url)), folder, { recursive: true });
  await writeFile(join(folder, "package.json"), '{"type":"module"}');
  await cp(fileURLToPath(new URL("./mock-kit.mjs", import.meta.url)), join(folder, "mock-kit.mjs"));
  await cp(fileURLToPath(new URL("./mock-host.mjs", import.meta.url)), join(folder, "mock-host.mjs"));
  for (const name of await readdir(folder)) if (name.endsWith(".js")) {
    const path = join(folder, name), code = await readFile(path, "utf8");
    await writeFile(path, code.replaceAll('from "gpui-kit"', 'from "./mock-kit.mjs"').replaceAll('from "gpui-base"', 'from "./mock-kit.mjs"').replaceAll('from "herdr"', 'from "./mock-host.mjs"'));
  }
  Mod = (await import(pathToFileURL(join(folder, "main.js")))).default;
  host = await import(pathToFileURL(join(folder, "mock-host.mjs")));
});
after(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });
function harness(view = "bar", config = {}) {
  host.reset(); host.state.props = view === "bar" ? {} : { view, overlay: "test", on: null };
  host.setShared(CONFIG_KEY, normalizeConfig(config));
  const errors = [], timers = [];
  const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
    timer: { every: (ms, fn) => timers.push([ms, fn]) },
    spawn: fn => { Promise.resolve().then(() => fn(cx)).catch(e => errors.push(e)); },
  };
  const mod = new Mod(); mod.init({}, cx);
  return { mod, cx, errors, timers };
}
function nodes(node) { return !node || typeof node !== "object" ? [] : [node, ...(node.content ?? []).flatMap(nodes)]; }
function find(tree, id) {
  const found = nodes(tree).find(n => n.attrs.id === id);
  assert.ok(found, `Missing control ${id}`); return found;
}
function click(h, id) { find(h.mod.render(h.cx), id).events.on_click({}, h.cx); }
function cache(id = "codex", extra = {}) {
  const now = Date.now(), lanes = normalizeReport(report(id, extra, now), id, now);
  host.setShared(stateKey("cache", null, id), { lanes, attemptAt: now, nextAt: now + 120000, retryAt: 0, error: null });
  return lanes;
}
for (const view of ["bar", "usage", "settings", "history", "help"]) test(`${view} renders with strict native-API-shaped stubs and does not query before consent`, async () => {
  const h = harness(view); const tree = h.mod.render(h.cx);
  assert.ok(nodes(tree).length > 5); await flush();
  assert.equal(host.state.executions.length, 0); assert.deepEqual(h.errors, []); h.mod.close();
});
test("all window kinds, missing data, account lanes and stale states render", () => {
  const h = harness("usage", { mode: "detailed" });
  cache("codex"); cache("cursor", { windows: [], state: { status: "auth_required", reason: "credentials_expired" } });
  cache("grok", { windows: [], credits: { remaining: 3.25, unit: "usd" } });
  cache("agy", { windows: [{ id: "a", label: "share", shareOf: "parent", percentUsed: 10 }, { id: "b", resetsAt: "2000-01-01T00:00:00Z", percentRemaining: 10 }] });
  const all = nodes(h.mod.render(h.cx)); assert.ok(all.length > 50);
  const ids = all.map(n => n.attrs.id).filter(Boolean); assert.equal(ids.length, new Set(ids).size); h.mod.close();
});
test("query and display toggles are independent and persist", () => {
  const h = harness("settings"); click(h, "query-codex");
  assert.equal(h.mod.config().providers.codex.query, false); assert.equal(h.mod.config().providers.codex.show, true);
  click(h, "show-codex"); assert.equal(h.mod.config().providers.codex.show, false); h.mod.close();
});
test("ordering controls and keyboard controls update the actual preference", () => {
  const h = harness("settings"); click(h, "down-codex"); assert.equal(h.mod.config().order[1], "codex");
  h.mod.key({ keystroke: "space" }, h.cx); assert.equal(h.mod.config().providers.agy.query, false); h.mod.close();
});
test("language and detailed-mode controls persist", () => {
  const h = harness("settings"); click(h, "language-zh"); assert.equal(h.mod.config().language, "zh");
  click(h, "tab-usage"); click(h, "mode-detailed"); assert.equal(h.mod.config().mode, "detailed"); h.mod.close();
});
test("explicit Start begins selected queries, not every catalog provider", async () => {
  const h = harness("settings", { interval: 0 }); click(h, "consent"); await flush(); await flush();
  assert.equal(h.mod.config().consent, true);
  assert.equal(host.state.executions.length, 4);
  assert.deepEqual(host.state.executions.map(c => c[1][2]).sort(), ["agy", "codex", "cursor", "grok"]); h.mod.close();
});
test("Muse opt-in requires confirmation before enabling", () => {
  const h = harness("settings"); click(h, "query-muse"); assert.equal(h.mod.config().providers.muse.query, false);
  click(h, "muse-confirm"); assert.equal(h.mod.config().providers.muse.query, true); assert.equal(h.mod.config().museConsent, true); h.mod.close();
});
test("detection and select-detected use the frozen popup machine and skip implicit Muse consent", async () => {
  const h = harness("settings"); host.state.spaces = [{ active: true, machine: "remote" }];
  host.state.agents = [{ key: "codex", installed: true }, { key: "muse", installed: true }];
  click(h, "detect"); await flush(); click(h, "select-detected");
  assert.equal(host.state.detectOn, null); assert.equal(h.mod.config().providers.codex.query, true);
  assert.equal(h.mod.config().providers.cursor.query, false); assert.equal(h.mod.config().providers.muse.query, false); h.mod.close();
});
test("compact bar exposes overflow and opens a machine-pinned popup", () => {
  const h = harness("bar"); h.mod.width = 220; host.state.spaces = [{ active: true, machine: "remote" }];
  click(h, "overflow"); assert.equal(host.state.overlays[0].props.on, "remote"); h.mod.close();
});
test("remaining sort uses a valid numeric comparator", () => {
  const h = harness("usage", { sort: "remaining" });
  cache("codex", { windows: [{ id: "a", percentRemaining: 80 }] });
  cache("grok", { windows: [{ id: "a", percentRemaining: 10 }] });
  assert.equal(h.mod.items(h.mod.config())[0].id, "grok"); h.mod.close();
});
test("popup close and Escape use the actual overlay id", () => {
  const h = harness("usage"); click(h, "close"); assert.equal(host.state.closed, "test");
  host.state.closed = null; h.mod.key({ keystroke: "escape" }, h.cx); assert.equal(host.state.closed, "test"); h.mod.close();
});
