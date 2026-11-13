// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { mkdirSync, readFileSync, open, homedir, dirname, isAbsolute, join, relative, resolve, sep, runtimeProcess } from "../runtime.js";
import { traceInput } from "./input-trace.js";
import { createHash } from "crypto";


import { claudeEnvOauthToken, claudeProfileLocations, } from "./claude-profile.js";
export function collapseHome(path) {
    const home = homedir();
    if (path === home)
        return "~";
    if (!isAbsolute(path) && !startsWithHomePrefix(path, home))
        return path;
    const relativePath = relative(home, path);
    if (relativePath === "")
        return "~";
    if (isHomeRelativePath(relativePath))
        return `~/${normalizeRelativePath(relativePath)}`;
    if (startsWithHomePrefix(path, home))
        return `~/${path.slice(home.length + 1).replace(/\\/g, "/")}`;
    return path;
}
function isHomeRelativePath(path) {
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function normalizeRelativePath(path) {
    return sep === "\\" ? path.replace(/\\/g, "/") : path;
}
function startsWithHomePrefix(path, home) {
    const separator = path[home.length];
    return (separator !== undefined &&
        (separator === "/" || separator === "\\") &&
        samePath(path.slice(0, home.length), home));
}
function samePath(left, right) {
    if (runtimeProcess.platform === "win32")
        return left.toLowerCase() === right.toLowerCase();
    return left === right;
}
export function cacheFilePath() {
    return join(cacheDirPath(), "quotas.json");
}
/**
 * An opaque, deterministic cache-provenance identifier for the Claude profile
 * selected by the current process, or for `profile` when one is given. The
 * selected path never leaves this helper.
 */
export function claudeCredentialContextId(profile = claudeProfileLocations()) {
    return claudeProfileContextId(profile, claudeEnvOauthToken() !== undefined);
}
/**
 * The identity a profile's own stored credential (file or Keychain item) is
 * cached under, whether or not `CLAUDE_CODE_OAUTH_TOKEN` happens to be set on
 * this invocation. A lane that never consults that token, and a stored
 * credential's own rejection, belong to this identity rather than the
 * env-marked one {@link claudeCredentialContextId} returns.
 */
export function claudeStoredProfileContextId(profile = claudeProfileLocations()) {
    return claudeProfileContextId(profile, false);
}
function claudeProfileContextId(profile, envSelected) {
    const { configDir, keychainService } = profile;
    // Include the exact service: it already encodes the secure-storage selector,
    // including a relative raw path hash.
    // Version the identity to withhold snapshots an earlier release wrote for
    // this same selection: `v2` covers former opaque discovery, `v3` the windows
    // 0.1.50 stored with `utilization`/`percent` read as remaining.
    //
    // An explicit environment token selects an account the profile path and
    // Keychain service do not describe, so it earns its own identity: a snapshot
    // taken with one must never be served as stale once it is gone. The marker is
    // appended only when such a token is supplied, so every existing profile
    // keeps the identity it already cached under. It is a presence marker, never
    // any part of the token.
    return createHash("sha256")
        .update(JSON.stringify([
        "claude-profile-v3",
        resolve(configDir),
        keychainService,
        ...(envSelected ? ["env-token"] : []),
    ]))
        .digest("hex");
}
// The grant is per Keychain item, so the marker is keyed by the service the
// value read will name, which already encodes any explicit profile directory.
export function claudeKeychainAccessMarkerPath(account, service) {
    const serviceSuffix = createHash("sha256")
        .update(service)
        .digest("hex")
        .slice(0, 8);
    const accountSuffix = createHash("sha256")
        .update(account)
        .digest("hex")
        .slice(0, 16);
    return join(cacheDirPath(), `claude-keychain-access-granted-${serviceSuffix}-account-${accountSuffix}`);
}
export function cursorCliKeychainAccessMarkerPath(account) {
    const accountSuffix = createHash("sha256")
        .update(account)
        .digest("hex")
        .slice(0, 16);
    return join(cacheDirPath(), `cursor-cli-keychain-access-granted-account-${accountSuffix}`);
}
/** Non-secret proof scoped to the exact Copilot config path, service, and account. */
export function copilotCliKeychainAccessMarkerPath(path, service, account) {
    const suffix = createHash("sha256")
        .update(JSON.stringify([resolve(path), service, account]))
        .digest("hex");
    return join(cacheDirPath(), `copilot-cli-keychain-access-granted-${suffix}`);
}
/** Non-secret proof scoped to the exact Muse Keychain service and account. */
export function museKeychainAccessMarkerPath(service, account) {
    const suffix = createHash("sha256")
        .update(JSON.stringify([service, account]))
        .digest("hex");
    return join(cacheDirPath(), `muse-keychain-access-granted-${suffix}`);
}
/** Path of Muse's key-endpoint attempt ledger, beside the quota cache. */
export function museKeyReadLedgerPath() {
    return join(cacheDirPath(), "muse-key-reads.json");
}
function cacheDirPath() {
    const base = runtimeProcess.env.XDG_CACHE_HOME || join(homedir(), ".cache");
    return join(base, "quota-axi");
}
export function ensurePrivateParent(file) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
}
export function readJsonFile(file) {
    const result = readJsonFileResult(file);
    return result.status === "success" ? result.value : undefined;
}
export function readJsonFileResult(file) {
    traceInput(file);
    return readUntracedJsonFileResult(file);
}
/**
 * The same read without recording it as an input of the current reading, for
 * quota-axi's own state such as the cache, which every write changes.
 */
export function readUntracedJsonFile(file) {
    const result = readUntracedJsonFileResult(file);
    return result.status === "success" ? result.value : undefined;
}
function readUntracedJsonFileResult(file) {
    let text;
    try {
        text = readFileSync(file, "utf8");
    }
    catch (error) {
        if (errorCode(error) === "ENOENT")
            return { status: "missing" };
        return { status: "invalid", error: "file_read_error" };
    }
    try {
        return { status: "success", value: JSON.parse(text) };
    }
    catch {
        return { status: "invalid", error: "json_parse_error" };
    }
}
/**
 * Read at most `maxBytes + 1` bytes, so a caller can tell an oversized file from
 * one that fits without ever holding more than its own limit in memory.
 */
export async function readBoundedFile(path, maxBytes) {
    traceInput(path);
    const file = await open(path, "r");
    try {
        const contents = new Uint8Array(maxBytes + 1);
        let offset = 0;
        while (offset < contents.byteLength) {
            const { bytesRead } = await file.read(contents, offset, contents.byteLength - offset, null);
            if (bytesRead === 0)
                break;
            offset += bytesRead;
        }
        return Buffer.from(contents.buffer, contents.byteOffset, offset);
    }
    finally {
        await file.close();
    }
}
function errorCode(error) {
    return error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
        ? error.code
        : undefined;
}
