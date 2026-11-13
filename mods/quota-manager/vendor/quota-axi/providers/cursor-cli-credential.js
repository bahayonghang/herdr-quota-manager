// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { chmodSync, existsSync, renameSync, writeFileSync, homedir, join, runtimeProcess } from "../runtime.js";
import { cursorCliKeychainAccessMarkerPath, ensurePrivateParent, readJsonFileResult, } from "../lib/fs.js";
import { execFileText } from "../lib/process.js";
import { traceInput } from "../lib/input-trace.js";
/**
 * The Cursor CLI (`cursor-agent`) keeps sign-in identity in a plain
 * `cli-config.json` and the tokens themselves in the macOS login Keychain, or
 * in `auth.json` on Linux, unlike the Cursor editor which keeps both in its
 * `state.vscdb`. This module reads only the access token. The macOS Keychain
 * path uses the same `--allow-keychain-prompt` gate as the Claude keychain
 * source; the Linux auth file is read directly without any refresh behavior.
 *
 * Access-token refresh is intentionally not implemented: neither the Linux
 * `refreshToken` field nor the macOS `cursor-refresh-token` item is read,
 * because no safe vendor-owned non-interactive refresh command has been
 * established for Cursor. A rejected access token can therefore use an
 * eligible stale snapshot or report that authentication is required; recovery
 * is running `cursor-agent login` again.
 */
export const CURSOR_CLI_SOURCE = "cli-keychain";
export const CURSOR_CLI_AUTHFILE_SOURCE = "cli-authfile";
export const CURSOR_CLI_KEYCHAIN_SERVICE = "cursor-access-token";
export const CURSOR_CLI_KEYCHAIN_ACCOUNT = "cursor-user";
const KEYCHAIN_PROMPT_TIMEOUT_MS = 60_000;
const KEYCHAIN_PRESENCE_TIMEOUT_MS = 5_000;
const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;
/** The Cursor CLI token store is the macOS Keychain or Linux auth file. */
export function isCursorCliSourceSupported() {
    return runtimeProcess.platform === "darwin" || runtimeProcess.platform === "linux";
}
export function cursorCliConfigPath() {
    if (runtimeProcess.env.CURSOR_CLI_CONFIG)
        return runtimeProcess.env.CURSOR_CLI_CONFIG;
    return join(homedir(), ".cursor", "cli-config.json");
}
export function cursorCliAuthFilePath() {
    if (runtimeProcess.env.CURSOR_CLI_CONFIG)
        return runtimeProcess.env.CURSOR_CLI_CONFIG;
    return join(runtimeProcess.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cursor", "auth.json");
}
export async function readCursorCliCredentialState(options, presenceOnly = false) {
    if (runtimeProcess.platform === "linux") {
        return readLinuxAuthFileCredentialState(cursorCliAuthFilePath());
    }
    const path = cursorCliConfigPath();
    if (!isCursorCliSourceSupported())
        return missingState(path, CURSOR_CLI_SOURCE);
    const identityResult = readCursorCliIdentity(path);
    if (identityResult.status === "missing")
        return missingState(path);
    if (identityResult.status === "invalid") {
        return {
            status: "invalid",
            source: {
                source: CURSOR_CLI_SOURCE,
                path,
                status: "invalid",
                error: identityResult.error,
                credentialPresent: true,
            },
        };
    }
    const { identity } = identityResult;
    if (presenceOnly ||
        !(options.allowKeychainPrompt || hasKeychainAccessMarker(identity))) {
        return skippedKeychainState(path, await readKeychainItemPresence());
    }
    return readKeychainAccessToken(path, identity);
}
function readLinuxAuthFileCredentialState(path) {
    const raw = readJsonFileResult(path);
    if (raw.status === "missing")
        return missingState(path, CURSOR_CLI_AUTHFILE_SOURCE);
    if (raw.status === "invalid") {
        return {
            status: "invalid",
            source: {
                source: CURSOR_CLI_AUTHFILE_SOURCE,
                path,
                status: "invalid",
                error: raw.error,
                credentialPresent: true,
            },
        };
    }
    const accessToken = trimmedStringValue(objectValue(raw.value)?.accessToken);
    if (!accessToken)
        return missingState(path, CURSOR_CLI_AUTHFILE_SOURCE);
    return {
        status: "available",
        accessToken,
        identity: {},
        source: {
            source: CURSOR_CLI_AUTHFILE_SOURCE,
            path,
            status: "available",
            credentialPresent: true,
        },
    };
}
/** Identity only: `cli-config.json` never holds a token. */
export function readCursorCliIdentity(path) {
    const raw = readJsonFileResult(path);
    if (raw.status === "missing")
        return { status: "missing" };
    if (raw.status === "invalid")
        return { status: "invalid", error: raw.error };
    const authInfo = objectValue(objectValue(raw.value)?.authInfo);
    if (!authInfo)
        return { status: "missing" };
    const identity = {
        email: stringValue(authInfo.email),
        userId: stringValue(authInfo.userId) ?? stringValue(authInfo.authId),
    };
    if (!identity.email && !identity.userId)
        return { status: "missing" };
    return { status: "present", identity };
}
async function readKeychainAccessToken(path, identity) {
    let secret;
    try {
        secret = await execFileText("security", [
            "find-generic-password",
            "-a",
            CURSOR_CLI_KEYCHAIN_ACCOUNT,
            "-w",
            "-s",
            CURSOR_CLI_KEYCHAIN_SERVICE,
        ], KEYCHAIN_PROMPT_TIMEOUT_MS);
    }
    catch (error) {
        return keychainFailureState(path, error);
    }
    writeKeychainAccessMarkerBestEffort(identity);
    const accessToken = secret.trim();
    if (accessToken.length === 0) {
        return {
            status: "invalid",
            source: {
                source: CURSOR_CLI_SOURCE,
                path,
                status: "invalid",
                error: "empty_credential",
                credentialPresent: true,
            },
        };
    }
    return {
        status: "available",
        accessToken,
        identity,
        source: {
            source: CURSOR_CLI_SOURCE,
            path,
            status: "available",
            credentialPresent: true,
        },
    };
}
/** Presence check only: no `-w`, so it never prompts and never reads a value. */
async function readKeychainItemPresence() {
    try {
        await execFileText("security", [
            "find-generic-password",
            "-a",
            CURSOR_CLI_KEYCHAIN_ACCOUNT,
            "-s",
            CURSOR_CLI_KEYCHAIN_SERVICE,
        ], KEYCHAIN_PRESENCE_TIMEOUT_MS);
        return "present";
    }
    catch (error) {
        return isKeychainItemNotFound(error) ? "missing" : "unknown";
    }
}
function skippedKeychainState(path, presence) {
    if (presence === "missing")
        return missingState(path);
    return {
        status: "skipped",
        source: {
            source: CURSOR_CLI_SOURCE,
            path,
            status: "skipped",
            error: presence === "present"
                ? "keychain_prompt_required"
                : "keychain_presence_check_failed",
            credentialPresent: true,
        },
    };
}
function keychainFailureState(path, error) {
    const failure = error;
    if (failure.killed || failure.signal) {
        return {
            status: "skipped",
            source: {
                source: CURSOR_CLI_SOURCE,
                path,
                status: "skipped",
                error: "keychain_prompt_timeout",
                credentialPresent: true,
            },
        };
    }
    if (isKeychainItemNotFound(error))
        return missingState(path);
    return {
        status: "skipped",
        source: {
            source: CURSOR_CLI_SOURCE,
            path,
            status: "skipped",
            error: "keychain_access_denied",
            credentialPresent: true,
        },
    };
}
function missingState(path, source = CURSOR_CLI_SOURCE) {
    return {
        status: "missing",
        source: { source, path, status: "missing" },
    };
}
function hasKeychainAccessMarker(identity) {
    const marker = cursorCliKeychainAccessMarkerPath(markerKey(identity));
    traceInput(marker);
    return existsSync(marker);
}
function writeKeychainAccessMarkerBestEffort(identity) {
    try {
        const file = cursorCliKeychainAccessMarkerPath(markerKey(identity));
        if (existsSync(file))
            return;
        ensurePrivateParent(file);
        const temp = `${file}.${runtimeProcess.pid}.tmp`;
        writeFileSync(temp, "granted\n", { mode: 0o600 });
        chmodSync(temp, 0o600);
        renameSync(temp, file);
        chmodSync(file, 0o600);
    }
    catch {
        return;
    }
}
/** Scopes the grant to the signed-in CLI account, never storing its raw value. */
function markerKey(identity) {
    return identity.userId ?? identity.email ?? CURSOR_CLI_KEYCHAIN_ACCOUNT;
}
function isKeychainItemNotFound(error) {
    return (error.code ===
        KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE);
}
function objectValue(value) {
    return value && typeof value === "object"
        ? value
        : undefined;
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function trimmedStringValue(value) {
    const trimmed = stringValue(value)?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
