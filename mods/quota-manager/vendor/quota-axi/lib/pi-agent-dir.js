// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { homedir, join, runtimeProcess } from "../runtime.js";
export function resolvePiAgentDirectory(environment = runtimeProcess.env, homeDirectory = homedir, platform = runtimeProcess.platform) {
    const home = () => nonempty(environment.HOME) ?? homeDirectory();
    const configured = nonempty(environment.PI_CODING_AGENT_DIR);
    if (configured === undefined) {
        return join(home(), ".pi", "agent");
    }
    if (configured === "~")
        return home();
    if (configured.startsWith("~/") ||
        (platform === "win32" && configured.startsWith("~\\"))) {
        return join(home(), configured.slice(2));
    }
    return configured;
}
export function resolvePiAuthFilePath(environment = runtimeProcess.env, homeDirectory = homedir, platform = runtimeProcess.platform) {
    return join(resolvePiAgentDirectory(environment, homeDirectory, platform), "auth.json");
}
function nonempty(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
