import { assertProvider } from "./providers.js";
const number = v => typeof v === "number" && Number.isFinite(v) ? v : null;
const percent = v => number(v) === null ? null : Math.min(100, Math.max(0, v));
const time = v => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const statuses = ["fresh", "stale", "unavailable", "auth_required", "rate_limited", "error"];
const reasons = ["keychain_access_required", "credentials_expired", "inference_opt_in_required"];
export function safeText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/(?:Bearer\s+\S+|sk-[\w-]+|eyJ[\w.-]+)/gi, "[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[account]").slice(0, 80);
}
// Pseudonymous local lane key. Not a cryptographic anonymization guarantee.
export function laneKey(value) {
  const text = JSON.stringify(value);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
export function parseReport(stdout) {
  if (typeof stdout !== "string" || stdout.length > 1048576) throw new Error("invalid_report");
  // Some login shells emit a banner. Only accept a complete JSON object on a line boundary.
  const text = stdout.replace(/^\uFEFF/, "");
  let offset = 0, tries = 0;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("{")) {
      if (++tries > 16) break;
      try {
        const report = JSON.parse(text.slice(offset));
        if (report && Array.isArray(report.providers) && [5, 6].includes(report.schemaVersion)) return report;
      } catch { /* A banner is not JSON; never log it. */ }
    }
    offset += line.length + 1;
  }
  throw new Error("invalid_report");
}
export function normalizeReport(report, id, now = Date.now()) {
  assertProvider(id);
  if (!report || ![5, 6].includes(report.schemaVersion) || !Array.isArray(report.providers)) throw new Error("invalid_report");
  const rows = report.providers.filter(p => p?.provider === id);
  if (!rows.length || rows.length > 64) throw new Error("invalid_report");
  const generatedAt = time(report.generatedAt);
  if (generatedAt === null) throw new Error("invalid_report");
  const seen = new Set();
  return rows.map(p => {
    const state = p.state ?? {};
    const untrusted = new Set(Array.isArray(state.untrustedWindowIds) ? state.untrustedWindowIds : []);
    const refreshedAt = time(state.refreshedAt) ?? generatedAt;
    const key = laneKey([id, p.accountKey ?? p.accountKeys?.[0] ?? "default"]);
    if (seen.has(key)) throw new Error("invalid_report");
    seen.add(key);
    const windows = (Array.isArray(p.windows) ? p.windows : []).filter(w => w && typeof w === "object").slice(0, 100).map((w, index) => {
      const share = typeof w.shareOf === "string";
      const used = percent(w.percentUsed);
      const remaining = share ? null : percent(w.percentRemaining) ?? (used === null ? null : 100 - used);
      return {
        id: safeText(w.id, `window-${index}`), label: safeText(w.label, "Quota"),
        kind: ["session", "weekly", "monthly", "model", "credits"].includes(w.kind) ? w.kind : "unknown",
        remaining, used: used ?? (remaining === null ? null : 100 - remaining), share,
        trusted: !untrusted.has(w.id), resetsAt: time(w.resetsAt),
        spentUsd: number(w.spentUsd), limitUsd: number(w.limitUsd),
        remainingCredits: number(w.remainingCredits), creditUnit: safeText(w.creditUnit, "credits"),
      };
    });
    return {
      key, provider: id, plan: safeText(p.plan), windows,
      status: statuses.includes(state.status) ? state.status : "unavailable",
      stale: state.stale === true || state.status !== "fresh" || refreshedAt > now + 60000,
      refreshedAt: Math.min(now, refreshedAt),
      retryAt: time(state.retryAfter),
      reason: reasons.includes(state.reason) ? state.reason : null,
      notSetUp: p.notSetUp === true,
      credits: p.credits ? {
        remaining: number(p.credits.remaining), unlimited: p.credits.unlimited === true,
        unit: ["usd", "cny", "credits"].includes(p.credits.unit) ? p.credits.unit : "credits",
      } : null,
    };
  });
}
export function validWindow(w, now = Date.now()) {
  return w.trusted && !w.share && w.remaining !== null && (!w.resetsAt || w.resetsAt > now);
}
export function visibleWindows(lane, config) { return lane.windows.filter(w => config.kinds[w.kind]); }
export function headline(lane, config, now = Date.now()) {
  return visibleWindows(lane, config).filter(w => validWindow(w, now)).sort((a, b) => a.remaining - b.remaining)[0] ?? null;
}
export function isStale(lane, config, now = Date.now()) {
  return lane.stale || now - lane.refreshedAt > Math.max(600000, config.interval * 3);
}
export function displayPercent(w, config, now = Date.now()) {
  if (!w.trusted || (w.resetsAt && w.resetsAt <= now)) return null;
  return w.share || config.percentage === "used" ? w.used : w.remaining;
}
export function countdown(at, now = Date.now()) {
  if (!at) return "—";
  if (at <= now) return "0m";
  const m = Math.ceil((at - now) / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h`;
}
export function recordHistory(history, lanes, now) {
  const previous = Array.isArray(history) ? history : [];
  const rows = lanes.filter(l => l.status === "fresh" && !l.stale).map(l => ({
    key: l.key, windows: l.windows.filter(w => validWindow(w, now)).map(w => ({ id: w.id, label: w.label, remaining: w.remaining, resetsAt: w.resetsAt })),
  })).filter(l => l.windows.length);
  if (!rows.length) return previous;
  return [...previous.filter(p => p.at > now - 30 * 86400000), { at: now, rows }].slice(-120);
}
