import { CONFIG_KEY, normalizeConfig } from "../mods/quota-manager/config.js";
import { QuotaStore } from "../mods/quota-manager/store.js";
export const NOW = Date.parse("2026-11-12T16:00:00Z");
export const report = (id = "codex", extra = {}, now = NOW) => ({
  schemaVersion: 5, generatedAt: new Date(now).toISOString(),
  providers: [{ provider: id, accountKeys: ["default"], plan: "pro", windows: [
    { id: "week", label: "Weekly", kind: "weekly", percentRemaining: 25, resetsAt: new Date(now + 86400000).toISOString() },
  ], state: { status: "fresh", stale: false }, ...extra }],
});
export function setup({ config = {}, execute, alert } = {}) {
  const data = new Map(), calls = [];
  let clock = NOW;
  const all = normalizeConfig();
  const providers = Object.fromEntries(Object.keys(all.providers).map(id => [id, { query: id === "codex", show: id === "codex" }]));
  data.set(CONFIG_KEY, normalizeConfig({ consent: true, providers, ...config }));
  const read = key => data.get(key);
  const write = (key, value) => data.set(key, value);
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    if (execute) return execute(command, args, options);
    const id = args[args.indexOf("--provider") + 1];
    return { code: 0, stdout: JSON.stringify(report(id, {}, clock)), stderr: "" };
  };
  const now = () => clock;
  const store = new QuotaStore({ read, write, exec, now, alert });
  return { store, data, read, write, exec, now, calls, advance: ms => { clock += ms; } };
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const flush = () => new Promise(resolve => setImmediate(resolve));
