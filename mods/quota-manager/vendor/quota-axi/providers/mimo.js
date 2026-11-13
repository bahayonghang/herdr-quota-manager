// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { runtimeProcess } from "../runtime.js";
import { readJsonFileResult } from "../lib/fs.js";
import { resolvePiAuthFilePath } from "../lib/pi-agent-dir.js";
import { classifyPiAuthEntry } from "../lib/pi-auth-store.js";
import { usableLiteralSecret } from "../lib/secret.js";
import { failedProvider, sourceNames } from "./common.js";
import { inspectEnvPiAuth, keyCredentialFailure, preferCredentialFailure, pushEnvCredential, pushPiReadCredential, } from "./env-pi-credential.js";
export const MIMO_ENV_SOURCE = "env:MIMO_API_KEY";
/**
 * Pi stores Xiaomi MiMo's keys under the vendor's own provider entry names,
 * not under `mimo`: the pay-as-you-go key plus one Token Plan key per cluster.
 * Each entry is its own credential source (`pi:<entry id>`) in this declared
 * order, so a report names the exact entry that answered, a present-but-unusable
 * entry stays visible as present rather than absent, and an absent entry never
 * speaks for a sibling store.
 */
export const MIMO_PI_PROVIDER_IDS = [
    "xiaomi",
    "xiaomi-token-plan-sgp",
    "xiaomi-token-plan-cn",
    "xiaomi-token-plan-ams",
];
/** Attempt and inspection source name for one Pi entry. */
export function mimoPiSource(piProviderId) {
    return `pi:${piProviderId}`;
}
const LABEL = "MiMo";
export function resolveMimoCredentials(environment = runtimeProcess.env, path = resolvePiAuthFilePath()) {
    const credentials = [];
    pushEnvCredential(credentials, environment, "MIMO_API_KEY", MIMO_ENV_SOURCE);
    const result = readJsonFileResult(path);
    for (const piProviderId of MIMO_PI_PROVIDER_IDS) {
        pushPiReadCredential(credentials, result, mimoPiSource(piProviderId), path, (value) => extractMimoPiEntry(value, piProviderId, path));
    }
    return credentials;
}
/**
 * Pi's entry boundary: only `classifyPiAuthEntry` decides absent versus
 * present, and only a literal `type: "api_key"` record with a usable `key` is
 * a MiMo credential - Pi never writes an OAuth-shaped Xiaomi entry, so any
 * other shape is a present but unusable credential, not usable model auth.
 */
export function extractMimoPiEntry(value, piProviderId, path) {
    const source = mimoPiSource(piProviderId);
    const classified = classifyPiAuthEntry(value, piProviderId);
    if (classified.status === "missing")
        return { status: "missing", source, path };
    if (classified.status === "invalid")
        return { status: "invalid", source, path };
    const key = classified.entry.type === "api_key"
        ? usableLiteralSecret(classified.entry.key)
        : undefined;
    return key
        ? { status: "available", key, source, path }
        : { status: "invalid", source, path };
}
export function createMimoAdapter(overrides = {}) {
    const dependencies = {
        credential: () => resolveMimoCredentials(),
        now: Date.now,
        ...overrides,
    };
    return {
        id: "mimo",
        label: LABEL,
        fetchQuota: () => fetchQuotaWithDependencies(dependencies),
        inspectAuth: () => inspectAuthWithDependencies(dependencies),
    };
}
export const mimoAdapter = createMimoAdapter();
async function fetchQuotaWithDependencies(dependencies) {
    const attempts = [];
    let failure;
    for (const resolution of dependencies.credential()) {
        if (resolution.status === "available") {
            attempts.push({ source: resolution.source, status: "success" });
            // MiMo's provider-owned Pi setup establishes API-key authentication,
            // while its quota display is dashboard/cookie based. Do not attach
            // cookies or probe an inference endpoint merely to manufacture a quota
            // reading.
            return {
                provider: "mimo",
                label: LABEL,
                source: "api",
                windows: [],
                state: {
                    status: "fresh",
                    stale: false,
                    authStatus: "usable",
                    refreshedAt: new Date(dependencies.now()).toISOString(),
                    sourcesTried: sourceNames(attempts),
                },
                attempts,
            };
        }
        const local = keyCredentialFailure("mimo", resolution);
        attempts.push({
            source: resolution.source,
            status: resolution.status === "missing" ? "skipped" : "failed",
            error: local.error,
            // Not genuinely absent: a present-but-unusable entry, and an auth store
            // that exists but could not be read (README source-attempt contract).
            ...(resolution.status === "invalid" || resolution.status === "error"
                ? { credentialPresent: true }
                : {}),
        });
        failure = preferCredentialFailure(failure, local);
    }
    const final = failure ?? {
        status: "auth_required",
        error: "mimo_credential_unavailable",
    };
    return failedProvider({
        provider: "mimo",
        label: LABEL,
        status: final.status,
        error: final.error,
        source: "unavailable",
        sourcesTried: sourceNames(attempts),
        attempts,
    });
}
async function inspectAuthWithDependencies(dependencies) {
    const report = inspectEnvPiAuth("mimo", dependencies.credential());
    // `credentialPresent` marks every source that is not genuinely absent, so
    // `auth` and the quota path agree on a present-but-unusable Pi entry and on
    // an auth store that exists but could not be read.
    return {
        ...report,
        sources: report.sources.map((source) => source.status === "available" ||
            source.status === "invalid" ||
            source.status === "error"
            ? { ...source, credentialPresent: true }
            : source),
    };
}
