// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { homedir, join, runtimeProcess } from "../runtime.js";
import { readBoundedFile } from "../lib/fs.js";
import { classifyPiAuthEntry } from "../lib/pi-auth-store.js";
import { usableLiteralSecret } from "../lib/secret.js";
const PI_PROVIDER_ID = "commandcode";
const AUTH_FILE_LIMIT_BYTES = 64 * 1024;
export const PI_COMMANDCODE_CREDENTIAL_SOURCE = "pi:commandcode";
export function createPiCommandCodeCredentialBroker(overrides = {}) {
    const dependencies = {
        environment: runtimeProcess.env,
        homeDirectory: homedir,
        readFile: readBoundedFile,
        ...overrides,
    };
    return {
        resolve: () => resolveCredential(dependencies),
        inspect: async () => {
            const path = authFilePath(dependencies);
            const resolution = await resolveCredential(dependencies);
            if (resolution.status === "resolved") {
                return { status: "available", path };
            }
            if (resolution.status === "absent") {
                return { status: "missing", path };
            }
            if (resolution.status === "read_error") {
                return { status: "error", path, error: resolution.error };
            }
            if (resolution.status === "unsupported") {
                return {
                    status: "invalid",
                    path,
                    error: "unsupported_credential_type",
                };
            }
            return { status: "invalid", path, error: resolution.error };
        },
    };
}
async function resolveCredential(dependencies) {
    const path = authFilePath(dependencies);
    let contents;
    try {
        contents = await dependencies.readFile(path, AUTH_FILE_LIMIT_BYTES);
    }
    catch (error) {
        return errorCode(error) === "ENOENT"
            ? { status: "absent" }
            : { status: "read_error", error: "credential_resolution_failed" };
    }
    if (contents.byteLength > AUTH_FILE_LIMIT_BYTES) {
        return {
            status: "structurally_invalid",
            error: "commandcode_credential_invalid",
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(contents.toString("utf8"));
    }
    catch {
        return {
            status: "structurally_invalid",
            error: "commandcode_credential_invalid",
        };
    }
    const classified = classifyPiAuthEntry(parsed, PI_PROVIDER_ID);
    if (classified.status === "missing")
        return { status: "absent" };
    if (classified.status === "invalid") {
        return {
            status: "structurally_invalid",
            error: "commandcode_credential_invalid",
        };
    }
    return credentialFromPiEntry(classified.entry);
}
/**
 * Command Code's Pi OAuth wrapper stores a non-expiring API key. Expiry
 * metadata is ignored and the duplicate refresh field is never read.
 */
export function credentialFromPiEntry(entry) {
    const type = stringValue(entry.type)?.toLowerCase();
    if (type === "api_key") {
        const apiKey = usableLiteralSecret(entry.key);
        return apiKey !== undefined
            ? { status: "resolved", credential: apiKey }
            : {
                status: "structurally_invalid",
                error: "commandcode_credential_invalid",
            };
    }
    if (type === "oauth") {
        const access = usableLiteralSecret(entry.access);
        return access !== undefined
            ? { status: "resolved", credential: access }
            : {
                status: "structurally_invalid",
                error: "commandcode_credential_invalid",
            };
    }
    if (type === undefined) {
        return {
            status: "structurally_invalid",
            error: "commandcode_credential_invalid",
        };
    }
    return { status: "unsupported" };
}
function authFilePath(dependencies) {
    return join(piAgentDirectory(dependencies), "auth.json");
}
function piAgentDirectory(dependencies) {
    const home = () => nonempty(dependencies.environment.HOME) ?? dependencies.homeDirectory();
    const configured = nonempty(dependencies.environment.PI_CODING_AGENT_DIR);
    if (configured === undefined) {
        return join(home(), ".pi", "agent");
    }
    if (configured === "~")
        return home();
    if (configured.startsWith("~/") ||
        (runtimeProcess.platform === "win32" && configured.startsWith("~\\"))) {
        return join(home(), configured.slice(2));
    }
    return configured;
}
function nonempty(value) {
    return value && value.length > 0 ? value : undefined;
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function errorCode(error) {
    return error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
        ? error.code
        : undefined;
}
