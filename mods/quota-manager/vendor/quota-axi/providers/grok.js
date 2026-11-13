// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { homedir, join, runtimeProcess, RuntimeAbortController, RuntimeTextDecoder, runtimeSetTimeout, runtimeClearTimeout } from "../runtime.js";
import { readCachedProvider, retireCachedSlot } from "../cache.js";
import { readJsonFileResult } from "../lib/fs.js";
import { providerFetch } from "../lib/http.js";
import { nowIso, retryAfterToIso } from "../lib/time.js";
import { failedProvider, sourceNames, staleFromCache, staleUnlessSignOut, statusFromError, successProvider, } from "./common.js";
import { selectCredential, } from "./credential-selection.js";
import { delegateCredentialRefresh, } from "./delegated-refresh.js";
import { createPiXaiCredentialBroker, } from "./pi-xai-credential.js";
import { withUsageFetchFailure } from "./usage-fetch-failure.js";
const CONSUMER_QUOTA_URL = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
/** Official, read-only model catalogs used only to verify bearer usability. */
const GROK_BUILD_MODELS_URL = "https://cli-chat-proxy.grok.com/v1/models";
const XAI_MODELS_URL = "https://api.x.ai/v1/models";
const API_TIMEOUT_MS = 15_000;
const RESPONSE_LIMIT_BYTES = 64 * 1024;
const GRPC_MESSAGE_LIMIT_CHARS = 1_024;
const EMPTY_GRPC_REQUEST = Uint8Array.from([0, 0, 0, 0, 0]);
const GROK_SOURCE = "web";
const PI_XAI_CREDENTIAL_SOURCE = "pi:xai";
const GROK_CONSUMER_QUOTA_UNAVAILABLE_ERROR = "Grok consumer quota unavailable";
const GROK_MODEL_AUTH_WITHOUT_QUOTA_ERROR = "Grok model access available; quota unavailable";
const GROK_PI_CREDENTIAL_RESOLUTION_ERROR = "Grok Pi credential resolution failed";
const MODEL_AUTH_ONLY_ERROR = "model_auth_only";
const MODEL_AUTH_PROBE_LIVE = "model_auth_probe_live";
const PI_QUOTA_NOT_NEEDED_ERROR = "quota_not_needed";
const PRODUCT_NAMES = {
    0: { id: "unspecified", label: "Other" },
    1: { id: "api", label: "API" },
    2: { id: "grok_build", label: "Grok Build" },
    3: { id: "grok_plugins", label: "Grok Plugins" },
    4: { id: "chat", label: "Chat" },
    5: { id: "imagine", label: "Imagine" },
    6: { id: "voice", label: "Voice" },
};
/**
 * The Grok CLI owns OIDC rotation and owns `~/.grok/auth.json`. `grok models`
 * is the smallest observed non-interactive command that makes it refresh that
 * session and rewrite the file: it prints the account's model list and exits,
 * starting no agent, opening no TUI, and spending no model quota. quota-axi
 * runs it and then re-reads the file the CLI just rewrote; it never performs
 * the OIDC refresh exchange itself.
 */
const GROK_CLI_REFRESH_DELEGATE = {
    source: "grok-cli-refresh",
    command: "grok",
    args: ["models"],
    waitBudgetMs: 20_000,
};
const GROK_SIGN_IN_REQUIRED_ERROR = "Grok sign-in required";
const GROK_ACCESS_TOKEN_EXPIRED_ERROR = "Grok access token expired";
const GROK_CLI_REFRESH_NEEDED = Symbol("grokCliRefreshNeeded");
const defaultGrokDependencies = {
    piXaiBroker: createPiXaiCredentialBroker(),
};
export function createGrokAdapter(overrides = {}) {
    const dependencies = {
        ...defaultGrokDependencies,
        ...overrides,
    };
    return {
        id: "grok",
        label: "Grok",
        fetchQuota: (options) => fetchQuotaWithDependencies(dependencies, options),
        inspectAuth: (_options) => inspectAuthWithDependencies(dependencies),
    };
}
export const grokAdapter = createGrokAdapter();
export async function fetchQuota(options) {
    return fetchQuotaWithDependencies(defaultGrokDependencies, options);
}
export async function inspectAuth(_options) {
    return inspectAuthWithDependencies(defaultGrokDependencies);
}
async function fetchQuotaWithDependencies(dependencies, options) {
    let cliState = readCredentialState();
    const piResolution = await dependencies.piXaiBroker.resolve();
    const candidates = [
        ...cliCandidatesFor(cliState),
    ];
    if (piResolution.status === "available") {
        candidates.push(piResolution.kind === "oauth"
            ? {
                source: PI_XAI_CREDENTIAL_SOURCE,
                localState: "valid",
                credential: {
                    kind: "pi-credits",
                    credentials: {
                        key: piResolution.credential,
                        modelProbeUrl: XAI_MODELS_URL,
                    },
                },
            }
            : {
                source: PI_XAI_CREDENTIAL_SOURCE,
                localState: "valid",
                credential: { kind: "pi-local" },
            });
    }
    else if (piResolution.status === "expired" &&
        piResolution.credential !== undefined) {
        candidates.push({
            source: PI_XAI_CREDENTIAL_SOURCE,
            localState: "expired",
            credential: {
                kind: "pi-credits",
                credentials: {
                    key: piResolution.credential,
                    modelProbeUrl: XAI_MODELS_URL,
                },
            },
            refreshable: piResolution.refreshable,
        });
    }
    const cliCandidates = candidates.filter((candidate) => candidate.source === GROK_SOURCE);
    const piCandidates = candidates.filter((candidate) => candidate.source === PI_XAI_CREDENTIAL_SOURCE);
    let consumerTransient = false;
    const attempt = async (candidate) => {
        const outcome = await attemptGrokCandidate(candidate.credential);
        if (outcome.kind === "transient") {
            consumerTransient = outcome.operation === "consumer_quota";
        }
        return outcome;
    };
    let cliSelection = await selectCredential(cliCandidates, attempt);
    const cliPasses = [{ state: cliState, selection: cliSelection }];
    // Soft expiry the Grok CLI can fix: hand the rotation back to the CLI that
    // owns the store, then re-read the session it rewrote and try once more.
    let refreshAttempt;
    if (shouldDelegateGrokCliRefresh(options, cliState, cliSelection)) {
        const refresh = await delegateCredentialRefresh({
            delegate: GROK_CLI_REFRESH_DELEGATE,
            reread: () => readCredentialState(),
        });
        refreshAttempt = refresh.attempt;
        if (refresh.state !== undefined) {
            cliState = refresh.state;
            cliSelection = await selectCredential(cliCandidatesFor(cliState), attempt);
            cliPasses.push({ state: cliState, selection: cliSelection });
        }
    }
    const shouldTryPi = cliSelection.outcome !== "quota" &&
        cliSelection.outcome !== "transient" &&
        cliSelection.transientError === undefined;
    const piSelection = await selectCredential(shouldTryPi ? piCandidates : [], attempt);
    const selection = mergeIndependentSelections(cliSelection, piSelection);
    const attempts = grokAttempts(cliPasses, piResolution, selection, refreshAttempt);
    const transientError = selection.transientError;
    const retryAfter = selection.retryAfter;
    const cliRefreshNeeded = selection.results.some((result) => result.source === GROK_SOURCE &&
        result.refreshable === true &&
        result.outcome === "rejected");
    if (selection.outcome === "quota" && selection.result) {
        const quota = selection.result;
        return withAuthStatus(successProvider({
            provider: "grok",
            label: "Grok",
            source: GROK_SOURCE,
            account: quota.account,
            windows: quota.windows,
            credits: quota.credits,
            refreshedAt: quota.refreshedAt,
            sourcesTried: sourceNames(attempts),
            attempts,
        }), "usable", cliRefreshNeeded);
    }
    const authStatus = selection.outcome === "live_no_quota"
        ? "usable"
        : classifyGrokAuthStatus(cliState, piResolution, selection);
    if (authStatus === "usable" || transientError !== undefined) {
        // Valid model auth (CLI and/or Pi) without consumer windows is not logout.
        const cached = readCachedProvider("grok");
        const stale = cached?.source === GROK_SOURCE && consumerTransient
            ? staleFromCache(cached, transientError ?? GROK_CONSUMER_QUOTA_UNAVAILABLE_ERROR, sourceNames(attempts), attempts)
            : undefined;
        if (stale) {
            return withAuthStatus(withUsageFetchFailure(stale), authStatus, cliRefreshNeeded);
        }
        return withAuthStatus(failedProvider({
            provider: "grok",
            label: "Grok",
            status: retryAfter
                ? "rate_limited"
                : transientError !== undefined
                    ? statusFromError(transientError)
                    : "unavailable",
            error: transientError ??
                (selection.outcome === "live_no_quota"
                    ? GROK_MODEL_AUTH_WITHOUT_QUOTA_ERROR
                    : GROK_CONSUMER_QUOTA_UNAVAILABLE_ERROR),
            retryAfter,
            sourcesTried: sourceNames(attempts),
            attempts,
        }), authStatus, cliRefreshNeeded);
    }
    let finalError;
    if (authStatus === "expired_refreshable") {
        finalError = hasRefreshableCliCandidate(cliState)
            ? GROK_ACCESS_TOKEN_EXPIRED_ERROR
            : "Pi xAI access token expired";
    }
    else if (piResolution.status === "error") {
        finalError = GROK_PI_CREDENTIAL_RESOLUTION_ERROR;
    }
    else {
        finalError = GROK_SIGN_IN_REQUIRED_ERROR;
    }
    const cached = readCachedProvider("grok");
    const stale = staleUnlessSignOut(cached?.source === GROK_SOURCE ? cached : undefined, finalError, sourceNames(attempts), attempts, {
        definitive: finalError === GROK_SIGN_IN_REQUIRED_ERROR,
        retire: () => retireCachedSlot("grok"),
    });
    if (stale)
        return withAuthStatus(stale, authStatus, cliRefreshNeeded);
    return withAuthStatus(failedProvider({
        provider: "grok",
        label: "Grok",
        status: retryAfter
            ? "rate_limited"
            : grokStatusForAuthFailure(finalError, authStatus),
        error: finalError,
        retryAfter,
        sourcesTried: sourceNames(attempts),
        attempts,
    }), authStatus, cliRefreshNeeded);
}
function cliCandidatesFor(state) {
    if (state.status !== "available" && state.status !== "expired")
        return [];
    return state.candidates.map((candidate) => ({
        source: GROK_SOURCE,
        localState: candidate.localState,
        credential: {
            kind: "cli",
            credentials: candidate.credentials,
        },
        ...(candidate.localState === "expired"
            ? { refreshable: candidate.refreshable }
            : {}),
    }));
}
/**
 * Delegate only on soft expiry of the store the Grok CLI itself owns: a stored
 * session that carries a refresh token was empirically rejected, and every
 * try-able CLI candidate was rejected too.
 *
 * A transient failure, a live session, a missing or malformed store, and a
 * stored-valid session the server revoked all stay read-only - none of them is
 * something the CLI's own rotation would fix. An inline or relocated store
 * (`GROK_AUTH`, `GROK_AUTH_JSON`, `GROK_AUTH_PATH`) is excluded too, because
 * the Grok CLI would rotate its own default file rather than that one.
 */
function shouldDelegateGrokCliRefresh(options, state, selection) {
    if (!options.refreshCredentials)
        return false;
    if (!isGrokCliOwnedStore())
        return false;
    if (state.status !== "expired" && state.status !== "available")
        return false;
    if (selection.outcome !== "all_rejected")
        return false;
    return selection.results.some((result) => result.refreshable === true && result.outcome === "rejected");
}
/** True when the store quota-axi read is the one `grok` itself rewrites. */
function isGrokCliOwnedStore() {
    return (stringValue(runtimeProcess.env.GROK_AUTH) === undefined &&
        stringValue(runtimeProcess.env.GROK_AUTH_JSON) === undefined &&
        stringValue(runtimeProcess.env.GROK_AUTH_PATH) === undefined);
}
function mergeIndependentSelections(first, second) {
    const results = [...first.results, ...second.results];
    const refreshable = first.refreshable || second.refreshable;
    if (first.outcome === "quota")
        return { ...first, results };
    if (second.outcome === "quota")
        return { ...second, results };
    const live = first.outcome === "live_no_quota"
        ? first
        : second.outcome === "live_no_quota"
            ? second
            : undefined;
    const transient = first.outcome === "transient"
        ? first
        : second.outcome === "transient"
            ? second
            : undefined;
    if (live) {
        return {
            outcome: "live_no_quota",
            winner: live.winner,
            transientError: live.transientError ?? transient?.transientError,
            retryAfter: live.retryAfter ?? transient?.retryAfter,
            refreshable,
            results,
        };
    }
    if (transient) {
        return {
            outcome: "transient",
            transientError: transient.transientError,
            retryAfter: transient.retryAfter,
            refreshable,
            results,
        };
    }
    if (results.length > 0 &&
        results.every((result) => result.outcome === "rejected")) {
        return { outcome: "all_rejected", refreshable, results };
    }
    return { outcome: "no_candidates", refreshable, results };
}
async function attemptGrokCandidate(payload) {
    if (payload.kind === "cli" || payload.kind === "pi-credits") {
        try {
            const quota = await fetchGrokConsumerQuota(payload.credentials);
            return { kind: "quota", result: quota };
        }
        catch (error) {
            const message = errorMessage(error);
            if (error instanceof RateLimitError) {
                return {
                    kind: "transient",
                    error: message,
                    retryAfter: error.retryAfter,
                    operation: "consumer_quota",
                };
            }
            if (isDefinitiveGrokAuthError(message)) {
                if (payload.credentials.modelProbeUrl) {
                    const probe = await probeGrokModelAccess(payload.credentials.modelProbeUrl, payload.credentials.key);
                    return probe.kind === "transient"
                        ? { ...probe, operation: "model_auth" }
                        : probe;
                }
                return { kind: "rejected", error: message };
            }
            return {
                kind: "transient",
                error: message,
                operation: "consumer_quota",
            };
        }
    }
    // Pi API keys authenticate xAI model calls, not grok.com consumer credits.
    return { kind: "live_no_quota" };
}
/**
 * A Grok Build or Pi OAuth bearer can be valid for model access while the
 * separate grok.com consumer-billing operation rejects its audience. Verify
 * that distinction against the bearer owner's official model catalog. The
 * response body is discarded: model availability proves auth usability but
 * does not provide numeric quota.
 */
async function probeGrokModelAccess(url, token) {
    const controller = new RuntimeAbortController();
    const timer = runtimeSetTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
        let response;
        try {
            response = await providerFetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                },
                credentials: "omit",
                redirect: "manual",
                signal: controller.signal,
            });
        }
        catch (error) {
            return {
                kind: "transient",
                error: isAbortError(error) || controller.signal.aborted
                    ? "Grok model access probe timed out"
                    : "Grok model access probe unavailable",
            };
        }
        await response.body?.cancel().catch(() => undefined);
        if (response.ok)
            return { kind: "live_no_quota" };
        if (response.status === 401 || response.status === 403) {
            return { kind: "rejected", error: GROK_SIGN_IN_REQUIRED_ERROR };
        }
        if (response.status === 429) {
            return {
                kind: "transient",
                error: "Grok model access probe rate limited",
                retryAfter: retryAfterToIso(response.headers.get("retry-after")),
            };
        }
        return { kind: "transient", error: "Grok model access probe unavailable" };
    }
    finally {
        runtimeClearTimeout(timer);
    }
}
function grokAttempts(cliPasses, piResolution, selection, refreshAttempt) {
    const attempts = [];
    appendGrokCliAttempt(attempts, cliPasses[0]);
    if (refreshAttempt)
        attempts.push(refreshAttempt);
    for (const pass of cliPasses.slice(1)) {
        appendGrokCliAttempt(attempts, pass);
    }
    const piResult = selection.results.find((result) => result.source === PI_XAI_CREDENTIAL_SOURCE);
    if (piResult?.outcome === "quota") {
        attempts.push({
            source: PI_XAI_CREDENTIAL_SOURCE,
            status: "success",
            credentialPresent: true,
        });
    }
    else if (piResult?.outcome === "rejected" ||
        piResult?.outcome === "transient") {
        attempts.push({
            source: PI_XAI_CREDENTIAL_SOURCE,
            status: "failed",
            error: piResult.error,
            credentialPresent: true,
        });
    }
    else if (piResult?.outcome === "live_no_quota") {
        attempts.push({
            source: PI_XAI_CREDENTIAL_SOURCE,
            status: "skipped",
            error: piResolution.status === "available" && piResolution.kind === "api_key"
                ? MODEL_AUTH_ONLY_ERROR
                : MODEL_AUTH_PROBE_LIVE,
            credentialPresent: true,
            // Live auth that simply carries no consumer quota is not a broken source.
            degraded: false,
        });
    }
    else {
        attempts.push(piSourceAttempt(piResolution));
    }
    return attempts;
}
function appendGrokCliAttempt(attempts, pass) {
    const cliResults = pass.selection.results.filter((result) => result.source === GROK_SOURCE);
    const quotaResult = cliResults.find((result) => result.outcome === "quota");
    if (quotaResult) {
        attempts.push({ source: GROK_SOURCE, status: "success" });
        return;
    }
    const liveResult = cliResults.find((result) => result.outcome === "live_no_quota");
    if (liveResult) {
        attempts.push({
            source: GROK_SOURCE,
            status: "skipped",
            error: MODEL_AUTH_PROBE_LIVE,
            credentialPresent: true,
            // Live auth that simply carries no consumer quota is not a broken source.
            degraded: false,
        });
        return;
    }
    const cliResult = cliResults.find((result) => result.outcome === "transient") ??
        [...cliResults].reverse().find((result) => result.outcome === "rejected");
    if (cliResult) {
        attempts.push({
            source: GROK_SOURCE,
            status: "failed",
            error: cliResult.error,
        });
        return;
    }
    attempts.push({
        source: pass.state.source.source,
        status: "skipped",
        error: `credentials_${pass.state.status}`,
        ...(pass.state.status === "missing" ? {} : { credentialPresent: true }),
    });
}
async function inspectAuthWithDependencies(dependencies) {
    const cliState = readCredentialState();
    const piInspection = await dependencies.piXaiBroker.inspect();
    const piStatus = piInspection.status === "available"
        ? "available"
        : piInspection.status === "expired"
            ? "expired"
            : piInspection.status === "missing"
                ? "missing"
                : piInspection.status === "error"
                    ? "error"
                    : piInspection.status === "unsupported" ||
                        piInspection.status === "invalid"
                        ? "invalid"
                        : "missing";
    return {
        provider: "grok",
        sources: [
            cliState.source,
            {
                source: PI_XAI_CREDENTIAL_SOURCE,
                status: piStatus,
                ...(piInspection.error ? { error: piInspection.error } : {}),
            },
        ],
    };
}
function classifyGrokAuthStatus(cliState, piResolution, selection) {
    const piResult = selection.results.find((result) => result.source === PI_XAI_CREDENTIAL_SOURCE);
    const piUsable = (piResolution.status === "available" &&
        (piResult === undefined ||
            piResult.outcome === "quota" ||
            piResult.outcome === "live_no_quota" ||
            piResult.outcome === "transient")) ||
        (piResolution.status === "expired" &&
            piResult?.outcome === "live_no_quota");
    const cliUsable = selection.results.some((result) => result.source === GROK_SOURCE &&
        (result.outcome === "live_no_quota" ||
            (result.localState === "valid" && result.outcome !== "rejected")));
    if (cliUsable || piUsable)
        return "usable";
    const piRefreshable = piResolution.status === "expired" && piResolution.refreshable;
    if (hasRefreshableCliCandidate(cliState) || piRefreshable)
        return "expired_refreshable";
    return "unusable";
}
function hasRefreshableCliCandidate(state) {
    return ((state.status === "available" || state.status === "expired") &&
        state.candidates.some((candidate) => candidate.localState === "expired" && candidate.refreshable));
}
export function grokCliRefreshNeeded(provider) {
    return provider[GROK_CLI_REFRESH_NEEDED] === true;
}
function piSourceAttempt(resolution) {
    if (resolution.status === "available") {
        return {
            source: PI_XAI_CREDENTIAL_SOURCE,
            status: "skipped",
            error: resolution.kind === "oauth"
                ? PI_QUOTA_NOT_NEEDED_ERROR
                : MODEL_AUTH_ONLY_ERROR,
            credentialPresent: true,
            degraded: false,
        };
    }
    if (resolution.status === "expired") {
        return {
            source: PI_XAI_CREDENTIAL_SOURCE,
            status: "skipped",
            error: "credentials_expired",
            credentialPresent: true,
        };
    }
    if (resolution.status === "error") {
        return {
            source: PI_XAI_CREDENTIAL_SOURCE,
            status: "failed",
            error: "credential_resolution_failed",
            credentialPresent: true,
        };
    }
    if (resolution.status === "unsupported") {
        return {
            source: PI_XAI_CREDENTIAL_SOURCE,
            status: "skipped",
            error: "unsupported_credential_type",
            credentialPresent: true,
        };
    }
    if (resolution.status === "invalid") {
        return {
            source: PI_XAI_CREDENTIAL_SOURCE,
            status: "skipped",
            error: "credentials_invalid",
            credentialPresent: true,
        };
    }
    return {
        source: PI_XAI_CREDENTIAL_SOURCE,
        status: "skipped",
        error: "credentials_missing",
    };
}
function withAuthStatus(provider, authStatus, cliRefreshNeeded) {
    return {
        ...provider,
        ...(cliRefreshNeeded ? { [GROK_CLI_REFRESH_NEEDED]: true } : {}),
        state: {
            ...provider.state,
            authStatus,
        },
    };
}
function grokStatusForAuthFailure(error, authStatus) {
    if (authStatus === "expired_refreshable")
        return "unavailable";
    return statusFromError(error);
}
function isDefinitiveGrokAuthError(error) {
    return error === GROK_SIGN_IN_REQUIRED_ERROR;
}
export function normalizeGrokConsumerPayload(payload, credentials) {
    const response = scanMessage(payload);
    const config = firstMessage(response, 1);
    if (!config)
        throw new ProtocolError();
    const currentPeriod = firstMessage(config, 8);
    const periodType = currentPeriod
        ? periodTypeAt(currentPeriod)
        : "unspecified";
    const periodStart = currentPeriod ? timestampAt(currentPeriod, 2) : undefined;
    const resetsAt = currentPeriod ? timestampAt(currentPeriod, 3) : undefined;
    const validCurrentPeriod = (periodType === "weekly" || periodType === "monthly") &&
        periodStart !== undefined &&
        resetsAt !== undefined;
    const windowKind = periodType === "weekly" || periodType === "monthly"
        ? periodType
        : "credits";
    const windowLabel = periodType === "weekly"
        ? "week"
        : periodType === "monthly"
            ? "month"
            : "credits";
    const windows = [];
    const sharedExplicit = floatAt(config, 1);
    if (sharedExplicit !== undefined || validCurrentPeriod) {
        const percentUsed = clampExactPercent(sharedExplicit ?? 0);
        windows.push({
            id: "credits",
            label: windowLabel,
            kind: windowKind,
            percentUsed,
            percentRemaining: 100 - percentUsed,
            ...(periodStart ? { startsAt: periodStart } : {}),
            resetsAt,
        });
    }
    for (const productPayload of messagesAt(config, 7)) {
        const product = scanMessage(productPayload);
        const explicit = floatAt(product, 2);
        if (explicit === undefined && !validCurrentPeriod)
            continue;
        const productNumber = safeNumber(varintAt(product, 1) ?? 0n);
        if (productNumber === undefined)
            continue;
        const productName = PRODUCT_NAMES[productNumber] ?? {
            id: `unknown_${productNumber}`,
            label: `Product ${productNumber}`,
        };
        const percentUsed = clampExactPercent(explicit ?? 0);
        windows.push({
            id: `product:${productName.id}`,
            label: productName.label,
            kind: windowKind,
            percentUsed,
            percentRemaining: 100 - percentUsed,
            ...(periodStart ? { startsAt: periodStart } : {}),
            resetsAt,
        });
    }
    if (windows.length === 0)
        throw new ProtocolError();
    const prepaid = firstMessage(config, 12);
    const prepaidBalance = prepaid
        ? safeNumber(varintAt(prepaid, 1) ?? 0n)
        : undefined;
    if (prepaid && prepaidBalance === undefined)
        throw new ProtocolError();
    return {
        account: {
            email: credentials?.email,
            organization: credentials?.teamId,
        },
        windows,
        credits: prepaidBalance === undefined
            ? undefined
            : { remaining: prepaidBalance, unit: "credits" },
        refreshedAt: nowIso(),
    };
}
async function fetchGrokConsumerQuota(credentials) {
    const controller = new RuntimeAbortController();
    const timer = runtimeSetTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
        let response;
        try {
            response = await providerFetch(CONSUMER_QUOTA_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${credentials.key}`,
                    Accept: "*/*",
                    "Content-Type": "application/grpc-web+proto",
                    Origin: "https://grok.com",
                    Referer: "https://grok.com/?_s=usage",
                    "x-grpc-web": "1",
                    "x-user-agent": "connect-es/2.1.1",
                },
                body: EMPTY_GRPC_REQUEST,
                signal: controller.signal,
            });
        }
        catch (error) {
            if (isAbortError(error) || controller.signal.aborted)
                throw new TimeoutError();
            throw new SafeGrokError("Grok quota unavailable");
        }
        rejectUnusableUsageResponse(response);
        throwForGrpcStatus(response.headers.get("grpc-status"), response.headers.get("grpc-message"));
        let bytes;
        try {
            bytes = await readBoundedBody(response);
        }
        catch (error) {
            if (error instanceof SafeGrokError)
                throw error;
            if (isAbortError(error) || controller.signal.aborted)
                throw new TimeoutError();
            throw new SafeGrokError("Grok quota unavailable");
        }
        const payload = decodeGrpcWebPayload(bytes);
        return normalizeGrokConsumerPayload(payload, credentials);
    }
    finally {
        runtimeClearTimeout(timer);
    }
}
async function readBoundedBody(response) {
    const contentLength = response.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength)) {
        if (BigInt(contentLength) > BigInt(RESPONSE_LIMIT_BYTES))
            throw new ResponseTooLargeError();
    }
    if (!response.body)
        return new Uint8Array();
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            length += value.length;
            if (length > RESPONSE_LIMIT_BYTES) {
                await reader.cancel().catch(() => undefined);
                throw new ResponseTooLargeError();
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}
function decodeGrpcWebPayload(bytes) {
    if (bytes.length === 0)
        throw new ProtocolError();
    if (!looksFramed(bytes[0]))
        return bytes;
    const dataFrames = [];
    let trailerSeen = false;
    let index = 0;
    while (index < bytes.length) {
        if (index + 5 > bytes.length)
            throw new ProtocolError();
        const flags = bytes[index];
        if ((flags & 0x01) !== 0)
            throw new ProtocolError();
        if (flags !== 0 && flags !== 0x80)
            throw new ProtocolError();
        const length = new DataView(bytes.buffer, bytes.byteOffset + index + 1, 4).getUint32(0);
        if (length > RESPONSE_LIMIT_BYTES)
            throw new ProtocolError();
        const start = index + 5;
        const end = start + length;
        if (!Number.isSafeInteger(end) || end > bytes.length)
            throw new ProtocolError();
        const frame = bytes.slice(start, end);
        if (flags === 0x80) {
            if (trailerSeen)
                throw new ProtocolError();
            trailerSeen = true;
            const trailers = parseTrailerFields(frame);
            throwForGrpcStatus(trailers.get("grpc-status") ?? null, trailers.get("grpc-message") ?? null);
        }
        else {
            if (trailerSeen || dataFrames.length > 0)
                throw new ProtocolError();
            dataFrames.push(frame);
        }
        index = end;
    }
    if (dataFrames.length !== 1)
        throw new ProtocolError();
    return dataFrames[0];
}
function looksFramed(firstByte) {
    return firstByte === 0 || firstByte === 1 || (firstByte & 0x80) !== 0;
}
function parseTrailerFields(bytes) {
    const trailers = new Map();
    const text = new RuntimeTextDecoder().decode(bytes);
    for (const line of text.split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator <= 0)
            continue;
        trailers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
    return trailers;
}
function throwForGrpcStatus(value, message = null) {
    if (value === null)
        return;
    if (!/^(?:[0-9]|1[0-6])$/.test(value))
        throw new ProtocolError();
    const status = Number(value);
    if (status === 0)
        return;
    if (status === 16)
        throw new SafeGrokError(GROK_SIGN_IN_REQUIRED_ERROR);
    if (status === 7 && grpcMessageIndicatesAuthFailure(message))
        throw new SafeGrokError(GROK_SIGN_IN_REQUIRED_ERROR);
    if (status === 8)
        throw new RateLimitError();
    throw new SafeGrokError("Grok quota unavailable");
}
function grpcMessageIndicatesAuthFailure(value) {
    if (!value || value.length > GRPC_MESSAGE_LIMIT_CHARS)
        return false;
    let message;
    try {
        message = decodeURIComponent(value);
    }
    catch {
        return false;
    }
    if (message.length > GRPC_MESSAGE_LIMIT_CHARS)
        return false;
    return (/\b(?:unauthenticated|authentication required|sign[ -]?in required)\b/i.test(message) ||
        /\bbad[ -]credentials\b/i.test(message) ||
        /\b(?:oauth2|access token)\b[\s\S]{0,128}\bcould not be validated\b/i.test(message) ||
        /\b(?:invalid|expired|missing|revoked)\s+(?:(?:oauth|access|auth(?:entication)?|bearer)\s+)*(?:token|credentials?|jwt)\b/i.test(message) ||
        /\b(?:token|credentials?|jwt)\s+(?:is |are )?(?:invalid|expired|missing|revoked)\b/i.test(message));
}
function scanMessage(bytes) {
    const fields = [];
    let index = 0;
    while (index < bytes.length) {
        const key = readVarint(bytes, index);
        index = key.index;
        const fieldValue = key.value >> 3n;
        if (fieldValue <= 0n || fieldValue > 0x1fffffffn)
            throw new ProtocolError();
        const field = Number(fieldValue);
        const wire = Number(key.value & 7n);
        if (wire === 0) {
            const scalar = readVarint(bytes, index);
            fields.push({ field, wire, value: scalar.value });
            index = scalar.index;
            continue;
        }
        if (wire === 1 || wire === 5) {
            const length = wire === 1 ? 8 : 4;
            if (index + length > bytes.length)
                throw new ProtocolError();
            fields.push({
                field,
                wire,
                value: bytes.slice(index, index + length),
            });
            index += length;
            continue;
        }
        if (wire === 2) {
            const lengthValue = readVarint(bytes, index);
            index = lengthValue.index;
            if (lengthValue.value > BigInt(RESPONSE_LIMIT_BYTES))
                throw new ProtocolError();
            const length = Number(lengthValue.value);
            const end = index + length;
            if (!Number.isSafeInteger(end) || end > bytes.length)
                throw new ProtocolError();
            fields.push({ field, wire, value: bytes.slice(index, end) });
            index = end;
            continue;
        }
        throw new ProtocolError();
    }
    return fields;
}
function readVarint(bytes, start) {
    let value = 0n;
    let index = start;
    for (let count = 0; count < 10 && index < bytes.length; count += 1) {
        const byte = bytes[index];
        index += 1;
        if (count === 9 && byte > 1)
            throw new ProtocolError();
        value |= BigInt(byte & 0x7f) << BigInt(count * 7);
        if ((byte & 0x80) === 0)
            return { value, index };
    }
    throw new ProtocolError();
}
function messagesAt(fields, field) {
    return fields
        .filter((entry) => entry.field === field && entry.wire === 2)
        .map((entry) => entry.value);
}
function firstMessage(fields, field) {
    const bytes = messagesAt(fields, field)[0];
    return bytes ? scanMessage(bytes) : undefined;
}
function varintAt(fields, field) {
    return fields.find((entry) => entry.field === field && entry.wire === 0)?.value;
}
function floatAt(fields, field) {
    const found = fields.find((entry) => entry.field === field && entry.wire === 5);
    if (!found)
        return undefined;
    const value = new DataView(found.value.buffer, found.value.byteOffset, 4).getFloat32(0, true);
    if (!Number.isFinite(value))
        throw new ProtocolError();
    return value;
}
function timestampAt(fields, field) {
    const timestamp = firstMessage(fields, field);
    if (!timestamp)
        return undefined;
    const seconds = safeNumber(varintAt(timestamp, 1));
    if (seconds === undefined)
        return undefined;
    const milliseconds = seconds * 1_000;
    if (!Number.isSafeInteger(milliseconds))
        return undefined;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function periodTypeAt(period) {
    const value = varintAt(period, 1);
    if (value === 2n)
        return "weekly";
    if (value === 1n)
        return "monthly";
    return "unspecified";
}
function safeNumber(value) {
    if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER))
        return undefined;
    return Number(value);
}
function clampExactPercent(value) {
    return Math.min(100, Math.max(0, value));
}
function readCredentialState() {
    const explicitAuthFile = stringValue(runtimeProcess.env.GROK_AUTH_JSON);
    if (explicitAuthFile) {
        return extractCredentialState(readJsonFileResult(explicitAuthFile), explicitAuthFile);
    }
    const inlineAuth = stringValue(runtimeProcess.env.GROK_AUTH);
    if (inlineAuth) {
        return extractCredentialState(readInlineAuth(inlineAuth), undefined, "auth-env");
    }
    const authFile = grokAuthFile();
    return extractCredentialState(readJsonFileResult(authFile), authFile);
}
function readInlineAuth(value) {
    const text = value.trim();
    try {
        return { status: "success", value: normalizeInlineAuth(JSON.parse(text)) };
    }
    catch {
        return { status: "success", value: inlineTokenAuth(text) };
    }
}
function normalizeInlineAuth(value) {
    return typeof value === "string" ? inlineTokenAuth(value) : value;
}
function inlineTokenAuth(key) {
    return { "https://accounts.x.ai/sign-in": { key } };
}
function extractCredentialState(raw, path, source = "auth-json") {
    if (raw.status === "missing")
        return {
            status: "missing",
            source: authSource(source, path, "missing"),
        };
    if (raw.status === "invalid")
        return {
            status: "invalid",
            source: authSource(source, path, "invalid", raw.error),
        };
    const data = objectValue(raw.value);
    if (!data)
        return {
            status: "invalid",
            source: authSource(source, path, "invalid"),
        };
    const candidates = selectedCredentialCandidates(data).map((candidate) => ({
        credentials: {
            key: candidate.key,
            email: candidate.email,
            teamId: candidate.teamId,
            expiresAt: candidate.expiresAt,
            modelProbeUrl: isOfficialGrokBuildOidc(candidate)
                ? GROK_BUILD_MODELS_URL
                : undefined,
        },
        localState: isExpired(candidate.expiresAt)
            ? "expired"
            : "valid",
        refreshable: candidate.hasRefreshToken,
    }));
    if (candidates.length > 0) {
        const status = candidates.some((candidate) => candidate.localState === "valid")
            ? "available"
            : "expired";
        return {
            status,
            candidates,
            source: authSource(source, path, status),
        };
    }
    return {
        status: "invalid",
        source: authSource(source, path, "invalid"),
    };
}
function grokAuthFile() {
    return (stringValue(runtimeProcess.env.GROK_AUTH_JSON) ??
        stringValue(runtimeProcess.env.GROK_AUTH_PATH) ??
        join(grokHomeDir(), "auth.json"));
}
function grokHomeDir() {
    return runtimeProcess.env.GROK_HOME || join(homedir(), ".grok");
}
function rejectUnusableUsageResponse(response) {
    if (response.status === 401 || response.status === 403) {
        throw new SafeGrokError(GROK_SIGN_IN_REQUIRED_ERROR);
    }
    if (response.status === 429) {
        throw new RateLimitError(retryAfterToIso(response.headers.get("retry-after")));
    }
    if (!response.ok)
        throw new SafeGrokError("Grok quota unavailable");
}
function isExpired(value) {
    if (!value)
        return false;
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && parsed <= Date.now();
}
function authSource(source, path, status, error) {
    return {
        source,
        path,
        status,
        error,
    };
}
function selectedCredentialCandidates(data) {
    const candidates = credentialCandidates(data);
    const sessionCandidates = candidates.filter(isGrokSessionCandidate);
    if (sessionCandidates.length > 0)
        return sessionCandidates;
    return candidates.filter((candidate) => !isGrokApiKeyCandidate(candidate));
}
function credentialCandidates(data) {
    const direct = credentialCandidate(data, stringValue(data.scope));
    if (direct)
        return [direct];
    return Object.entries(data).flatMap(([scope, value]) => {
        const item = objectValue(value);
        const candidate = item ? credentialCandidate(item, scope) : undefined;
        return candidate ? [candidate] : [];
    });
}
function credentialCandidate(item, scope) {
    const key = stringValue(item.key);
    if (!key)
        return undefined;
    return {
        key,
        scope: credentialScope(scope, item),
        raw: item,
        email: stringValue(item.email),
        teamId: stringValue(item.team_id) ?? stringValue(item.teamId),
        expiresAt: stringValue(item.expires_at) ?? stringValue(item.expiresAt),
        // Presence only - never inspect or retain the refresh token value.
        hasRefreshToken: hasAnyField(item, "refresh_token", "refreshToken"),
    };
}
function hasAnyField(item, ...keys) {
    return keys.some((key) => Object.hasOwn(item, key));
}
function credentialScope(scope, item) {
    return (stringValue(item.scope) ??
        stringValue(item.url) ??
        stringValue(item.audience) ??
        scope);
}
function isGrokSessionCandidate(candidate) {
    if (isGrokApiKeyCandidate(candidate))
        return false;
    const scope = parseScope(candidate.scope);
    if (!scope)
        return false;
    if (isOfficialGrokBuildOidc(candidate))
        return true;
    if (scope.host === "accounts.x.ai" && scope.path.startsWith("/sign-in"))
        return true;
    return scope.host === "grok.com" || scope.host === "www.grok.com";
}
function isOfficialGrokBuildOidc(candidate) {
    return (parseScope(candidate.scope)?.host === "auth.x.ai" &&
        isOidcCredential(candidate.raw));
}
function isOidcCredential(item) {
    const authMode = stringValue(item.auth_mode)?.toLowerCase() ??
        stringValue(item.authMode)?.toLowerCase();
    return authMode === "oidc";
}
function isGrokApiKeyCandidate(candidate) {
    const scope = parseScope(candidate.scope);
    const loweredScope = candidate.scope?.toLowerCase() ?? "";
    const type = stringValue(candidate.raw.type)?.toLowerCase() ??
        stringValue(candidate.raw.kind)?.toLowerCase();
    return (type === "api-key" ||
        type === "api_key" ||
        loweredScope.includes("api-key") ||
        loweredScope.includes("api_key") ||
        scope?.host === "api.x.ai" ||
        scope?.host === "api.grok.com");
}
function parseScope(value) {
    if (!value)
        return undefined;
    const scope = normalizeCredentialScope(value);
    try {
        const url = new URL(scope.includes("://") ? scope : `https://${scope}`);
        return { host: url.hostname.toLowerCase(), path: url.pathname };
    }
    catch {
        return undefined;
    }
}
function normalizeCredentialScope(value) {
    return value.replace(/::[^/]*$/, "");
}
function objectValue(value) {
    return value && typeof value === "object"
        ? value
        : undefined;
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function isAbortError(error) {
    return error instanceof Error && error.name === "AbortError";
}
function errorMessage(error) {
    return error instanceof SafeGrokError
        ? error.message
        : "Grok quota unavailable";
}
class SafeGrokError extends Error {
}
class ProtocolError extends SafeGrokError {
    constructor() {
        super("Grok quota response invalid");
    }
}
class ResponseTooLargeError extends SafeGrokError {
    constructor() {
        super("Grok quota response too large");
    }
}
class TimeoutError extends SafeGrokError {
    constructor() {
        super("Grok quota request timed out");
    }
}
class RateLimitError extends SafeGrokError {
    retryAfter;
    constructor(retryAfter) {
        super("Grok quota endpoint rate limited");
        this.retryAfter = retryAfter;
    }
}
