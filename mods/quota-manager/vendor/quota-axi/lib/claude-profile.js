// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { homedir, delimiter, isAbsolute, join, runtimeProcess } from "../runtime.js";
import { createHash } from "crypto";


import { usableLiteralSecret } from "./secret.js";
export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
/**
 * The environment credential Claude Code itself resolves before it consults any
 * stored credential, so an explicit token here names the account a session is
 * actually using.
 */
export const CLAUDE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
/**
 * The explicitly supplied environment access token, when one is usable as a
 * literal bearer. Absent, empty, and unusable values all resolve to
 * `undefined`, which leaves discovery of the stored credential untouched. The
 * value is returned for request use only and is never logged or persisted.
 *
 * @returns the literal token, or undefined when none is supplied
 */
export function claudeEnvOauthToken() {
    return usableLiteralSecret(runtimeProcess.env[CLAUDE_OAUTH_TOKEN_ENV]?.trim());
}
/**
 * Mirrors Claude Code's configuration and secure-storage selectors. The
 * credential directory is `CLAUDE_CONFIG_DIR` or `~/.claude`; a nonempty
 * secure-storage selector names the Keychain service instead.
 */
export function claudeProfileLocations(env = runtimeProcess.env) {
    const configured = env.CLAUDE_CONFIG_DIR;
    const storage = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    const defaultDir = join(homedir(), ".claude").normalize("NFC");
    const configDir = (configured ?? defaultDir).normalize("NFC");
    // Hash the raw NFC path, just as the vendor does: resolving a relative path
    // or expanding ~ would select another item.
    const storageSelector = storage ? storage.normalize("NFC") : undefined;
    const selector = storageSelector ?? (configured ? configDir : undefined);
    return {
        configDir,
        secureStorageSelected: storageSelector !== undefined,
        keychainService: selector
            ? suffixedKeychainService(selector)
            : CLAUDE_KEYCHAIN_SERVICE,
        // A default selection cannot re-derive the suffix Claude Code gave its own
        // item, so a suffixed item may still be this profile's. An explicit
        // selector names one exact item and must never fall through to another.
        acceptsOpaqueDefaultItem: selector === undefined,
    };
}
/**
 * The opt-in list of additional Claude profiles to report as their own lanes.
 * Each entry is a config directory exactly as the user would set
 * `CLAUDE_CONFIG_DIR`, separated by the platform path delimiter.
 */
export const CLAUDE_PROFILES_ENV = "QUOTA_AXI_CLAUDE_PROFILES";
/**
 * The directories `QUOTA_AXI_CLAUDE_PROFILES` lists, in order, or `undefined`
 * when the variable is unset, blank, or lists no entry: then Claude reports
 * only the process-selected profile, exactly as it does without the variable.
 *
 * Entries are kept raw, never trimmed, `~`-expanded, or resolved, because
 * Claude Code hashes the raw NFC path to name the Keychain item. Empty entries
 * are ignored. A relative entry is returned in `invalid` so the command can
 * fail loudly instead of reading a directory the user did not mean.
 */
export function claudeListedProfiles(env = runtimeProcess.env) {
    const value = env[CLAUDE_PROFILES_ENV];
    if (value === undefined || value.trim() === "")
        return undefined;
    const dirs = [];
    const invalid = [];
    for (const entry of value.split(delimiter)) {
        if (entry === "")
            continue;
        (isAbsolute(entry) ? dirs : invalid).push(entry);
    }
    // Delimiters alone name nothing to opt in to.
    return dirs.length || invalid.length ? { dirs, invalid } : undefined;
}
/** The `Claude Code-credentials-<8 lowercase hex>` shape the vendor writes. */
export function isOpaqueSuffixedKeychainService(service) {
    return (service.startsWith(`${CLAUDE_KEYCHAIN_SERVICE}-`) &&
        /^[0-9a-f]{8}$/.test(service.slice(CLAUDE_KEYCHAIN_SERVICE.length + 1)));
}
function suffixedKeychainService(selector) {
    const suffix = createHash("sha256")
        .update(selector)
        .digest("hex")
        .slice(0, 8);
    return `${CLAUDE_KEYCHAIN_SERVICE}-${suffix}`;
}
