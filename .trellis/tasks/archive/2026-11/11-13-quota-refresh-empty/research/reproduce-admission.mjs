import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_KEY, normalizeConfig, selectedProviders } from "../../../../../../mods/quota-manager/config.js";
import { QuotaStore } from "../../../../../../mods/quota-manager/store.js";

// Sanitized observed preferences: no access to real credentials, shared state,
// provider endpoints, or Herdr mutations. All collection below uses fake reports.
const observed = normalizeConfig({
  consent: false, scope: "current", revision: 7,
  providers: Object.fromEntries(Object.keys(normalizeConfig().providers).map(id => [id, {
    query: id === "cursor", show: ["codex", "agy", "grok"].includes(id),
  }])),
});
const folder = await mkdtemp(join(tmpdir(), "quota-admission-analysis-"));
try {
  await cp(resolve("mods/quota-manager"), folder, { recursive: true });
  await writeFile(join(folder, "package.json"), '{"type":"module"}');
  for (const name of ["mock-kit.mjs", "mock-host.mjs"]) await cp(resolve("tests", name), join(folder, name));
  for (const name of await readdir(folder)) if (name.endsWith(".js")) {
    const file = join(folder, name);
    const source = await readFile(file, "utf8");
    await writeFile(file, source.replaceAll('from "gpui-kit"', 'from "./mock-kit.mjs"')
      .replaceAll('from "gpui-base"', 'from "./mock-kit.mjs"').replaceAll('from "herdr"', 'from "./mock-host.mjs"'));
  }
  const Mod = (await import(pathToFileURL(join(folder, "main.js")))).default;
  const host = await import(pathToFileURL(join(folder, "mock-host.mjs")));
  const nodes = n => !n || typeof n !== "object" ? [] : [n, ...(n.content ?? []).flatMap(nodes)];
  const find = (tree, id) => nodes(tree).find(n => n.attrs.id === id);
  const scenarios = [
    ["observed-settings", observed, []],
    ["consent-only", { ...observed, consent: true }, ["cursor"]],
    ["query-only", { ...observed, providers: { ...observed.providers, codex: { query: true, show: true } } }, []],
    ["consent-and-three-queries", { ...observed, consent: true,
      providers: Object.fromEntries(Object.entries(observed.providers).map(([id, p]) => [id, { ...p, query: p.show }])) }, ["codex", "agy", "grok"]],
  ];
  for (const target of [null, "diagnostic-remote"]) for (const [name, input, expected] of scenarios) {
    host.reset();
    const cfg = normalizeConfig(input), calls = [], pending = [];
    host.setShared(CONFIG_KEY, cfg);
    host.state.spaces = [{ active: true, machine: target }];
    const fake = id => JSON.stringify({ schemaVersion: 5, generatedAt: new Date().toISOString(), providers: [{
      provider: id, windows: [{ id: "w", kind: "weekly", percentRemaining: 42,
        resetsAt: new Date(Date.now() + 86400000).toISOString() }], state: { status: "fresh", stale: false },
    }] });
    const store = new QuotaStore({ read: host.shared, write: host.setShared,
      exec: async (_command, args, options) => {
        const id = args[args.indexOf("--provider") + 1];
        assert.equal(options.on, target); calls.push(id);
        return { code: 0, stdout: fake(id) };
      },
      local: async id => { calls.push(id); return fake(id); },
    });
    const mod = new Mod();
    Object.assign(mod, { store, screen: "bar", width: 1200, focusHandle: {} });
    const cx = { notify() {}, stop_propagation() {}, spawn(fn) { pending.push(Promise.resolve().then(() => fn(cx))); } };
    find(mod.render(cx), "bar-refresh").events.on_click({}, cx);
    await Promise.all(pending);
    assert.deepEqual(calls, expected);
    const tree = mod.render(cx);
    const chips = nodes(tree).filter(n => n.attrs.id?.startsWith("chip-")).map(chip => ({
      id: chip.attrs.id.split("-")[1],
      text: nodes(chip).flatMap(n => n.content).find(x => x === "—" || /^\d+%$/.test(String(x))),
      paused: chip.attrs.accessibility_label.includes("Paused"),
    }));
    assert.deepEqual(chips.map(c => c.text), name === "consent-and-three-queries" ? ["42%", "42%", "42%"] : ["—", "—", "—"]);
    console.log(JSON.stringify({ target: target === null ? "local" : "remote", scenario: name,
      admitted: selectedProviders(cfg), collectorCalls: calls, chips }));
    mod.close();
  }
} finally {
  await rm(folder, { recursive: true, force: true });
}
