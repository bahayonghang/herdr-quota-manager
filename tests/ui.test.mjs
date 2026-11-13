import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG_KEY, normalizeConfig } from "../mods/quota-manager/config.js";
import { normalizeReport } from "../mods/quota-manager/model.js";
import { IDS } from "../mods/quota-manager/providers.js";
import { stateKey } from "../mods/quota-manager/store.js";
import { tr } from "../mods/quota-manager/i18n.js";
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
  host.state.home = join(folder, "empty-home");
  host.state.appHome = join(folder, "app-home");
  host.setShared(CONFIG_KEY, normalizeConfig(config));
  const errors = [], timers = [];
  const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
    timer: { every: (ms, fn) => timers.push([ms, fn]) },
    spawn: fn => { Promise.resolve().then(() => fn(cx)).catch(e => errors.push(e)); },
  };
  const mod = new Mod(); mod.init({}, cx);
  return { mod, cx, errors, timers };
}
async function settle(mod, hostName = null, ids = ["agy", "codex", "cursor", "grok"]) {
  for (let i = 0; i < 50; i++) {
    await flush();
    if (!ids.some(id => mod.store.busy(hostName, id))) break;
  }
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
  const h = harness("settings", { interval: 0 }); click(h, "consent"); await settle(h.mod, null, ["agy", "codex", "cursor", "grok"]);
  assert.equal(h.mod.config().consent, true);
  assert.equal(host.state.executions.length, 0);
  for (const id of ["agy", "codex", "cursor", "grok"]) assert.ok(host.shared(stateKey("cache", null, id)));
  for (const id of ["claude", "muse"]) assert.equal(host.shared(stateKey("cache", null, id)), undefined);
  assert.deepEqual(h.errors, []);
  h.mod.close();
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
  const tree = h.mod.render(h.cx);
  find(tree, "overflow");
  assert.equal(nodes(tree).some(n => n.attrs.id === "open"), false);
  assert.equal(nodes(tree).some(n => n.attrs.id === "chip-cursor-empty"), false);
  click(h, "overflow"); assert.equal(host.state.overlays[0].props.on, "remote"); h.mod.close();
});
test("remaining sort uses a valid numeric comparator", () => {
  const h = harness("usage", { sort: "remaining" });
  cache("codex", { windows: [{ id: "a", percentRemaining: 80 }] });
  cache("grok", { windows: [{ id: "a", percentRemaining: 10 }] });
  assert.equal(h.mod.items(h.mod.config())[0].id, "grok"); h.mod.close();
});
test("local init tolerates a null window and still uses a real window platform", async () => {
  const providers = Object.fromEntries(["codex", "agy", "grok", "cursor"].map(id => [id, { query: id === "codex", show: true }]));
  const launch = async (windowValue, spaces = []) => {
    host.reset();
    host.state.home = join(folder, "empty-home");
    host.state.appHome = join(folder, "app-home");
    host.state.window = windowValue;
    host.state.execCode = 127;
    host.state.spaces = spaces;
    host.setShared(CONFIG_KEY, normalizeConfig({ consent: true, interval: 60000, providers }));
    const errors = [];
    const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
      timer: { every() {} },
      spawn: fn => { Promise.resolve().then(() => fn(cx)).catch(e => errors.push(e)); },
    };
    const mod = new Mod();
    mod.init({}, cx);
    mod.render(cx);
    const machine = spaces.find(s => s.active)?.machine ?? null;
    await settle(mod, machine, ["codex"]);
    const cached = Boolean(host.shared(stateKey("cache", machine, "codex")));
    mod.close();
    assert.deepEqual(errors, []);
    return { calls: host.state.executions.map(call => [call[0], call[2].on]), cached };
  };
  assert.deepEqual(await launch(null), { calls: [], cached: true });
  assert.deepEqual(await launch({ platform: "windows" }), { calls: [], cached: true });
  assert.deepEqual(await launch({ platform: "windows" }, [{ active: true, machine: "remote" }]), {
    calls: [["quota-axi", "remote"], ["sh", "remote"], ["cmd.exe", "remote"]],
    cached: true,
  });
});
function swatch(tree, id, text) {
  const chip = find(tree, id);
  const node = nodes(chip).find(n => (n.content ?? []).includes(text));
  assert.ok(node, `${id} has no ${text}`);
  return { chip, node };
}
function weekly(fields) {
  return {
    windows: [{ id: "w", label: "Weekly", kind: "weekly", resetsAt: new Date(Date.now() + 3 * 3600000).toISOString(), ...fields }],
    state: { status: "fresh", stale: false },
  };
}
test("strip digits stay displayPercent and pressure color is strip-only", async () => {
  const cases = [
    [{ consent: true }, { percentRemaining: 64 }, "64%", "theme.ansi2"],
    [{ consent: true, percentage: "used" }, { percentUsed: 36 }, "36%", "theme.ansi2"],
    [{ consent: true }, { percentRemaining: 20 }, "20%", "theme.ansi1"],
    [{ consent: true, percentage: "used" }, { percentUsed: 50 }, "50%", "theme.ansi3"],
    [{ consent: true }, { percentRemaining: 50 }, "50%", "theme.ansi3"],
  ];
  for (const [config, fields, text, color] of cases) {
    const h = harness("bar", config);
    const lanes = cache("codex", weekly(fields));
    const face = swatch(h.mod.render(h.cx), `chip-codex-${lanes[0].key}`, text);
    assert.equal(face.node.attrs.text_color, color, text);
    h.mod.close();
  }
  const h = harness("bar", { consent: true });
  const lanes = cache("codex", weekly({ percentRemaining: 40 }));
  const id = `chip-codex-${lanes[0].key}`;
  const tree = h.mod.render(h.cx);
  assert.equal(swatch(tree, id, "40%").node.attrs.text_color, "theme.ansi3");
  find(tree, id).events.on_click({}, h.cx);
  assert.equal(host.state.overlays[0].props.view, "usage");
  h.mod.screen = "usage";
  const card = find(h.mod.render(h.cx), `provider-codex-${lanes[0].key}`);
  const cardPercent = nodes(card).find(n => (n.content ?? []).includes("40%"));
  assert.equal(cardPercent.attrs.text_color, "theme.ansi2");
  h.mod.close();
  await flush();
});
test("consent off keeps cached digits muted and an empty headline dim", () => {
  const cached = harness("bar", { consent: false });
  const lanes = cache("codex", weekly({ percentRemaining: 64 }));
  const cachedFace = swatch(cached.mod.render(cached.cx), `chip-codex-${lanes[0].key}`, "64%");
  assert.equal(cachedFace.node.attrs.text_color, "theme.muted");
  assert.equal(cachedFace.chip.attrs.accessibility_label.includes(" !"), false);
  cached.mod.close();
  const empty = harness("bar", { consent: false });
  const face = swatch(empty.mod.render(empty.cx), "chip-codex-empty", "—");
  assert.equal(face.node.attrs.text_color, "theme.dim");
  assert.equal(face.chip.attrs.accessibility_label.includes(" !"), false);
  empty.mod.close();
});
test("share-only strip uses the shared key instead of a passed reset", () => {
  const h = harness("bar", { consent: true, providers: { codex: { query: true, show: true } } });
  const lanes = cache("codex", {
    plan: "",
    windows: [{ id: "s", label: "Pool", kind: "weekly", shareOf: "team", percentUsed: 40, resetsAt: "2000-01-01T00:00:00Z" }],
    state: { status: "fresh", stale: false },
  });
  const face = swatch(h.mod.render(h.cx), `chip-codex-${lanes[0].key}`, "—");
  assert.equal(face.node.attrs.text_color, "theme.dim");
  assert.match(face.chip.attrs.accessibility_label, /share used/);
  assert.equal(face.chip.attrs.accessibility_label.includes("Reset due"), false);
  h.mod.close();
});
test("an empty show list renders the short chooser without overflow", () => {
  const providers = Object.fromEntries(IDS.map(id => [id, { query: false, show: false }]));
  const h = harness("bar", { providers });
  const tree = h.mod.render(h.cx);
  const open = find(tree, "open");
  assert.ok(open.content.includes(tr({ language: "en" }, "stripEmpty")));
  find(tree, "bar-refresh");
  find(tree, "bar-settings");
  assert.equal(nodes(tree).some(n => n.attrs.id === "overflow"), false);
  h.mod.close();
});
test("stripEmpty is translated in both languages", () => {
  assert.equal(tr({ language: "en" }, "stripEmpty"), "Choose providers");
  assert.equal(tr({ language: "zh" }, "stripEmpty"), "选择服务");
});
test("default chips and chrome use local icon files", () => {
  const h = harness("bar");
  const tree = h.mod.render(h.cx);
  const bar = find(tree, "quota-manager-bar");
  assert.equal(bar.attrs.bg, "theme.chrome");
  assert.equal(bar.attrs.border_t, 1);
  assert.equal("justify_end" in bar.attrs, false);
  const slot = find(tree, "quota-slot");
  assert.ok("flex_1" in slot.attrs);
  assert.ok("justify_end" in slot.attrs);
  find(tree, "machine-label");
  find(tree, "agent-count");
  assert.equal(find(tree, "palette").content.at(-1), "commands");
  find(tree, "palette").events.on_click({}, h.cx);
  assert.deepEqual(host.state.commands.at(-1), ["app.palette"]);
  const strip = find(tree, "quota-strip");
  assert.ok("flex_none" in strip.attrs);
  assert.equal("bg" in strip.attrs, false);
  assert.equal("border" in strip.attrs, false);
  const marks = {
    codex: ["image", "icons/codex.svg"],
    agy: ["image", "icons/antigravity.svg"],
    grok: ["svg", "icons/grok.svg"],
    cursor: ["svg", "icons/cursor.svg"],
  };
  for (const [id, [kind, path]] of Object.entries(marks)) {
    const chip = find(tree, `chip-${id}-empty`);
    const mark = nodes(chip).find(n => n.kind === kind && n.attrs.path === path);
    assert.ok(mark, id);
    assert.equal(nodes(chip).some(n => n.attrs.path === `mods/quota-manager/icons/${id}.svg`), false);
    if (kind === "svg") assert.equal(mark.attrs.text_color, "theme.foreground");
    else { assert.equal(mark.attrs.w, 14); assert.equal(mark.attrs.h, 14); }
  }
  h.mod.screen = "usage";
  const card = find(h.mod.render(h.cx), "provider-codex-empty");
  const cardImages = nodes(card).filter(n => n.kind === "image");
  assert.equal(cardImages.length, 1);
  assert.equal(cardImages[0].attrs.path, "icons/codex.svg");
  assert.equal(nodes(card).some(n => (n.content ?? []).includes("CX")), false);
  for (const [id, file, label] of [["bar-refresh", "refresh.svg", "Refresh"], ["bar-settings", "settings.svg", "Settings"]]) {
    const control = find(tree, id);
    const icon = nodes(control).find(n => n.kind === "svg");
    assert.equal(icon.attrs.path, `mods/quota-manager/icons/${file}`);
    assert.equal(icon.attrs.size, 13);
    assert.equal(icon.attrs.text_color, "theme.muted");
    assert.equal(control.attrs.tooltip, label);
    assert.equal(control.attrs.accessibility_label, label);
    assert.equal(control.attrs.w, 13);
    assert.equal(control.attrs.px, 0);
  }
  assert.equal(nodes(tree).some(n => n.attrs.id === "open"), false);
  h.mod.close();
});
test("popup close and Escape use the actual overlay id", () => {
  const h = harness("usage"); click(h, "close"); assert.equal(host.state.closed, "test");
  host.state.closed = null; h.mod.key({ keystroke: "escape" }, h.cx); assert.equal(host.state.closed, "test"); h.mod.close();
});
