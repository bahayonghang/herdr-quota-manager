// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { homedir, join, runtimeProcess, RuntimeAbortController, RuntimeTextDecoder, runtimeSetTimeout, runtimeClearTimeout } from "../runtime.js";
import { opencodeDatabasePath, readOpenCodeDbCredential, } from "../lib/opencode-db.js";
import { readJsonFileResult } from "../lib/fs.js";
import { resolvePiAuthFilePath } from "../lib/pi-agent-dir.js";
import { classifyPiAuthEntry } from "../lib/pi-auth-store.js";
import { calendarMonthsBefore, parseEpochOrIso, clampPercent, } from "../lib/time.js";
import { usableLiteralSecret } from "../lib/secret.js";
import { failedProvider, sourceNames, successProvider } from "./common.js";
import { selectCredential, } from "./credential-selection.js";
export const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
export const OPENCODE_GO_CREDENTIAL_SOURCE = "opencode:auth.json";
export const OPENCODE_GO_DB_CREDENTIAL_SOURCE = "opencode:opencode.db";
export const PI_OPENCODE_GO_SOURCE = "pi:opencode-go";
/**
 * Explicit opt-in that lets OpenCode Go read Pi's `opencode-go` entry ahead of
 * the opencode store. Unset or falsey keeps the long-standing default: the
 * opencode store is the only source, so an unscoped run never probes Pi.
 */
export const PI_OPENCODE_GO_AUTH_ENV = "QUOTA_AXI_OPENCODE_GO_PI_AUTH";
const PI_OPENCODE_GO_PROVIDER_ID = "opencode-go";
const OPENCODE_GO_INTEGRATION_ID = "opencode-go";
const LABEL = "OpenCode Go";
const RESPONSE_LIMIT_BYTES = 262_144;
const BODY_CLEANUP_TIMEOUT_MS = 100;
const DEADLINE_MS = 15_000;
/** Plan-declared rolling cap: $12 per rolling 5 hours. */
const FIVE_HOURS_SECONDS = 18_000;
/** Plan-declared weekly cap: $30 per week. */
const WEEK_SECONDS = 7 * 24 * 60 * 60;
export function opencodeGoAuthFilePath() {
    const xdg = runtimeProcess.env.XDG_DATA_HOME?.trim();
    if (xdg)
        return join(xdg, "opencode", "auth.json");
    if (runtimeProcess.platform === "win32") {
        const localAppData = runtimeProcess.env.LOCALAPPDATA?.trim();
        if (localAppData)
            return join(localAppData, "opencode", "auth.json");
    }
    return join(join(homedir(), ".local", "share"), "opencode", "auth.json");
}
export function extractOpenCodeGoCredential(value, path) {
    const root = objectValue(value);
    if (!root)
        return { status: "missing", path };
    let hasEntry = false;
    for (const name of ["opencode-go", "opencode"]) {
        const entry = objectValue(root[name]);
        if (!entry)
            continue;
        hasEntry = true;
        const key = [
            entry.key,
            entry.apiKey,
            entry.api_key,
            entry.access,
            entry.token,
        ]
            .map(usableLiteralSecret)
            .find((candidate) => candidate !== undefined);
        if (key)
            return { status: "available", key, path };
    }
    return { status: hasEntry ? "invalid" : "missing", path };
}
function extractPiOpenCodeGoCredential(value, path) {
    const classified = classifyPiAuthEntry(value, PI_OPENCODE_GO_PROVIDER_ID);
    if (classified.status === "missing")
        return { status: "missing", path };
    const key = classified.status === "present" && classified.entry.type === "api_key"
        ? usableLiteralSecret(classified.entry.key)
        : undefined;
    return key ? { status: "available", key, path } : { status: "invalid", path };
}
function createJsonCredentialSource(filePath, extract) {
    function resolve() {
        const path = filePath();
        const result = readJsonFileResult(path);
        if (result.status === "missing")
            return { status: "missing", path };
        if (result.status === "invalid") {
            return {
                status: result.error === "file_read_error" ? "error" : "invalid",
                path,
            };
        }
        return extract(result.value, path);
    }
    return {
        resolve,
        inspect() {
            const resolution = resolve();
            return resolution.status === "available"
                ? { status: "available", path: resolution.path }
                : resolution;
        },
    };
}
export function createOpencodeGoAuthCredentialSource(filePath = opencodeGoAuthFilePath) {
    return createJsonCredentialSource(filePath, extractOpenCodeGoCredential);
}
/**
 * OpenCode 2.x keeps new and updated logins only in its SQLite `credential`
 * table. Read-only; see `src/lib/opencode-db.ts`.
 */
export function createOpencodeGoDbCredentialSource(filePath = () => opencodeDatabasePath(opencodeGoAuthFilePath())) {
    async function resolve() {
        const path = filePath();
        const result = await readOpenCodeDbCredential(path, OPENCODE_GO_INTEGRATION_ID);
        return result.status === "available"
            ? { status: "available", key: result.key, path }
            : { status: result.status, path };
    }
    return {
        resolve,
        async inspect() {
            const resolution = await resolve();
            return resolution.status === "available"
                ? { status: "available", path: resolution.path }
                : resolution;
        },
    };
}
export function createPiOpenCodeGoCredentialSource(filePath = resolvePiAuthFilePath) {
    return createJsonCredentialSource(filePath, extractPiOpenCodeGoCredential);
}
/**
 * Pi's `opencode-go` entry is added first only when the opt-in environment
 * flag asks for it. OpenCode 2.x's database comes next because it is where a
 * current login is stored, then the legacy `auth.json` stays as the fallback
 * for 1.x installs. See
 * README "Security Posture > Provider credential sources" for the rationale.
 */
export function defaultOpenCodeGoCredentialSources(environment = runtimeProcess.env) {
    const sources = [];
    if (piOpenCodeGoAuthEnabled(environment)) {
        sources.push({
            name: PI_OPENCODE_GO_SOURCE,
            source: createPiOpenCodeGoCredentialSource(),
        });
    }
    sources.push({
        name: OPENCODE_GO_DB_CREDENTIAL_SOURCE,
        source: createOpencodeGoDbCredentialSource(),
    }, {
        name: OPENCODE_GO_CREDENTIAL_SOURCE,
        source: createOpencodeGoAuthCredentialSource(),
    });
    return sources;
}
function piOpenCodeGoAuthEnabled(environment) {
    const value = environment[PI_OPENCODE_GO_AUTH_ENV]?.trim().toLowerCase();
    return value === "1" || value === "true";
}
export async function resolveOpenCodeGoCredential(path = opencodeGoAuthFilePath()) {
    return createOpencodeGoAuthCredentialSource(() => path).resolve();
}
export function createOpenCodeGoAdapter(overrides = {}) {
    const dependencies = {
        credentialSources: defaultOpenCodeGoCredentialSources(),
        fetch: globalThis.fetch,
        now: Date.now,
        deadlineMs: DEADLINE_MS,
        ...overrides,
    };
    return {
        id: "opencode-go",
        label: LABEL,
        fetchQuota: () => fetchQuota(dependencies),
        inspectAuth: () => inspectAuth(dependencies),
    };
}
export const opencodeGoAdapter = createOpenCodeGoAdapter();
async function fetchQuota(dependencies) {
    const { resolved, selection } = await selectOpenCodeGoCredential(dependencies);
    const attempts = sourceAttempts(resolved, selection);
    if (selection.outcome === "quota" && selection.result) {
        const normalized = selection.result;
        return successProvider({
            provider: "opencode-go",
            label: LABEL,
            source: "api",
            ...(normalized.plan ? { plan: normalized.plan } : {}),
            windows: normalized.windows,
            refreshedAt: new Date(dependencies.now()).toISOString(),
            sourcesTried: sourceNames(attempts),
            attempts,
        });
    }
    const failure = selectionFailureFor(selection, resolved);
    return failedProvider({
        provider: "opencode-go",
        label: LABEL,
        status: failure.status,
        error: failure.code,
        source: "api",
        sourcesTried: sourceNames(attempts),
        attempts,
    });
}
async function resolveSafely(source) {
    try {
        return await source.resolve();
    }
    catch {
        return { status: "error", path: "" };
    }
}
async function inspectSafely(source) {
    try {
        return await source.inspect();
    }
    catch {
        return { status: "error", path: "" };
    }
}
async function selectOpenCodeGoCredential(dependencies) {
    const resolved = [];
    const results = [];
    for (const { name, source } of dependencies.credentialSources) {
        const resolution = await resolveSafely(source);
        resolved.push({ name, resolution });
        if (resolution.status !== "available")
            continue;
        const selection = await selectCredential([
            {
                source: name,
                localState: "valid",
                credential: resolution.key,
            },
        ], (candidate) => attemptCandidate(candidate, dependencies));
        results.push(...selection.results);
        if (selection.outcome === "quota" ||
            selection.outcome === "transient" ||
            selection.outcome === "live_no_quota") {
            return {
                resolved,
                selection: { ...selection, results },
            };
        }
    }
    return {
        resolved,
        selection: {
            outcome: results.length > 0 ? "all_rejected" : "no_candidates",
            refreshable: false,
            results,
        },
    };
}
async function attemptCandidate(candidate, dependencies) {
    try {
        const payload = await requestUsage(candidate.credential, dependencies.fetch, dependencies.deadlineMs);
        const normalized = normalizeOpenCodeGoPayload(payload);
        if (normalized.windows.length === 0) {
            return { kind: "transient", error: "quota_missing" };
        }
        return { kind: "quota", result: normalized };
    }
    catch (error) {
        const code = errorCode(error);
        if (code === "provider_auth_rejected") {
            return { kind: "rejected", error: code };
        }
        return { kind: "transient", error: code };
    }
}
function sourceAttempts(resolved, selection) {
    return resolved.map(({ name, resolution }) => {
        if (resolution.status === "available") {
            return selectionAttemptRecord(name, selection.results.find((entry) => entry.source === name), selection);
        }
        return {
            source: name,
            status: resolution.status === "error" ? "failed" : "skipped",
            error: credentialError(resolution),
            ...(resolution.status === "invalid" || resolution.status === "skipped"
                ? { credentialPresent: true }
                : {}),
        };
    });
}
function selectionAttemptRecord(sourceName, result, selection) {
    if (result === undefined ||
        result.outcome === "not_tried" ||
        result.outcome === "live_no_quota") {
        return {
            source: sourceName,
            status: "skipped",
            ...(selection.transientError ? { error: selection.transientError } : {}),
        };
    }
    if (result.outcome === "quota") {
        return { source: sourceName, status: "success" };
    }
    return { source: sourceName, status: "failed", error: result.error };
}
function selectionFailureFor(selection, resolved) {
    switch (selection.outcome) {
        case "transient":
            return transientFailure(selection.transientError ?? "quota_request_failed");
        case "all_rejected": {
            const indeterminate = indeterminateFailureFor(resolved);
            return (indeterminate ?? {
                status: "auth_required",
                code: "provider_auth_rejected",
            });
        }
        case "live_no_quota":
            // Unreachable: every attempt yields windows or throws.
            return { status: "error", code: "quota_missing" };
        default:
            return (indeterminateFailureFor(resolved) ??
                localCredentialFailure({ status: "missing", path: "" }));
    }
}
function transientFailure(code) {
    return {
        status: code === "provider_rate_limited" ? "rate_limited" : "error",
        code,
    };
}
function indeterminateFailureFor(resolved) {
    const fallback = resolved.find(({ name, resolution }) => (name === OPENCODE_GO_CREDENTIAL_SOURCE ||
        name === OPENCODE_GO_DB_CREDENTIAL_SOURCE) &&
        (resolution.status === "invalid" ||
            resolution.status === "error" ||
            resolution.status === "skipped"));
    const preferred = resolved.find(({ name, resolution }) => name === PI_OPENCODE_GO_SOURCE &&
        (resolution.status === "invalid" || resolution.status === "error"));
    const failure = fallback ?? preferred;
    return failure ? localCredentialFailure(failure.resolution) : undefined;
}
function localCredentialFailure(resolution) {
    if (resolution.status === "missing") {
        return {
            status: "auth_required",
            code: "opencode_go_credential_unavailable",
        };
    }
    if (resolution.status === "error") {
        return { status: "error", code: "credential_resolution_failed" };
    }
    if (resolution.status === "skipped") {
        return { status: "error", code: "sqlite3_unavailable" };
    }
    return { status: "error", code: "opencode_go_credential_invalid" };
}
async function inspectAuth(dependencies) {
    const sources = await Promise.all(dependencies.credentialSources.map(async ({ name, source }) => {
        const inspection = await inspectSafely(source);
        return {
            source: name,
            path: inspection.path,
            status: inspection.status === "available"
                ? "available"
                : inspection.status === "missing"
                    ? "missing"
                    : inspection.status === "error"
                        ? "error"
                        : inspection.status === "skipped"
                            ? "skipped"
                            : "invalid",
            ...(inspection.status === "error"
                ? { error: "credential_resolution_failed" }
                : {}),
            ...(inspection.status === "skipped"
                ? { error: "sqlite3_unavailable", credentialPresent: true }
                : {}),
        };
    }));
    return { provider: "opencode-go", sources };
}
async function requestUsage(key, fetchImplementation, deadlineMs) {
    const controller = new RuntimeAbortController();
    let timeout;
    let timedOut = false;
    let fetchPromise;
    try {
        fetchPromise = fetchImplementation(OPENCODE_GO_USAGE_URL, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${key}`,
                Accept: "application/json",
            },
            credentials: "omit",
            redirect: "manual",
            signal: controller.signal,
        });
        void fetchPromise.then((response) => {
            if (timedOut)
                void cancelResponseBody(response);
        }, () => undefined);
        const timeoutPromise = new Promise((_, reject) => {
            timeout = runtimeSetTimeout(() => {
                timedOut = true;
                controller.abort();
                reject(new Error("provider_timeout"));
            }, deadlineMs);
        });
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        if (!response.ok) {
            await cancelResponseBody(response);
        }
        if (response.status === 401 || response.status === 403)
            throw new Error("provider_auth_rejected");
        if (response.status === 429)
            throw new Error("provider_rate_limited");
        if (!response.ok)
            throw new Error("provider_request_rejected");
        const body = await readResponseBody(response, controller.signal);
        try {
            return JSON.parse(new RuntimeTextDecoder("utf-8", { fatal: true }).decode(body));
        }
        catch {
            throw new Error("malformed_json");
        }
    }
    catch (error) {
        if (controller.signal.aborted)
            throw new Error("provider_timeout", { cause: error });
        if (error instanceof Error &&
            (error.message.startsWith("provider_") ||
                error.message === "response_too_large" ||
                error.message === "response_size_unverifiable" ||
                error.message === "malformed_json"))
            throw error;
        throw new Error("network_unavailable", { cause: error });
    }
    finally {
        if (timeout)
            runtimeClearTimeout(timeout);
    }
}
async function cancelResponseBody(response) {
    const body = response.body;
    if (!body)
        return;
    let cleanupTimer;
    const cancellation = Promise.resolve()
        .then(() => body.cancel())
        .catch(() => undefined);
    try {
        await Promise.race([
            cancellation,
            new Promise((resolve) => {
                cleanupTimer = runtimeSetTimeout(resolve, BODY_CLEANUP_TIMEOUT_MS);
            }),
        ]);
    }
    finally {
        if (cleanupTimer)
            runtimeClearTimeout(cleanupTimer);
    }
}
async function readResponseBody(response, signal) {
    const declaredLength = response.headers?.get("content-length")?.trim();
    const parsedLength = declaredLength ? Number(declaredLength) : undefined;
    const usableLength = parsedLength !== undefined &&
        Number.isInteger(parsedLength) &&
        parsedLength >= 0;
    if (usableLength &&
        parsedLength !== undefined &&
        parsedLength > RESPONSE_LIMIT_BYTES) {
        await cancelResponseBody(response);
        throw new Error("response_too_large");
    }
    if (!response.body)
        throw new Error("response_size_unverifiable");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    let pendingRead;
    try {
        while (true) {
            pendingRead = reader.read();
            const result = await raceWithAbort(pendingRead, signal);
            pendingRead = undefined;
            if (result.done)
                break;
            const chunk = result.value;
            if (length + chunk.byteLength > RESPONSE_LIMIT_BYTES) {
                throw new Error("response_too_large");
            }
            chunks.push(chunk);
            length += chunk.byteLength;
        }
    }
    finally {
        if (pendingRead) {
            if (typeof reader.cancel === "function")
                await settlePendingRead(reader, pendingRead);
            else
                pendingRead.catch(() => undefined);
        }
        else {
            if (typeof reader.cancel === "function")
                void reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}
async function settlePendingRead(reader, pendingRead) {
    // A pending read owns the stream lock. Cancellation is best effort here:
    // releasing it while the read is still pending throws in native streams and
    // can leave the response body in an inconsistent state. The settlement
    // handler below performs the release whenever the vendor body eventually
    // responds, even if that happens after this bounded cleanup returns.
    void Promise.resolve()
        .then(() => reader.cancel())
        .catch(() => undefined);
    let released = false;
    const releaseAfterReadSettles = () => {
        if (released)
            return;
        try {
            reader.releaseLock();
            released = true;
        }
        catch {
            return;
        }
    };
    const readSettled = pendingRead.then(releaseAfterReadSettles, releaseAfterReadSettles);
    let cleanupTimer;
    try {
        await Promise.race([
            readSettled,
            new Promise((resolve) => {
                cleanupTimer = runtimeSetTimeout(resolve, BODY_CLEANUP_TIMEOUT_MS);
            }),
        ]);
    }
    finally {
        if (cleanupTimer)
            runtimeClearTimeout(cleanupTimer);
    }
}
async function raceWithAbort(operation, signal) {
    if (signal.aborted)
        throw new Error("provider_timeout");
    let onAbort;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(new Error("provider_timeout"));
        signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
        return await Promise.race([operation, aborted]);
    }
    finally {
        if (onAbort)
            signal.removeEventListener("abort", onAbort);
    }
}
export function normalizeOpenCodeGoPayload(raw, now = Date.now()) {
    const root = objectValue(raw);
    const nestedUsage = objectValue(root?.usage);
    const definitions = [
        [["rollingUsage", "rolling"], "five_hour", "session"],
        [["weeklyUsage", "weekly"], "weekly", "weekly"],
        [["monthlyUsage", "monthly"], "monthly", "monthly"],
    ];
    const windows = definitions
        .map(([names, id, kind]) => {
        const record = names
            .map((name) => objectValue(nestedUsage?.[name]) ?? objectValue(root?.[name]))
            .find((candidate) => candidate !== undefined);
        return record ? normalizeWindow(record, id, kind, now) : undefined;
    })
        .filter((window) => window !== undefined);
    const plan = firstString(root, ["planName", "plan_name", "plan"]) ?? "OpenCode Go";
    return { plan, windows };
}
function normalizeWindow(record, id, kind, now) {
    const used = firstNumber(record, [
        "percent",
        "percentUsed",
        "usedPercent",
        "usagePercent",
    ]);
    const remaining = firstNumber(record, [
        "percentRemaining",
        "remainingPercent",
    ]);
    const status = stringValue(record.status)?.toLowerCase();
    const percentRemaining = remaining !== undefined
        ? clampPercent(remaining)
        : used !== undefined
            ? clampPercent(100 - used)
            : status === "rate-limited"
                ? 0
                : undefined;
    if (percentRemaining === undefined)
        return undefined;
    const reset = firstValue(record, [
        "resetsAt",
        "resetAt",
        "reset_at",
        "nextResetTime",
    ]);
    const windowSeconds = firstNumber(record, [
        "windowSeconds",
        "window_seconds",
        "cycleSeconds",
        "cycle_seconds",
        "durationSeconds",
        "duration_seconds",
        "periodSeconds",
        "period_seconds",
    ]);
    const resetInSec = firstNumber(record, ["resetInSec", "reset_in_sec"]);
    const parsedReset = safeParseReset(reset) ??
        (resetInSec !== undefined && resetInSec >= 0
            ? isoFromTimestamp(now + resetInSec * 1_000)
            : undefined);
    // Only a payload-supplied 18,000 s rolling duration promotes the window to
    // the `five_hour` identity; plan-declared fallbacks below never do.
    const hasAuthoritativeDuration = windowSeconds === FIVE_HOURS_SECONDS;
    const hasPayloadDuration = windowSeconds !== undefined && windowSeconds > 0;
    // Plan-declared cycle lengths fill in only when the payload names none;
    // a payload duration always wins. The monthly cap is one calendar month
    // ending at the reported reset, so only its start is derived.
    const effectiveWindowSeconds = hasPayloadDuration
        ? windowSeconds
        : parsedReset === undefined
            ? undefined
            : id === "five_hour"
                ? FIVE_HOURS_SECONDS
                : id === "weekly"
                    ? WEEK_SECONDS
                    : undefined;
    const derivedStartsAt = id === "monthly" && !hasPayloadDuration && parsedReset !== undefined
        ? calendarMonthsBefore(parsedReset, 1)
        : undefined;
    const normalizedIdentity = id === "five_hour" && !hasAuthoritativeDuration
        ? { id: "rolling", label: "rolling", kind: "unknown" }
        : { id, label: id === "five_hour" ? "session" : id, kind };
    return {
        ...normalizedIdentity,
        percentUsed: clampPercent(100 - percentRemaining),
        percentRemaining,
        ...(effectiveWindowSeconds !== undefined
            ? { windowSeconds: effectiveWindowSeconds }
            : {}),
        ...(derivedStartsAt ? { startsAt: derivedStartsAt } : {}),
        ...(parsedReset ? { resetsAt: parsedReset } : {}),
    };
}
function safeParseReset(value) {
    try {
        const parsed = parseEpochOrIso(value);
        return parsed && !Number.isNaN(Date.parse(parsed)) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function isoFromTimestamp(timestamp) {
    if (!Number.isFinite(timestamp))
        return undefined;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function credentialError(resolution) {
    return resolution.status === "missing"
        ? "opencode_go_credential_unavailable"
        : resolution.status === "invalid"
            ? "opencode_go_credential_invalid"
            : resolution.status === "skipped"
                ? "sqlite3_unavailable"
                : "credential_resolution_failed";
}
function errorCode(error) {
    return error instanceof Error && error.message
        ? error.message
        : "quota_request_failed";
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
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : undefined;
}
function firstNumber(value, keys) {
    return keys
        .map((key) => numberValue(value[key]))
        .find((item) => item !== undefined);
}
function firstValue(value, keys) {
    return keys
        .map((key) => value[key])
        .find((item) => item !== undefined && item !== null);
}
