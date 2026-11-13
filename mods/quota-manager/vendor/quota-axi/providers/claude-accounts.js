// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { realpathSync, statSync, join, resolve, runtimeProcess } from "../runtime.js";
import { createHash } from "crypto";


import { claudeProfileLocations } from "../lib/claude-profile.js";
import { claudeStoredProfileContextId } from "../lib/fs.js";
import { traceInput } from "../lib/input-trace.js";
/**
 * The Claude profiles an opted-in read reports, in order: the profile this
 * process selects (the lane every read reports today), then the default
 * profile, then each directory `QUOTA_AXI_CLAUDE_PROFILES` lists. Profiles
 * that name the same credential store are reported once, at their first
 * position. No directory is searched for: only these candidates are read.
 *
 * The selected profile and every listed directory always get a lane, because
 * the user named them; one without a credential reports that as its own
 * reading. The default profile was not named, so it joins only on positive
 * evidence that it holds a credential: its native credential file, or (on
 * macOS) its exact Keychain item, checked from metadata without reading a
 * value. `hasKeychainItem` receives the Keychain services the other lanes own
 * so a sibling's item is never taken for the default's.
 */
export async function discoverClaudeProfiles(listed, hasKeychainItem) {
    const candidates = [
        { profile: claudeProfileLocations(), selected: true, implicit: false },
        { profile: claudeProfileLocations({}), selected: false, implicit: true },
        ...listed.map((dir) => ({
            profile: claudeProfileLocations({ CLAUDE_CONFIG_DIR: dir }),
            selected: false,
            implicit: false,
        })),
    ];
    // A store keeps its first position, but naming it anywhere makes it explicit
    const byStore = new Map();
    for (const candidate of candidates) {
        const identity = profileStoreIdentity(candidate.profile);
        const first = byStore.get(identity);
        if (!first)
            byStore.set(identity, { ...candidate });
        else
            first.implicit &&= candidate.implicit;
    }
    const unique = [...byStore.values()];
    const lanes = [];
    for (const candidate of unique) {
        if (candidate.implicit) {
            const siblingServices = new Set(unique
                .filter((other) => other !== candidate)
                .map((other) => other.profile.keychainService)
                .filter((service) => service !== candidate.profile.keychainService));
            if (!(await holdsCredential(candidate.profile, siblingServices)))
                continue;
        }
        lanes.push({ profile: candidate.profile, selected: candidate.selected });
    }
    return lanes;
    async function holdsCredential(profile, siblingServices) {
        const darwin = runtimeProcess.platform === "darwin";
        if (!(profile.secureStorageSelected && darwin) &&
            credentialFilePresent(join(profile.configDir, ".credentials.json")))
            return true;
        return darwin && (await hasKeychainItem(profile, siblingServices));
    }
}
/**
 * Which credential store a profile reads. On macOS the Keychain service and
 * config directory together; elsewhere the real config directory, so two
 * spellings of one directory are one lane.
 */
function profileStoreIdentity(profile) {
    return runtimeProcess.platform === "darwin"
        ? claudeStoredProfileContextId(profile)
        : fileIdentity(profile.configDir);
}
/** A present-but-unreadable file still counts: its own read reports it. */
function credentialFilePresent(path) {
    traceInput(path);
    try {
        statSync(path);
        return true;
    }
    catch (error) {
        const code = error.code;
        return code !== "ENOENT" && code !== "ENOTDIR";
    }
}
function fileIdentity(configDir) {
    try {
        return realpathSync(configDir);
    }
    catch {
        return resolve(configDir);
    }
}
/**
 * The lane's published key names the profile itself, so it never moves when
 * an ambient `CLAUDE_CODE_OAUTH_TOKEN` is exported or unexported. On macOS it
 * derives from the stored-profile context (config directory plus Keychain
 * service); elsewhere from the real config directory. It is a one-way digest:
 * no path, token, or email can be read back from it.
 */
export function claudeAccountKey(profile) {
    const identity = runtimeProcess.platform === "darwin"
        ? claudeStoredProfileContextId(profile)
        : createHash("sha256")
            .update(JSON.stringify(["claude-file-v1", fileIdentity(profile.configDir)]))
            .digest("hex");
    return `profile:${identity.slice(0, 24)}`;
}
