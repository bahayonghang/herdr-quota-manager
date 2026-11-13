// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { annotateQuotaAdvice } from "./advice.js";
import {
  fetchLockPathFor, isSnapshotFile, readReusableProviders, readSnapshotProviders, stampReadingInputs, writeCachedProviders,
} from "./cache.js";
import { CLAUDE_PROFILES_ENV, claudeListedProfiles } from "./lib/claude-profile.js";
import { takeFetchTurn } from "./lib/fetch-lock.js";
import { withInputTrace } from "./lib/input-trace.js";
import { withQuotaSemantics } from "./interpretation.js";
import { providerPresence } from "./lib/source-attempts.js";
import { nowIso } from "./lib/time.js";
import { coalesceVerifiedSubscriptions, fetchAccountQuotas } from "./providers/accounts.js";
import { failedProvider } from "./providers/common.js";
import { claudeSwapEnabled } from "./providers/claude-swap.js";
import { PROVIDERS } from "./providers/index.js";
import { quotaJsonReport } from "./render.js";
import { AxiError, delimiter, runWithRuntimeContext, runtimeProcess } from "./runtime.js";

const SNAPSHOT_ENV = "QUOTA_AXI_SNAPSHOT";
function snapshotFile() { return runtimeProcess.env[SNAPSHOT_ENV]?.trim() || undefined; }

function validateClaudeProfiles(providers, options) {
  if (!providers.includes("claude") || options.credentialMode === "profile-only") return;
  const [invalid] = claudeListedProfiles()?.invalid ?? [];
  if (invalid === undefined) return;
  throw new AxiError(`${CLAUDE_PROFILES_ENV} entry ${JSON.stringify(invalid)} is not an absolute path`, "VALIDATION_ERROR", [
    `List each Claude config directory as an absolute path, separated by "${delimiter}"`,
  ]);
}

async function tracedReadings(provider, options) {
  const { value, inputs } = await withInputTrace(() => fetchAccountQuotas(PROVIDERS[provider], options));
  for (const reading of value) stampReadingInputs(reading, inputs);
  return value;
}

function reusableReadings(provider, maxAgeSeconds) {
  try { return readReusableProviders(provider, maxAgeSeconds); }
  catch { return undefined; }
}

function snapshotReadings(provider, file) {
  let readings;
  try { readings = readSnapshotProviders(file, provider); }
  catch { readings = undefined; }
  if (Array.isArray(readings)) {
    return coalesceVerifiedSubscriptions(readings.map(reading => ({
      ...reading,
      state: { ...reading.state, sourcesTried: ["snapshot"] },
    })));
  }
  return [failedProvider({
    provider,
    label: PROVIDERS[provider].label,
    status: "unavailable",
    error: readings === "expired" ? "snapshot_expired" : "not_in_snapshot",
    sourcesTried: ["snapshot"],
  })];
}

async function readProvider(provider, options, maxAgeSeconds, markCached) {
  if (!(maxAgeSeconds > 0)) return tracedReadings(provider, options);
  const reused = reusableReadings(provider, maxAgeSeconds);
  if (reused) return reused;
  const turn = await takeFetchTurn(fetchLockPathFor(provider), () => reusableReadings(provider, maxAgeSeconds));
  if (turn.kind === "answered") return turn.value;
  if (turn.kind === "unlocked") return tracedReadings(provider, options);
  try {
    const readings = await tracedReadings(provider, options);
    const readingAt = nowIso();
    writeCachedProvidersBestEffort(readings.map(r => withQuotaSemantics(r, readingAt)), readingAt);
    markCached();
    return readings;
  } finally {
    turn.lock?.release?.();
  }
}

function writeCachedProvidersBestEffort(providers, readingAt) {
  try { writeCachedProviders(providers, readingAt); }
  catch { return; }
}

async function fetchQuotaCore(providers, options, maxAgeSeconds = 0) {
  const snapshot = snapshotFile();
  if (snapshot && !isSnapshotFile(snapshot)) {
    throw new AxiError(`${SNAPSHOT_ENV} is not a readable quota snapshot`, "VALIDATION_ERROR");
  }
  if (!snapshot && !claudeSwapEnabled()) validateClaudeProfiles(providers, options);
  const writesCache = options.credentialMode !== "profile-only" && !snapshot;
  const cached = new Set();
  const fetched = (await Promise.all(providers.map(provider => snapshot
    ? snapshotReadings(provider, snapshot)
    : readProvider(provider, options, writesCache ? maxAgeSeconds : 0, () => cached.add(provider))))).flat();
  const generatedAt = nowIso();
  const results = fetched.map(provider => withQuotaSemantics(provider, generatedAt));
  if (writesCache) writeCachedProvidersBestEffort(results.filter(p => !cached.has(p.provider)), generatedAt);
  return annotateQuotaAdvice({ generatedAt, providers: results });
}

export async function queryLocalQuota(id, { force = false, home = "", appHome = "", platform = "unknown", snapshot, env, fetchImpl, deadline } = {}) {
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(PROVIDERS, id)) {
    throw new Error("Unsupported provider");
  }
  return runWithRuntimeContext({ id, home, appHome, platform, snapshot, env, fetchImpl, deadline }, async () => {
    const options = { allowKeychainPrompt: false, refreshCredentials: false };
    const response = await fetchQuotaCore([id], options, force ? 0 : 90);
    const laneAbsent = response.providers.map(p => providerPresence(p, PROVIDERS[p.provider]) === "absent");
    return JSON.stringify(quotaJsonReport(response, false, laneAbsent));
  });
}
