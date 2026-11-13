// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { runtimeProcess, RuntimeAbortController, RuntimeTextDecoder, runtimeSetTimeout, runtimeClearTimeout } from "../runtime.js";
import { readJsonFileResult } from "../lib/fs.js";
import { readBoundedResponseBody } from "../lib/http.js";
import { resolvePiAuthFilePath } from "../lib/pi-agent-dir.js";
import { classifyPiAuthEntry } from "../lib/pi-auth-store.js";
import { usableLiteralSecret } from "../lib/secret.js";
import { retryAfterToIso } from "../lib/time.js";
/**
 * The env half of an env-plus-Pi credential surface: a usable literal value
 * under `envVar` is an available credential, an unset or blank variable
 * selects nothing, and a set value that is not a usable literal secret is a
 * present-but-invalid credential rather than an absence.
 */
export function pushEnvCredential(credentials, environment, envVar, envSource) {
    const raw = environment[envVar];
    const key = usableLiteralSecret(raw);
    credentials.push(key
        ? { status: "available", key, source: envSource }
        : raw !== undefined && raw.trim().length > 0
            ? { status: "invalid", source: envSource }
            : { status: "missing", source: envSource });
}
/**
 * The auth.json read-status dispatch shared by env-plus-Pi adapters: a missing
 * store is a missing source, an unreadable store is an error and any other
 * unparseable store is invalid, and only a parsed store reaches the adapter's
 * own entry extractor.
 */
export function pushPiReadCredential(credentials, result, source, path, extract) {
    if (result.status === "missing") {
        credentials.push({ status: "missing", source, path });
    }
    else if (result.status === "invalid") {
        credentials.push({
            status: result.error === "file_read_error" ? "error" : "invalid",
            source,
            path,
        });
    }
    else {
        credentials.push(extract(result.value));
    }
}
export function resolveEnvPiCredentials(sources, environment = runtimeProcess.env, path = resolvePiAuthFilePath()) {
    const credentials = [];
    pushEnvCredential(credentials, environment, sources.envVar, sources.envSource);
    pushPiReadCredential(credentials, readJsonFileResult(path), sources.piSource, path, (value) => extractPiKeyCredential(value, sources.piProviderId, sources.piSource, path));
    return credentials;
}
export function extractPiKeyCredential(value, piProviderId, piSource, path) {
    const classified = classifyPiAuthEntry(value, piProviderId);
    if (classified.status !== "present")
        return { status: classified.status, source: piSource, path };
    const key = [
        classified.entry.key,
        classified.entry.apiKey,
        classified.entry.api_key,
        classified.entry.access,
        classified.entry.token,
    ]
        .map(usableLiteralSecret)
        .find((candidate) => candidate !== undefined);
    if (key)
        return { status: "available", key, source: piSource, path };
    return { status: "invalid", source: piSource, path };
}
export function credentialCandidates(credential) {
    const credentials = credential();
    return Array.isArray(credentials) ? credentials : [credentials];
}
/** The suffix `keyCredentialFailure` gives a missing source's diagnostic. */
const ABSENT_CREDENTIAL_SUFFIX = "_credential_unavailable";
export function keyCredentialFailure(provider, resolution) {
    return {
        status: resolution.status === "error" ? "error" : "auth_required",
        error: resolution.status === "missing"
            ? `${provider}${ABSENT_CREDENTIAL_SUFFIX}`
            : resolution.status === "invalid"
                ? `${provider}_credential_invalid`
                : `${provider}_credential_resolution_failed`,
    };
}
function isAbsentCredentialFailure(failure) {
    return failure.error.endsWith(ABSENT_CREDENTIAL_SUFFIX);
}
/**
 * A present-but-unusable credential outranks an earlier plain absence - the
 * credential surface exists, so naming it `unavailable` describes the wrong
 * failure - a credential-resolution error outranks both, and an empirical
 * endpoint rejection outranks them: only a real answer or a real rejection
 * should ever name the account's state.
 */
export function preferCredentialFailure(current, next) {
    if (!current || isAbsentCredentialFailure(current))
        return next;
    if (current.status === "auth_required" && next.status === "error")
        return next;
    return current;
}
export function preferRemoteAuthFailure(current, error) {
    if (current?.status === "error")
        return current;
    return { status: "auth_required", error };
}
export function inspectEnvPiAuth(provider, credentials) {
    const sources = credentials.map((resolution) => ({
        source: resolution.source,
        path: resolution.path,
        status: resolution.status === "available"
            ? "available"
            : resolution.status === "missing"
                ? "missing"
                : resolution.status === "error"
                    ? "error"
                    : "invalid",
        ...(resolution.status === "error" || resolution.status === "invalid"
            ? {
                error: keyCredentialFailure(provider, resolution).error,
                credentialPresent: true,
            }
            : {}),
    }));
    return { provider, sources };
}
export function errorCode(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
export function statusFromRequestError(error) {
    if (error === "provider_auth_rejected")
        return "auth_required";
    if (error === "provider_rate_limited")
        return "rate_limited";
    return "error";
}
export class KeyEndpointError extends Error {
    retryAfter;
    constructor(code, retryAfter) {
        super(code);
        this.retryAfter = retryAfter;
    }
}
export async function requestKeyEndpoint(url, key, fetchImplementation, deadlineMs) {
    const controller = new RuntimeAbortController();
    const timeout = runtimeSetTimeout(() => controller.abort(), deadlineMs);
    try {
        const response = await fetchImplementation(url, {
            method: "GET",
            headers: {
                Authorization: "Bearer " + key,
                Accept: "application/json",
            },
            credentials: "omit",
            redirect: "manual",
            signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403)
            throw new KeyEndpointError("provider_auth_rejected");
        if (response.status === 429)
            throw new KeyEndpointError("provider_rate_limited", retryAfterToIso(response.headers.get("retry-after")));
        if (!response.ok)
            throw new KeyEndpointError("provider_error:" + response.status);
        const body = await readBoundedResponseBody(response, controller.signal, (code) => new KeyEndpointError(code));
        try {
            return JSON.parse(new RuntimeTextDecoder("utf-8", { fatal: true }).decode(body));
        }
        catch {
            throw new KeyEndpointError("invalid_json");
        }
    }
    catch (error) {
        if (controller.signal.aborted)
            throw new KeyEndpointError("provider_timeout");
        if (error instanceof KeyEndpointError)
            throw error;
        throw new KeyEndpointError("network_unavailable");
    }
    finally {
        runtimeClearTimeout(timeout);
    }
}
