import { IDS } from "./providers.js";
import { CONFIG_KEY, normalizeConfig, selectedProviders } from "./config.js";
import { fetchQuota } from "./command.js";
import { validWindow, recordHistory } from "./model.js";
export function stateKey(kind, host, id) { return `quota-manager.v1.${kind}:${JSON.stringify([host ?? null, id])}`; }
const safeErrors = ["cli_missing", "cli_failed", "invalid_report", "host_unavailable"];
export class QuotaStore {
  constructor({ read, write, exec, now = Date.now, random = Math.random, alert = () => {}, local = null }) {
    Object.assign(this, { read, write, exec, now, random, alert, local });
    this.closed = false;
  }
  config() { return normalizeConfig(this.read(CONFIG_KEY)); }
  snapshot(host, id) { return this.read(stateKey("cache", host, id)) ?? null; }
  busy(host, id) { return (this.read(stateKey("lease", host, id))?.until ?? 0) > this.now(); }
  async refresh(host, platform, { force = false, only = null, deadline = null } = {}) {
    this.prune(host);
    const config = this.config();
    const ids = selectedProviders(config).filter(id => !only || only === id);
    let at = 0;
    const worker = async () => {
      while (!this.closed && at < ids.length) {
        const id = ids[at++];
        await this.refreshOne(host, id, platform, force, deadline);
      }
    };
    await Promise.all([worker(), worker()]);
  }
  async refreshOne(host, id, platform, force, deadline = null) {
    const cfg = this.config(), start = this.now(), old = this.snapshot(host, id);
    if (this.closed || !selectedProviders(cfg).includes(id) || this.busy(host, id)) return;
    // Manual mode never fetches automatically, even on startup or a machine switch.
    if (!force && (!cfg.interval || (old?.nextAt ?? 0) > start)) return;
    if (force && ((old?.attemptAt ?? -Infinity) + 5000 > start || (old?.retryAt ?? 0) > start)) return;
    if (IDS.filter(p => this.busy(host, p)).length >= 2) return;
    const lockKey = stateKey("lease", host, id);
    const token = `${start}-${this.random()}`;
    // Shared synchronous state serializes admission across all copies in this app window.
    this.write(lockKey, { token, until: start + 150000 });
    try {
      const lanes = await fetchQuota(this.exec, id, { on: host, platform, force, now: this.now,
        local: host == null ? this.local : null, deadline: host == null ? deadline : null });
      if (!this.current(cfg, id, lockKey, token)) return;
      const now = this.now(), fresh = lanes.some(l => l.status === "fresh" && !l.stale);
      const failures = fresh ? 0 : (old?.failures ?? 0) + 1;
      const retryAt = Math.max(0, ...lanes.map(l => l.retryAt ?? 0));
      this.write(stateKey("cache", host, id), {
        lanes, attemptAt: now, failures, retryAt, error: null,
        nextAt: Math.max(now + this.delay(cfg, failures), retryAt),
      });
      if (cfg.history) this.write(stateKey("history", host, id), recordHistory(this.read(stateKey("history", host, id)), lanes, now));
      this.alerts(host, id, lanes, cfg);
    } catch (e) {
      if (!this.current(cfg, id, lockKey, token)) return;
      const now = this.now(), failures = (old?.failures ?? 0) + 1;
      this.write(stateKey("cache", host, id), {
        lanes: (old?.lanes ?? []).map(l => ({ ...l, stale: true })),
        attemptAt: now, failures, retryAt: 0, nextAt: now + this.delay(cfg, failures),
        error: safeErrors.includes(e.message) ? e.message : "cli_failed",
      });
    } finally {
      if (this.read(lockKey)?.token === token) this.write(lockKey, null);
    }
  }
  current(cfg, id, key, token) {
    const latest = this.config();
    return !this.closed && latest.revision === cfg.revision && selectedProviders(latest).includes(id) && this.read(key)?.token === token;
  }
  delay(cfg, failures) { return Math.min(3600000, Math.max(cfg.interval, 60000) * 2 ** Math.min(failures, 6)); }
  alerts(host, id, lanes, cfg) {
    if (!cfg.threshold) return;
    const key = stateKey("alerts", host, id), previous = this.read(key) ?? {}, next = {};
    for (const lane of lanes) {
      if (lane.status !== "fresh" || lane.stale) continue;
      for (const w of lane.windows.filter(w => validWindow(w, this.now()))) {
        const k = JSON.stringify([lane.key, w.id, w.resetsAt, cfg.threshold]);
        const low = w.remaining <= cfg.threshold;
        next[k] = low || (!!previous[k] && w.remaining < cfg.threshold + 3);
        if (low && !previous[k]) {
          try { this.alert({ host, provider: id, label: w.label, remaining: w.remaining }); } catch { /* A toast must not invalidate quota. */ }
        }
      }
    }
    this.write(key, next);
  }
  prune(host) {
    for (const id of IDS) {
      const key = stateKey("history", host, id), history = this.read(key);
      if (!Array.isArray(history) || !history.length) continue;
      const kept = history.filter(p => p.at > this.now() - 30 * 86400000).slice(-120);
      if (kept.length !== history.length) this.write(key, kept);
    }
  }
  clearHistory(host, ids) { for (const id of ids) this.write(stateKey("history", host, id), []); }
  close() { this.closed = true; } // Herdr owns task cancellation; an already-running exec may finish.
}
