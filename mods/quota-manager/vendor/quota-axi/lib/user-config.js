// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { realpathSync, homedir, isAbsolute, join, resolve, runtimeProcess } from "../runtime.js";
import { readJsonFile } from "./fs.js";
/**
 * The user-level quota-axi configuration file:
 * `$XDG_CONFIG_HOME/quota-axi/config.json`, or `~/.config/quota-axi/config.json`
 * when `XDG_CONFIG_HOME` is unset. It holds human preferences only, so nothing
 * an agent reads from quota-axi ever depends on it.
 */
export function userConfigFilePath(environment = runtimeProcess.env) {
    const base = environment.XDG_CONFIG_HOME || join(homedir(), ".config");
    return join(base, "quota-axi", "config.json");
}
/**
 * The `--tui` direction preference, `tui.show` in the user config file. Only
 * the exact values `used` and `remaining` are recognized; an absent,
 * unreadable, or malformed file, and any other value, keep the default
 * remaining view.
 */
export function readTuiShowPreference(file = userConfigFilePath()) {
    const config = readJsonFile(file);
    const tui = isRecord(config) ? config.tui : undefined;
    const show = isRecord(tui) ? tui.show : undefined;
    return show === "used" ? "used" : "remaining";
}
/**
 * The `--tui` lane names, `tui.accountLabels` in the user config file: an
 * object from a lane's locator path (absolute, or `~/`-relative) or its
 * account key to the name its card shows. Paths are compared after `~`
 * expansion and symlink resolution, so a trailing slash or a linked directory
 * names the same lane; any other entry is matched exactly against the lane's
 * account key, so a relative path names nothing. An absent, unreadable, or
 * malformed file or setting names nothing; a non-string or blank label skips
 * only that entry.
 */
export function readTuiAccountLabels(file = userConfigFilePath()) {
    const config = readJsonFile(file);
    const tui = isRecord(config) ? config.tui : undefined;
    const entries = isRecord(tui) ? tui.accountLabels : undefined;
    const paths = new Map();
    const accountKeys = new Map();
    if (isRecord(entries)) {
        for (const [entry, label] of Object.entries(entries)) {
            if (typeof label !== "string" || !label.trim())
                continue;
            const expanded = expandHome(entry);
            if (isAbsolute(expanded))
                paths.set(canonicalPath(expanded), label.trim());
            else
                accountKeys.set(entry, label.trim());
        }
    }
    return ({ accountKey, accountLocator }) => (accountKey && accountKeys.get(accountKey)) ||
        (accountLocator && paths.size > 0
            ? paths.get(canonicalPath(accountLocator.path))
            : undefined);
}
function expandHome(path) {
    return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
function canonicalPath(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return resolve(path);
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
