import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeConfig, CONFIG_KEY } from "../../../../../../mods/quota-manager/config.js";
import { headline } from "../../../../../../mods/quota-manager/model.js";

const base = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const state = JSON.parse(await readFile(join(base, "shared.json"), "utf8"));
const cfg = normalizeConfig(state[CONFIG_KEY]);
const now = Date.now();
const caches = Object.entries(state).filter(([k]) => k.startsWith("quota-manager.v1.cache:"));
const remoteCount = caches.filter(([k]) => JSON.parse(k.slice(k.indexOf(":") + 1))[0] !== null).length;
const providers = ["codex", "agy", "grok"].map(id => {
  const cache = state[`quota-manager.v1.cache:${JSON.stringify([null, id])}`];
  return { id, query: cfg.providers[id].query, show: cfg.providers[id].show,
    cached: !!cache, ageSeconds: cache ? Math.round((now - cache.attemptAt) / 1000) : null,
    error: ["cli_missing", "cli_failed", "invalid_report", "host_unavailable"].includes(cache?.error) ? cache.error : null,
    lanes: (cache?.lanes ?? []).map(l => ({ status: l.status, stale: l.stale,
      windowCount: l.windows.length, remaining: headline(l, cfg, now)?.remaining ?? null,
      windows: l.windows.map(w => ({ kind: w.kind, remaining: w.remaining, trusted: w.trusted, resetFuture: w.resetsAt > now })) })) };
});
const normalized = JSON.stringify(caches.map(([, v]) => v));
const sensitive = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|Bearer\s+[\w.-]+|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\./i.test(normalized);
console.log(JSON.stringify({ scope: cfg.scope, consent: cfg.consent, revision: cfg.revision,
  hiddenCursorQuery: cfg.providers.cursor.query, remoteCacheCount: remoteCount,
  sensitiveValueDetectedInQuotaCaches: sensitive, providers }, null, 2));
