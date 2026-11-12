import { IDS } from "./providers.js";
export const CONFIG_KEY = "quota-manager.v1.config";
export const INTERVALS = [0, 60000, 120000, 300000, 600000];
export const KINDS = ["session", "weekly", "monthly", "model", "credits", "unknown"];
const initial = ["codex", "agy", "grok", "cursor"];
const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
export function normalizeConfig(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const order = [...new Set([...(Array.isArray(r.order) ? r.order.filter(id => IDS.includes(id)) : []), ...IDS])];
  const providers = {};
  for (const id of IDS) {
    const p = r.providers?.[id];
    providers[id] = {
      query: bool(p?.query, initial.includes(id)) && (id !== "muse" || r.museConsent === true),
      show: bool(p?.show, initial.includes(id)),
    };
  }
  return {
    version: 1,
    revision: Number.isSafeInteger(r.revision) && r.revision >= 0 ? r.revision : 0,
    consent: r.consent === true,
    museConsent: r.museConsent === true,
    providers, order,
    interval: INTERVALS.includes(r.interval) ? r.interval : 120000,
    mode: r.mode === "detailed" ? "detailed" : "compact",
    percentage: r.percentage === "used" ? "used" : "remaining",
    language: r.language === "zh" ? "zh" : "en",
    scope: r.scope === "local" ? "local" : "current",
    sort: r.sort === "remaining" ? "remaining" : "custom",
    threshold: [0, 5, 10, 20].includes(r.threshold) ? r.threshold : 0,
    history: r.history === true,
    showUnavailable: bool(r.showUnavailable, true),
    kinds: Object.fromEntries(KINDS.map(k => [k, bool(r.kinds?.[k], true)])),
  };
}
export function changeConfig(current, patch) {
  const c = normalizeConfig(current);
  return normalizeConfig({ ...c, ...patch, revision: c.revision + 1,
    providers: { ...c.providers, ...(patch.providers ?? {}) },
    kinds: { ...c.kinds, ...(patch.kinds ?? {}) } });
}
export function moveProvider(config, id, delta) {
  const order = [...config.order], at = order.indexOf(id), next = at + delta;
  if (at < 0 || next < 0 || next >= order.length) return config;
  [order[at], order[next]] = [order[next], order[at]];
  return changeConfig(config, { order });
}
export function selectedProviders(config) {
  return config.consent ? config.order.filter(id => config.providers[id].query) : [];
}
export function machineFor(config, spaces, pinned) {
  if (pinned !== undefined) return pinned;
  return config.scope === "local" ? null : (spaces.find(s => s.active)?.machine ?? null);
}
