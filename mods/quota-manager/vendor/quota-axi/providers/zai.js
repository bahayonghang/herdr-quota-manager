// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { homedir, join, runtimeProcess, RuntimeAbortController, RuntimeTextDecoder, runtimeSetTimeout, runtimeClearTimeout } from "../runtime.js";
// Endpoint behavior and auth discovery derived from opencode-glm-quota
// (c) guyinwonder168, MIT, https://github.com/guyinwonder168/opencode-glm-quota
// and the vendor plugin zai-org/zai-coding-plugins. No third-party code is
// vendored here; the HTTP layer and normalization are an original implementation.


import { deleteCachedProvider as deleteCachedProviderFromDisk, readCachedZaiProvider as readCachedProviderFromDisk, } from "../cache.js";
import { readJsonFileResult } from "../lib/fs.js";
import { providerFetch } from "../lib/http.js";
import { resolvePiAuthFilePath } from "../lib/pi-agent-dir.js";
import { classifyPiAuthEntry } from "../lib/pi-auth-store.js";
import { usableLiteralSecret } from "../lib/secret.js";
import { VERSION } from "../version.js";
import { servableStaleWindows, servableUntrustedWindowIds } from "./common.js";
import { stampZaiReadingContext, zaiCacheContextId, } from "./zai-cache-context.js";
const ZAI_QUOTA_PATH = "/api/monitor/usage/quota/limit";
const OPERATION_DEADLINE_MS = 15_000;
const RESPONSE_LIMIT_BYTES = 262_144;
const FIVE_HOURS_SECONDS = 18_000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const ZAI_HOST = "api.z.ai";
const ZHIPU_HOST = "open.bigmodel.cn";
const OPENCODE_AUTH_SOURCE = "opencode:auth.json";
const PI_ZAI_SOURCE = "pi:zai";
const PI_ZAI_PROVIDER_ID = "zai";
const USER_AGENT = `quota-axi/${VERSION}`;
const zaiProviderFetch = (input, init) => providerFetch(input, init, { retryOverIpv4: true });
const ZAI_PROVIDER_IDS = ["zai-coding-plan", "zai", "z-ai", "z.ai"];
const ZHIPU_PROVIDER_IDS = ["zhipu", "zhipuai"];
const CREDENTIAL_KEYS = [
    "key",
    "apiKey",
    "api_key",
    "token",
    "accessToken",
    "auth_token",
];
export function opencodeAuthFilePath() {
    const xdg = stringValue(runtimeProcess.env.XDG_DATA_HOME);
    if (xdg)
        return join(xdg, "opencode", "auth.json");
    if (runtimeProcess.platform === "win32") {
        const localAppData = stringValue(runtimeProcess.env.LOCALAPPDATA);
        if (localAppData)
            return join(localAppData, "opencode", "auth.json");
    }
    return join(homedir(), ".local", "share", "opencode", "auth.json");
}
export function extractZaiCredential(value, path) {
    const data = objectValue(value);
    if (!data)
        return { status: "invalid", path, error: "json_parse_error" };
    for (const providerId of [...ZAI_PROVIDER_IDS, ...ZHIPU_PROVIDER_IDS]) {
        const entry = data[providerId];
        if (entry === undefined || entry === null)
            continue;
        const host = ZAI_PROVIDER_IDS.includes(providerId) ? ZAI_HOST : ZHIPU_HOST;
        const key = extractKey(entry);
        if (key)
            return { status: "available", apiKey: key, host, path };
    }
    return { status: "missing", path };
}
function extractPiZaiCredential(value, path) {
    const classified = classifyPiAuthEntry(value, PI_ZAI_PROVIDER_ID);
    if (classified.status === "missing")
        return { status: "missing", path };
    const key = classified.status === "present" && classified.entry.type === "api_key"
        ? usableLiteralSecret(classified.entry.key)
        : undefined;
    return key
        ? { status: "available", apiKey: key, host: ZAI_HOST, path }
        : { status: "invalid", path, error: "invalid_credential" };
}
export function createOpencodeAuthCredentialSource(filePath = opencodeAuthFilePath) {
    return createJsonAuthCredentialSource(filePath, extractZaiCredential);
}
export function createPiAuthCredentialSource(filePath = resolvePiAuthFilePath) {
    return createJsonAuthCredentialSource(filePath, extractPiZaiCredential);
}
function createJsonAuthCredentialSource(filePath, extract) {
    function resolve() {
        const path = filePath();
        const result = readJsonFileResult(path);
        if (result.status === "missing")
            return { status: "missing", path };
        if (result.status === "invalid")
            return result.error === "file_read_error"
                ? { status: "error", path, error: result.error }
                : { status: "invalid", path, error: result.error };
        return extract(result.value, path);
    }
    return {
        resolve,
        inspect() {
            const resolution = resolve();
            if (resolution.status === "available")
                return { status: "available", path: resolution.path };
            return resolution;
        },
    };
}
export function defaultZaiCredentialSources() {
    return [
        { name: PI_ZAI_SOURCE, source: createPiAuthCredentialSource() },
        {
            name: OPENCODE_AUTH_SOURCE,
            source: createOpencodeAuthCredentialSource(),
        },
    ];
}
export function createZaiAdapter(overrides = {}) {
    const dependencies = {
        credentialSources: defaultZaiCredentialSources(),
        fetch: zaiProviderFetch,
        readCachedProvider: readCachedProviderFromDisk,
        deleteCachedProvider: deleteCachedProviderFromDisk,
        now: Date.now,
        deadlineMs: OPERATION_DEADLINE_MS,
        ...overrides,
    };
    let inFlight;
    return {
        id: "zai",
        label: "Z.AI",
        fetchQuota(_options) {
            if (inFlight)
                return inFlight;
            const acquisition = acquireZaiQuota(dependencies).finally(() => {
                if (inFlight === acquisition)
                    inFlight = undefined;
            });
            inFlight = acquisition;
            return acquisition;
        },
        async inspectAuth(_options) {
            const sources = dependencies.credentialSources.map(({ name, source }) => {
                const inspection = source.inspect();
                return {
                    source: name,
                    path: inspection.path,
                    status: inspection.status,
                    ...(inspection.status === "invalid" || inspection.status === "error"
                        ? { error: inspection.error }
                        : {}),
                };
            });
            return { provider: "zai", sources };
        },
    };
}
export const zaiAdapter = createZaiAdapter();
async function acquireZaiQuota(dependencies) {
    const controller = new RuntimeAbortController();
    const deadline = runtimeSetTimeout(() => controller.abort(), dependencies.deadlineMs);
    const attempts = [];
    let lastFailure;
    try {
        for (const { name, source } of dependencies.credentialSources) {
            const resolution = source.resolve();
            if (resolution.status !== "available") {
                const failure = credentialFailureFor(resolution);
                attempts.push({
                    source: name,
                    status: resolution.status === "missing" ? "skipped" : "failed",
                    error: failure.code,
                });
                lastFailure = preferCredentialFailure(lastFailure, failure);
                continue;
            }
            const cacheContextId = zaiCacheContextId(resolution.apiKey);
            attempts.push({ source: name, status: "failed" });
            try {
                const payload = await requestZaiQuota(resolution.apiKey, resolution.host, controller.signal, dependencies.fetch, dependencies.now);
                const normalized = normalizeZaiPayload(payload);
                const untrustedWindowIds = normalized.diagnostics.map((diagnostic) => `limit:${diagnostic.index}`);
                const refreshedAt = new Date(dependencies.now()).toISOString();
                attempts[attempts.length - 1] = {
                    source: name,
                    status: "success",
                };
                return stampZaiReadingContext({
                    provider: "zai",
                    label: "Z.AI",
                    source: "api",
                    ...(normalized.plan ? { plan: normalized.plan } : {}),
                    windows: normalized.windows,
                    state: {
                        status: "fresh",
                        stale: false,
                        refreshedAt,
                        ...(untrustedWindowIds.length > 0 ? { untrustedWindowIds } : {}),
                        sourcesTried: attempts.map(({ source: tried }) => tried),
                    },
                    attempts,
                }, cacheContextId);
            }
            catch (error) {
                const failure = error instanceof ZaiFailure
                    ? error
                    : new ZaiFailure("credential_resolution_failed", {
                        staleEligible: true,
                    });
                failure.cacheContextId = cacheContextId;
                attempts[attempts.length - 1] = {
                    source: name,
                    status: "failed",
                    error: failure.code,
                };
                lastFailure = preferCredentialFailure(lastFailure, failure);
                if (failure.definitiveAuth) {
                    continue;
                }
                return failureReport(failure, attempts, dependencies);
            }
        }
        if (attempts.length === 0) {
            attempts.push({
                source: PI_ZAI_SOURCE,
                status: "failed",
                error: "zai_credential_unavailable",
            });
        }
        const failure = lastFailure ??
            new ZaiFailure("zai_credential_unavailable", {
                status: "auth_required",
                definitiveAuth: true,
            });
        return failureReport(failure, attempts, dependencies);
    }
    catch (error) {
        const failure = error instanceof ZaiFailure
            ? error
            : new ZaiFailure("credential_resolution_failed", {
                staleEligible: true,
            });
        if (attempts.length === 0) {
            attempts.push({
                source: PI_ZAI_SOURCE,
                status: "failed",
                error: failure.code,
            });
        }
        return failureReport(failure, attempts, dependencies);
    }
    finally {
        runtimeClearTimeout(deadline);
    }
}
function credentialFailureFor(resolution) {
    if (resolution.status === "missing") {
        return new ZaiFailure("zai_credential_unavailable", {
            status: "auth_required",
            definitiveAuth: true,
        });
    }
    if (resolution.status === "error") {
        return new ZaiFailure("credential_resolution_failed", {
            staleEligible: true,
        });
    }
    return new ZaiFailure("zai_credential_invalid", {
        status: "auth_required",
        definitiveAuth: true,
    });
}
function preferCredentialFailure(current, next) {
    if (!current || current.code === "zai_credential_unavailable")
        return next;
    if (current.definitiveAuth && !next.definitiveAuth)
        return next;
    return current;
}
function failureReport(failure, attempts, dependencies) {
    const cacheContextId = failure.cacheContextId;
    if (failure.definitiveAuth) {
        try {
            dependencies.deleteCachedProvider("zai");
        }
        catch {
            // The current auth failure is still definitive even if the cache is not writable.
        }
    }
    if (failure.staleEligible && cacheContextId) {
        try {
            const cached = dependencies.readCachedProvider(cacheContextId);
            const stale = cached
                ? staleZaiReport(cached, failure.code, failure.retryAfter, attempts, dependencies.now())
                : undefined;
            if (stale)
                return stale;
        }
        catch {
            // Cache I/O cannot replace the bounded current provider failure.
        }
    }
    return {
        provider: "zai",
        label: "Z.AI",
        source: "unavailable",
        windows: [],
        state: {
            status: failure.status,
            stale: false,
            error: failure.code,
            ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}),
            sourcesTried: attempts.map(({ source }) => source),
        },
        attempts,
    };
}
function staleZaiReport(cached, error, retryAfter, attempts, now) {
    if (cached.provider !== "zai" ||
        cached.source !== "api" ||
        cached.state.status !== "fresh" ||
        !cached.state.refreshedAt) {
        return undefined;
    }
    if (!Number.isFinite(Date.parse(cached.state.refreshedAt)))
        return undefined;
    const windows = servableStaleWindows(cached, now);
    if (windows.length === 0)
        return undefined;
    const untrustedWindowIds = servableUntrustedWindowIds(cached, windows);
    return {
        provider: "zai",
        label: "Z.AI",
        source: "cache",
        ...(cached.plan ? { plan: cached.plan } : {}),
        windows,
        state: {
            status: "stale",
            stale: true,
            refreshedAt: cached.state.refreshedAt,
            error,
            ...(retryAfter ? { retryAfter } : {}),
            ...(untrustedWindowIds ? { untrustedWindowIds } : {}),
            sourcesTried: [...attempts.map(({ source }) => source), "cache"],
        },
        attempts,
    };
}
async function requestZaiQuota(apiKey, host, signal, fetchImplementation, now) {
    let response;
    try {
        response = await waitForDeadline(fetchImplementation(`https://${host}${ZAI_QUOTA_PATH}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
                "Accept-Language": "en-US,en",
                "User-Agent": USER_AGENT,
            },
            credentials: "omit",
            redirect: "manual",
            signal,
        }), signal);
    }
    catch (error) {
        if (signal.aborted || isAbortError(error)) {
            throw new ZaiFailure("request_timeout", { staleEligible: true });
        }
        throw new ZaiFailure(localTransportCode(error), { staleEligible: true });
    }
    const lifetime = createResponseBodyLifetime(response);
    try {
        const receivedAt = now();
        rejectHttpFailure(response, receivedAt);
        let bytes;
        try {
            bytes = await readBoundedBody(response, signal, lifetime);
            lifetime.markConsumed();
        }
        catch (error) {
            if (error instanceof ZaiFailure)
                throw error;
            if (signal.aborted || isAbortError(error)) {
                throw new ZaiFailure("request_timeout", { staleEligible: true });
            }
            throw new ZaiFailure("network_unavailable", { staleEligible: true });
        }
        let text;
        try {
            text = new RuntimeTextDecoder("utf-8", { fatal: true }).decode(bytes);
        }
        catch {
            throw new ZaiFailure("response_invalid_utf8");
        }
        try {
            return JSON.parse(text);
        }
        catch {
            throw new ZaiFailure("malformed_json");
        }
    }
    finally {
        await lifetime.cancel();
    }
}
function rejectHttpFailure(response, receivedAt) {
    const status = response.status;
    if (status === 200)
        return;
    if (status >= 300 && status <= 399) {
        throw new ZaiFailure("redirect_rejected");
    }
    if (status === 401 || status === 403) {
        throw new ZaiFailure("provider_auth_rejected", {
            status: "auth_required",
            definitiveAuth: true,
        });
    }
    if (status === 408) {
        throw new ZaiFailure("provider_timeout", { staleEligible: true });
    }
    if (status === 429) {
        throw new ZaiFailure("provider_rate_limited", {
            status: "rate_limited",
            staleEligible: true,
            retryAfter: normalizeRetryAfter(response.headers.get("retry-after"), receivedAt),
        });
    }
    if (status >= 500 && status <= 599) {
        throw new ZaiFailure("provider_unavailable", { staleEligible: true });
    }
    throw new ZaiFailure("provider_request_rejected");
}
async function readBoundedBody(response, signal, lifetime) {
    const declaredLength = response.headers.get("content-length")?.trim();
    if (declaredLength && /^\d+$/.test(declaredLength)) {
        if (BigInt(declaredLength) > BigInt(RESPONSE_LIMIT_BYTES)) {
            throw new ZaiFailure("response_too_large", { staleEligible: true });
        }
    }
    if (!response.body)
        return new Uint8Array();
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await readBodyChunk(reader, signal, lifetime);
            if (done)
                break;
            length += value.length;
            if (length > RESPONSE_LIMIT_BYTES) {
                throw new ZaiFailure("response_too_large", { staleEligible: true });
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
async function readBodyChunk(reader, signal, lifetime) {
    const cancelReader = () => lifetime.cancel(() => reader.cancel());
    if (signal.aborted) {
        await cancelReader();
        throw new ZaiFailure("request_timeout", { staleEligible: true });
    }
    return new Promise((resolve, reject) => {
        let aborted = false;
        const abort = () => {
            aborted = true;
            cancelReader().then(() => {
                reject(new ZaiFailure("request_timeout", { staleEligible: true }));
            });
        };
        signal.addEventListener("abort", abort, { once: true });
        reader.read().then((result) => {
            if (aborted)
                return;
            signal.removeEventListener("abort", abort);
            resolve(result);
        }, (error) => {
            if (aborted)
                return;
            signal.removeEventListener("abort", abort);
            reject(error);
        });
    });
}
function createResponseBodyLifetime(response) {
    let consumed = false;
    let cancellation;
    return {
        markConsumed() {
            if (!cancellation)
                consumed = true;
        },
        async cancel(action = () => response.body?.cancel()) {
            if (consumed)
                return;
            cancellation ??= Promise.resolve()
                .then(action)
                .then(() => undefined)
                .catch(() => undefined);
            await cancellation;
        },
    };
}
export function normalizeZaiPayload(payload) {
    const root = objectValue(payload);
    if (isVendorAuthRejection(root)) {
        throw new ZaiFailure("provider_auth_rejected", {
            status: "auth_required",
            definitiveAuth: true,
        });
    }
    const data = objectValue(root?.data) ?? root;
    const limitsValue = data?.limits;
    if (!Array.isArray(limitsValue)) {
        throw new ZaiFailure("schema_invalid");
    }
    const windows = [];
    const diagnostics = [];
    const seenIds = new Set();
    for (const [offset, rawEntry] of limitsValue.entries()) {
        const index = offset + 1;
        const entry = objectValue(rawEntry);
        if (!entry) {
            diagnostics.push({ code: "entry_invalid", index });
            continue;
        }
        const mapped = mapLimitEntry(entry, index);
        const duplicate = seenIds.has(mapped.window.id);
        if (!mapped.recognized || duplicate) {
            diagnostics.push({ code: "entry_unrecognized", index });
        }
        const window = duplicate
            ? unknownWindow(mapped.measurements, index)
            : mapped.window;
        seenIds.add(window.id);
        windows.push(window);
    }
    if (windows.length === 0) {
        throw new ZaiFailure("schema_invalid");
    }
    const plan = stringValue(data?.level);
    return {
        windows,
        ...(plan ? { plan } : {}),
        diagnostics,
    };
}
function unknownWindow(measurements, index) {
    return {
        id: `limit:${index}`,
        label: `limit ${index}`,
        kind: "unknown",
        ...measurements,
    };
}
function mapLimitEntry(entry, index) {
    const type = typeof entry.type === "string" ? entry.type : undefined;
    const unit = numericScalar(entry.unit);
    const number = numericScalar(entry.number);
    const percentUsed = resolvePercentUsed(entry);
    const percentRemaining = percentUsed !== undefined ? clampPercent(100 - percentUsed) : undefined;
    const resetsAt = resolveResetsAt(entry.nextResetTime);
    const identity = identifyWindow(type, unit, number);
    const measurements = {
        ...(percentUsed !== undefined ? { percentUsed } : {}),
        ...(percentRemaining !== undefined ? { percentRemaining } : {}),
        ...(resetsAt ? { resetsAt } : {}),
    };
    if (identity) {
        return {
            recognized: true,
            measurements,
            window: {
                id: identity.id,
                label: identity.label,
                kind: identity.kind,
                ...measurements,
                ...(identity.windowSeconds !== undefined
                    ? { windowSeconds: identity.windowSeconds }
                    : {}),
            },
        };
    }
    return {
        recognized: false,
        measurements,
        window: unknownWindow(measurements, index),
    };
}
function identifyWindow(type, unit, number) {
    if ((type === "TOKENS_LIMIT" || type === "CREDIT_LIMIT") &&
        unit === 3 &&
        number === 5) {
        return {
            id: "five_hour",
            label: "session",
            kind: "session",
            windowSeconds: FIVE_HOURS_SECONDS,
        };
    }
    if ((type === "TOKENS_LIMIT" || type === "CREDIT_LIMIT") &&
        unit === 6 &&
        number === 1) {
        return {
            id: "weekly",
            label: "week",
            kind: "weekly",
            windowSeconds: WEEK_SECONDS,
        };
    }
    if (type === "TIME_LIMIT") {
        return { id: "mcp_month", label: "MCP month", kind: "monthly" };
    }
    return undefined;
}
function resolvePercentUsed(entry) {
    const percentage = numericScalar(entry.percentage);
    if (percentage !== undefined)
        return clampPercent(percentage);
    const currentValue = numericScalar(entry.currentValue);
    const usage = numericScalar(entry.usage);
    if (usage !== undefined && usage > 0 && currentValue !== undefined) {
        return clampPercent((currentValue / usage) * 100);
    }
    return undefined;
}
function resolveResetsAt(value) {
    const epochMs = numericScalar(value);
    if (epochMs === undefined || !Number.isFinite(epochMs))
        return undefined;
    try {
        return new Date(epochMs).toISOString();
    }
    catch {
        return undefined;
    }
}
function numericScalar(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
        return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function clampPercent(value) {
    return Math.min(100, Math.max(0, value));
}
export function normalizeRetryAfter(value, receivedAt) {
    const raw = value?.trim();
    if (!raw)
        return undefined;
    if (/^\d+$/.test(raw)) {
        const seconds = Number(raw);
        const instant = receivedAt + seconds * 1_000;
        if (!Number.isFinite(seconds) || !Number.isFinite(instant))
            return undefined;
        try {
            return new Date(instant).toISOString();
        }
        catch {
            return undefined;
        }
    }
    if (!/^[A-Za-z]/.test(raw))
        return undefined;
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed))
        return undefined;
    try {
        return new Date(parsed).toISOString();
    }
    catch {
        return undefined;
    }
}
function extractKey(entry) {
    if (typeof entry === "string")
        return usableLiteralSecret(entry);
    const obj = objectValue(entry);
    if (!obj)
        return undefined;
    for (const key of CREDENTIAL_KEYS) {
        const value = usableLiteralSecret(obj[key]);
        if (value !== undefined)
            return value;
    }
    return undefined;
}
function localTransportCode(error) {
    const cause = objectValue(objectValue(error)?.cause);
    const code = typeof cause?.code === "string" ? cause.code : undefined;
    return code && /(?:TLS|SSL|CERT|UNABLE_TO_VERIFY)/i.test(code)
        ? "tls_failed"
        : "network_unavailable";
}
const VENDOR_AUTH_FAILED_CODE = 1000;
function isVendorAuthRejection(root) {
    return root?.success === false && root.code === VENDOR_AUTH_FAILED_CODE;
}
function objectValue(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function isAbortError(error) {
    return error instanceof Error && error.name === "AbortError";
}
function waitForDeadline(promise, signal) {
    if (signal.aborted) {
        return Promise.reject(new ZaiFailure("request_timeout", { staleEligible: true }));
    }
    return new Promise((resolve, reject) => {
        const abort = () => reject(new ZaiFailure("request_timeout", { staleEligible: true }));
        signal.addEventListener("abort", abort, { once: true });
        promise.then((value) => {
            signal.removeEventListener("abort", abort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener("abort", abort);
            reject(error);
        });
    });
}
class ZaiFailure extends Error {
    // Bind a request failure to the key it tried, so a later unreadable sibling
    // cannot inherit that identity when its local failure wins precedence.
    cacheContextId;
    code;
    status;
    staleEligible;
    definitiveAuth;
    retryAfter;
    constructor(code, options = {}) {
        super(code);
        this.code = code;
        this.status = options.status ?? "error";
        this.staleEligible = options.staleEligible ?? false;
        this.definitiveAuth = options.definitiveAuth ?? false;
        this.retryAfter = options.retryAfter;
    }
}
