// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { readFileSync, statSync, homedir, join, runtimeProcess, RuntimeAbortController, RuntimeTextDecoder, runtimeSetTimeout, runtimeClearTimeout } from "../runtime.js";
import { createHash } from "crypto";



import { deleteCachedProvider as deleteCachedProviderFromDisk, readCachedMiniMaxProvider as readCachedProviderFromDisk, } from "../cache.js";
import { providerFetch, readBoundedResponseBody } from "../lib/http.js";
import { resolvePiAuthFilePath } from "../lib/pi-agent-dir.js";
import { classifyPiAuthEntry } from "../lib/pi-auth-store.js";
import { usableLiteralSecret } from "../lib/secret.js";
import { clampPercent, retryAfterToIso } from "../lib/time.js";
import { publishMiniMaxReadingContextId } from "./minimax-cache-context.js";
import { failedProvider, sourceNames, staleFromCache, successProvider, } from "./common.js";
import { traceInput } from "../lib/input-trace.js";
export const MINIMAX_QUOTA_PATH = "/v1/token_plan/remains";
export const MINIMAX_BALANCE_PATH = "/account/query_balance";
export const MINIMAX_GLOBAL_BASE_URL = "https://api.minimax.io";
export const MINIMAX_CHINA_BASE_URL = "https://api.minimaxi.com";
export const MINIMAX_PI_SOURCE = "pi:minimax";
export const MINIMAX_CLI_SOURCE = "minimax:config.json";
export const MINIMAX_ENV_SOURCE = "env:MINIMAX_API_KEY";
const LABEL = "MiniMax";
const CONFIG_FILE_LIMIT_BYTES = 64 * 1024;
const DEADLINE_MS = 15_000;
export function minimaxConfigPath() {
    const configured = runtimeProcess.env.MMX_CONFIG_DIR?.trim();
    return join(configured || join(homedir(), ".mmx"), "config.json");
}
export function extractMiniMaxCredential(value, path, source = MINIMAX_PI_SOURCE) {
    const root = objectValue(value);
    if (!root)
        return { status: "invalid", source, path, error: "json_parse_error" };
    const classified = classifyPiAuthEntry(root, "minimax");
    if (classified.status === "missing")
        return { status: "missing", source, path };
    if (classified.status === "invalid")
        return { status: "invalid", source, path, error: "credential_missing" };
    const key = extractKey(classified.entry);
    if (!key)
        return { status: "invalid", source, path, error: "credential_missing" };
    return {
        status: "available",
        key,
        source,
        path,
        baseUrl: configuredBaseUrl(),
    };
}
export function extractMiniMaxCliCredentials(value, path) {
    const root = objectValue(value);
    if (!root)
        return [
            {
                status: "invalid",
                source: MINIMAX_CLI_SOURCE,
                path,
                error: "json_parse_error",
            },
        ];
    const apiKey = usableLiteralSecret(root.api_key);
    const oauth = objectValue(root.oauth);
    const accessToken = usableLiteralSecret(oauth?.access_token);
    const baseUrl = configBaseUrl(root);
    const credentials = [];
    if (accessToken) {
        credentials.push({
            status: "available",
            key: accessToken,
            source: MINIMAX_CLI_SOURCE,
            path,
            baseUrl,
        });
    }
    if (apiKey) {
        credentials.push({
            status: "available",
            key: apiKey,
            source: MINIMAX_CLI_SOURCE,
            path,
            baseUrl,
        });
    }
    if (credentials.length > 0)
        return credentials;
    const hasCredential = Object.hasOwn(root, "api_key") || oauth !== undefined;
    return [
        hasCredential
            ? {
                status: "invalid",
                source: MINIMAX_CLI_SOURCE,
                path,
                error: "credential_missing",
            }
            : missingCliCredential(path),
    ];
}
function missingCliCredential(path) {
    return { status: "missing", source: MINIMAX_CLI_SOURCE, path };
}
export function resolveMiniMaxCredentials() {
    const credentials = [];
    const raw = runtimeProcess.env.MINIMAX_API_KEY;
    const envKey = usableLiteralSecret(raw);
    credentials.push(envKey
        ? {
            status: "available",
            key: envKey,
            source: MINIMAX_ENV_SOURCE,
            baseUrl: configuredBaseUrl(),
        }
        : raw !== undefined && raw.trim().length > 0
            ? {
                status: "invalid",
                source: MINIMAX_ENV_SOURCE,
                error: "minimax_credential_invalid",
            }
            : { status: "missing", source: MINIMAX_ENV_SOURCE });
    const piPath = resolvePiAuthFilePath();
    const piResult = readBoundedJsonFile(piPath);
    if (piResult.status === "success") {
        credentials.push(extractMiniMaxCredential(piResult.value, piPath));
    }
    else if (piResult.status === "invalid") {
        credentials.push({
            status: piResult.error === "json_parse_error" ? "invalid" : "error",
            source: MINIMAX_PI_SOURCE,
            path: piPath,
            error: piResult.error,
        });
    }
    else {
        credentials.push({
            status: "missing",
            source: MINIMAX_PI_SOURCE,
            path: piPath,
        });
    }
    const cliPath = minimaxConfigPath();
    const cliResult = readBoundedJsonFile(cliPath);
    if (cliResult.status === "success") {
        credentials.push(...extractMiniMaxCliCredentials(cliResult.value, cliPath));
    }
    else if (cliResult.status === "invalid") {
        credentials.push({
            status: cliResult.error === "json_parse_error" ? "invalid" : "error",
            source: MINIMAX_CLI_SOURCE,
            path: cliPath,
            error: cliResult.error,
        });
    }
    else {
        credentials.push(missingCliCredential(cliPath));
    }
    return credentials;
}
export function createMiniMaxAdapter(overrides = {}) {
    const dependencies = {
        credential: resolveMiniMaxCredentials,
        fetch: providerFetch,
        readCachedProvider: readCachedProviderFromDisk,
        deleteCachedProvider: deleteCachedProviderFromDisk,
        now: Date.now,
        deadlineMs: DEADLINE_MS,
        ...overrides,
    };
    return {
        id: "minimax",
        label: LABEL,
        fetchQuota: () => fetchQuotaWithDependencies(dependencies),
        inspectAuth: () => inspectAuthWithDependencies(dependencies),
    };
}
export const minimaxAdapter = createMiniMaxAdapter();
async function fetchQuotaWithDependencies(dependencies) {
    const attempts = [];
    let finalFailure;
    let finalResolution;
    for (const resolution of credentialCandidates(dependencies)) {
        if (resolution.status !== "available") {
            const failure = credentialFailure(resolution);
            replaceCredentialAttempt(attempts, resolution.source, {
                source: resolution.source,
                status: resolution.status === "missing" ? "skipped" : "failed",
                error: failure.code,
                ...(resolution.status === "invalid" || resolution.status === "error"
                    ? { credentialPresent: true }
                    : {}),
            });
            if (preferMiniMaxFailure(finalFailure, failure) === failure) {
                finalFailure = failure;
                finalResolution = resolution;
            }
            continue;
        }
        try {
            const payload = await requestMiniMax(resolution.key, resolution.baseUrl, dependencies.fetch, dependencies.deadlineMs);
            const normalized = normalizeMiniMaxPayload(payload, resolution.baseUrl);
            if (normalized.windows.length === 0 &&
                normalized.credits === undefined &&
                !isAuthoritativeEmptyMiniMaxAllocation(payload)) {
                throw new MiniMaxFailure("quota_missing", { staleEligible: true });
            }
            replaceCredentialAttempt(attempts, resolution.source, {
                source: resolution.source,
                status: "success",
            });
            publishMiniMaxReadingContextId(miniMaxCacheContextId(resolution.source, resolution.baseUrl));
            const report = successProvider({
                provider: "minimax",
                label: LABEL,
                source: "api",
                ...(normalized.plan ? { plan: normalized.plan } : {}),
                windows: normalized.windows,
                ...(normalized.credits ? { credits: normalized.credits } : {}),
                refreshedAt: new Date(dependencies.now()).toISOString(),
                sourcesTried: sourceNames(attempts),
                attempts,
            });
            if (normalized.untrustedWindowIds) {
                report.state.untrustedWindowIds = normalized.untrustedWindowIds;
            }
            return report;
        }
        catch (error) {
            const failure = error instanceof MiniMaxFailure
                ? error
                : new MiniMaxFailure(errorCode(error), { staleEligible: true });
            replaceCredentialAttempt(attempts, resolution.source, {
                source: resolution.source,
                status: "failed",
                error: failure.code,
            });
            if (failure.definitiveAuth) {
                if (preferMiniMaxAuthFailure(finalFailure, failure) === failure) {
                    finalFailure = failure;
                    finalResolution = resolution;
                }
                continue;
            }
            if (failure.staleEligible) {
                try {
                    const cached = dependencies.readCachedProvider(miniMaxCacheContextId(resolution.source, resolution.baseUrl));
                    const stale = cached
                        ? staleFromCache(cached, failure.code, sourceNames(attempts), attempts, dependencies.now())
                        : undefined;
                    if (stale)
                        return stale;
                }
                catch {
                    // Cache I/O cannot replace the bounded provider failure.
                }
            }
            return failedProvider({
                provider: "minimax",
                label: LABEL,
                status: failure.status,
                error: failure.code,
                source: "unavailable",
                retryAfter: failure.retryAfter,
                sourcesTried: sourceNames(attempts),
                attempts,
            });
        }
    }
    const failure = finalFailure ??
        new MiniMaxFailure("minimax_credential_unavailable", {
            status: "auth_required",
            definitiveAuth: true,
        });
    if (failure.definitiveAuth) {
        try {
            dependencies.deleteCachedProvider("minimax");
        }
        catch {
            // Preserve the current definitive auth result.
        }
    }
    else if (failure.staleEligible && finalResolution) {
        try {
            const cached = dependencies.readCachedProvider(miniMaxCacheContextId(finalResolution.source, finalResolution.status === "available"
                ? finalResolution.baseUrl
                : configuredBaseUrl()));
            const stale = cached
                ? staleFromCache(cached, failure.code, sourceNames(attempts), attempts, dependencies.now())
                : undefined;
            if (stale)
                return stale;
        }
        catch {
            // Cache I/O cannot replace the bounded provider failure.
        }
    }
    return failedProvider({
        provider: "minimax",
        label: LABEL,
        status: failure.status,
        error: failure.code,
        source: "unavailable",
        retryAfter: failure.retryAfter,
        sourcesTried: sourceNames(attempts),
        attempts,
    });
}
async function inspectAuthWithDependencies(dependencies) {
    const sources = credentialCandidates(dependencies).map((resolution) => ({
        source: resolution.source,
        ...(resolution.path ? { path: resolution.path } : {}),
        status: resolution.status === "available"
            ? "available"
            : resolution.status === "missing"
                ? "missing"
                : resolution.status === "error"
                    ? "error"
                    : "invalid",
        ...(resolution.status !== "available" && resolution.error
            ? { error: resolution.error }
            : {}),
        ...(resolution.status !== "missing" ? { credentialPresent: true } : {}),
    }));
    return { provider: "minimax", sources };
}
export function normalizeMiniMaxPayload(raw, baseUrl) {
    const root = objectValue(raw);
    if (!root)
        return { windows: [] };
    const balanceRoot = objectValue(root.data) ?? root;
    const balance = numberValue(balanceRoot.available_amount);
    if (balance !== undefined) {
        // The China deployment denominates balances in CNY; the response carries
        // no currency field, so the answering host is the only unit evidence.
        const unit = miniMaxBalanceUnit(baseUrl);
        return { windows: [], credits: { remaining: balance, unit } };
    }
    const data = objectValue(root.data) ?? root;
    const rows = data && Array.isArray(data.model_remains) ? data.model_remains : [];
    const windows = [];
    const untrustedWindowIds = [];
    for (const [offset, row] of rows.entries()) {
        const recognized = normalizeModelRemain(row);
        if (recognized.length > 0 || isNoAllocationModelRemain(row)) {
            windows.push(...recognized);
            continue;
        }
        const id = `limit:${offset + 1}`;
        windows.push({ id, label: `limit ${offset + 1}`, kind: "unknown" });
        untrustedWindowIds.push(id);
    }
    const plan = firstString(data, ["plan", "plan_name", "planName"]);
    return {
        windows,
        ...(plan ? { plan } : {}),
        ...(untrustedWindowIds.length > 0 ? { untrustedWindowIds } : {}),
    };
}
function miniMaxBalanceUnit(baseUrl) {
    try {
        return new URL(baseUrl ?? MINIMAX_GLOBAL_BASE_URL).hostname ===
            new URL(MINIMAX_CHINA_BASE_URL).hostname
            ? "cny"
            : "usd";
    }
    catch {
        return "usd";
    }
}
function normalizeModelRemain(raw) {
    const row = objectValue(raw);
    const modelName = stringValue(row?.model_name);
    if (!row || !modelName)
        return [];
    const modelId = modelSlug(modelName);
    if (!modelId)
        return [];
    const interval = normalizeModelWindow(row, modelId, modelName, "current_interval");
    const weekly = normalizeModelWindow(row, modelId, modelName, "current_weekly");
    return [interval, weekly].filter((window) => window !== undefined);
}
function normalizeModelWindow(row, modelId, modelName, prefix) {
    const status = numberValue(row[`${prefix}_status`]);
    const total = numberValue(row[`${prefix}_total_count`]);
    const reported = numberValue(row[`${prefix}_usage_count`]);
    if (isNoAllocationModelWindow(row, prefix))
        return undefined;
    const startKey = prefix === "current_interval" ? "start_time" : "weekly_start_time";
    const endKey = prefix === "current_interval" ? "end_time" : "weekly_end_time";
    if (![
        `${prefix}_status`,
        `${prefix}_total_count`,
        `${prefix}_usage_count`,
        `${prefix}_remaining_percent`,
        startKey,
        endKey,
    ].some((key) => Object.hasOwn(row, key))) {
        return undefined;
    }
    const startsAt = parseEpoch(row[startKey]);
    const resetsAt = parseEpoch(row[endKey]);
    const windowSeconds = startsAt && resetsAt
        ? (Date.parse(resetsAt) - Date.parse(startsAt)) / 1000
        : undefined;
    const explicit = numberValue(row[`${prefix}_remaining_percent`]);
    const percentRemaining = explicit !== undefined
        ? clampPercent(explicit)
        : remainingFromCounts(reported, total);
    const identity = miniMaxWindowIdentity(prefix, windowSeconds);
    const remaining = percentRemaining ?? (status === 2 ? 0 : undefined);
    return {
        id: `model:${modelId}:${identity.idSuffix}`,
        label: `${modelName} ${identity.label}`,
        kind: "model",
        ...(remaining !== undefined
            ? {
                percentUsed: clampPercent(100 - remaining),
                percentRemaining: remaining,
            }
            : {}),
        ...(startsAt ? { startsAt } : {}),
        ...(resetsAt ? { resetsAt } : {}),
        ...(windowSeconds !== undefined && windowSeconds > 0
            ? { windowSeconds }
            : {}),
    };
}
function isAuthoritativeEmptyMiniMaxAllocation(payload) {
    const root = objectValue(payload);
    const data = objectValue(objectValue(root)?.data) ?? root;
    const rows = data && Array.isArray(data.model_remains) ? data.model_remains : [];
    return rows.length > 0 && rows.every(isNoAllocationModelRemain);
}
function isNoAllocationModelRemain(raw) {
    const row = objectValue(raw);
    return (row !== undefined &&
        stringValue(row.model_name) !== undefined &&
        isNoAllocationModelWindow(row, "current_interval") &&
        isNoAllocationModelWindow(row, "current_weekly"));
}
function isNoAllocationModelWindow(row, prefix) {
    return (numberValue(row[`${prefix}_status`]) === 3 &&
        numberValue(row[`${prefix}_total_count`]) === 0 &&
        numberValue(row[`${prefix}_usage_count`]) === 0);
}
function miniMaxWindowIdentity(prefix, windowSeconds) {
    if (windowSeconds === 18_000)
        return { idSuffix: "5h", label: "5h" };
    if (windowSeconds === 604_800)
        return { idSuffix: "7d", label: "7d" };
    if (windowSeconds !== undefined && windowSeconds > 0) {
        const label = formatMiniMaxWindowSeconds(windowSeconds);
        return { idSuffix: `window:${label}`, label };
    }
    return prefix === "current_weekly"
        ? { idSuffix: "window:weekly", label: "weekly" }
        : { idSuffix: "window:current_interval", label: "current interval" };
}
function formatMiniMaxWindowSeconds(seconds) {
    if (Number.isInteger(seconds / 86_400))
        return `${seconds / 86_400}d`;
    if (Number.isInteger(seconds / 3_600))
        return `${seconds / 3_600}h`;
    if (Number.isInteger(seconds / 60))
        return `${seconds / 60}m`;
    return `${seconds}s`;
}
function remainingFromCounts(reported, total) {
    if (reported === undefined ||
        total === undefined ||
        total <= 0 ||
        reported < 0 ||
        reported > total)
        return undefined;
    // MiniMax's official CLI preserves the legacy meaning of usage_count when
    // no explicit percentage is present: it is the remaining count.
    return clampPercent((reported / total) * 100);
}
async function requestMiniMax(key, baseUrl, fetchImplementation, deadlineMs) {
    const apiKey = key.startsWith("sk-api-");
    const url = `${baseUrl}${apiKey ? MINIMAX_BALANCE_PATH : MINIMAX_QUOTA_PATH}`;
    const controller = new RuntimeAbortController();
    const timer = runtimeSetTimeout(() => controller.abort(), deadlineMs);
    let response;
    try {
        response = await fetchImplementation(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${key}`,
                Accept: "application/json",
            },
            credentials: "omit",
            redirect: "manual",
            signal: controller.signal,
        });
        if (!response.ok) {
            await cancelBody(response);
            if (response.status === 401 || response.status === 403)
                throw new MiniMaxFailure("provider_auth_rejected", {
                    status: "auth_required",
                    definitiveAuth: true,
                });
            if (response.status === 429)
                throw new MiniMaxFailure("provider_rate_limited", {
                    status: "rate_limited",
                    staleEligible: true,
                    retryAfter: retryAfterToIso(response.headers.get("retry-after")),
                });
            throw new MiniMaxFailure("provider_request_rejected", {
                staleEligible: true,
            });
        }
        const body = await readBoundedResponseBody(response, controller.signal, (code) => new MiniMaxFailure(code, { staleEligible: true }));
        try {
            const parsed = JSON.parse(new RuntimeTextDecoder("utf-8", { fatal: true }).decode(body));
            rejectMiniMaxApplicationError(parsed);
            return parsed;
        }
        catch (error) {
            if (error instanceof MiniMaxFailure)
                throw error;
            throw new MiniMaxFailure("malformed_json", { staleEligible: true });
        }
    }
    catch (error) {
        if (controller.signal.aborted)
            throw new MiniMaxFailure("provider_timeout", { staleEligible: true });
        if (error instanceof MiniMaxFailure)
            throw error;
        throw new MiniMaxFailure("network_unavailable", { staleEligible: true });
    }
    finally {
        runtimeClearTimeout(timer);
    }
}
function rejectMiniMaxApplicationError(payload) {
    const baseResp = objectValue(payload)?.base_resp;
    const statusCode = numberValue(objectValue(baseResp)?.status_code);
    if (statusCode === undefined || statusCode === 0)
        return;
    if (statusCode === 1004 || statusCode === 2049) {
        throw new MiniMaxFailure("provider_auth_rejected", {
            status: "auth_required",
            definitiveAuth: true,
        });
    }
    if (statusCode === 1002) {
        throw new MiniMaxFailure("provider_rate_limited", {
            status: "rate_limited",
            staleEligible: true,
        });
    }
    throw new MiniMaxFailure("provider_request_rejected", {
        staleEligible: true,
    });
}
async function cancelBody(response) {
    try {
        await response.body?.cancel();
    }
    catch {
        // Releasing a rejected response body is best effort.
    }
}
function credentialCandidates(dependencies) {
    const credentials = dependencies.credential();
    return Array.isArray(credentials) ? credentials : [credentials];
}
function preferMiniMaxFailure(current, next) {
    if (!current || current.code === "minimax_credential_unavailable")
        return next;
    if (current.definitiveAuth && !next.definitiveAuth)
        return next;
    return current;
}
// An empirical provider rejection outweighs a local absent/invalid
// diagnostic, but never an error-status resolution failure.
function preferMiniMaxAuthFailure(current, next) {
    if (current && !current.definitiveAuth)
        return current;
    return next;
}
function replaceCredentialAttempt(attempts, source, attempt) {
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
        if (attempts[index].source === source) {
            attempts[index] = attempt;
            return;
        }
    }
    attempts.push(attempt);
}
/**
 * The cache identity a reading from this credential belongs to: the source
 * that produced it plus the deployment host its resolution implies, so one
 * account's snapshot can never serve another source's or host's stale read.
 * A resolution that could not produce a credential still names the source and
 * the deployment the environment implies, which is all a stale read can ask.
 */
function miniMaxCacheContextId(source, baseUrl) {
    return createHash("sha256")
        .update(`minimax-source:${source}\nbase:${baseUrl}`)
        .digest("hex");
}
function credentialFailure(resolution) {
    if (resolution.status === "missing")
        return new MiniMaxFailure("minimax_credential_unavailable", {
            status: "auth_required",
            definitiveAuth: true,
        });
    if (resolution.status === "invalid")
        return new MiniMaxFailure("minimax_credential_invalid", {
            status: "auth_required",
            definitiveAuth: true,
        });
    return new MiniMaxFailure("credential_resolution_failed", {
        staleEligible: true,
    });
}
function configuredBaseUrl() {
    return safeBaseUrl(runtimeProcess.env.MINIMAX_BASE_URL) ?? MINIMAX_GLOBAL_BASE_URL;
}
function configBaseUrl(root) {
    const explicit = safeBaseUrl(stringValue(root.base_url)) ??
        safeBaseUrl(stringValue(objectValue(root.oauth)?.resource_url));
    if (explicit)
        return explicit;
    return stringValue(root.region)?.toLowerCase() === "cn"
        ? MINIMAX_CHINA_BASE_URL
        : configuredBaseUrl();
}
function safeBaseUrl(value) {
    if (!value)
        return undefined;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password)
            return undefined;
        if (parsed.hostname !== "api.minimax.io" &&
            parsed.hostname !== "api.minimaxi.com")
            return undefined;
        return parsed.origin;
    }
    catch {
        return undefined;
    }
}
function readBoundedJsonFile(path) {
    let text;
    traceInput(path);
    try {
        const size = statSync(path).size;
        if (size > CONFIG_FILE_LIMIT_BYTES)
            return { status: "invalid", error: "file_too_large" };
        text = readFileSync(path, "utf8");
    }
    catch (error) {
        const code = objectValue(error)?.code;
        return code === "ENOENT"
            ? { status: "missing" }
            : { status: "invalid", error: "file_read_error" };
    }
    if (Buffer.byteLength(text, "utf8") > CONFIG_FILE_LIMIT_BYTES)
        return { status: "invalid", error: "file_too_large" };
    try {
        return { status: "success", value: JSON.parse(text) };
    }
    catch {
        return { status: "invalid", error: "json_parse_error" };
    }
}
function extractKey(entry) {
    if (!entry)
        return undefined;
    for (const field of ["key", "apiKey", "api_key", "access", "accessToken"]) {
        const key = usableLiteralSecret(entry[field]);
        if (key)
            return key;
    }
    return undefined;
}
function parseEpoch(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    if (typeof value !== "string" || value.trim() === "")
        return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric))
        return parseEpoch(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function modelSlug(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function objectValue(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function firstString(value, keys) {
    return value
        ? keys.map((key) => stringValue(value[key])).find(Boolean)
        : undefined;
}
function numberValue(value) {
    if (typeof value !== "number" && typeof value !== "string")
        return undefined;
    if (typeof value === "string" && value.trim() === "")
        return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function errorCode(error) {
    return error instanceof MiniMaxFailure ? error.code : "quota_request_failed";
}
class MiniMaxFailure extends Error {
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
