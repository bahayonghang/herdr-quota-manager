// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { httpStub as http, httpsStub as https, mkdtemp, rm, symlink, writeFile, tmpdir, delimiter, join, runtimeProcess, runtimeSetTimeout, runtimeClearTimeout } from "../runtime.js";
import { readLocalAgyQuota } from "../lib/local-sources.js";





import { deleteCachedProvider, readCachedProvider, retireCachedSlot, } from "../cache.js";
import { currentUserProcessListArgs, execFileText, } from "../lib/process.js";
import { clampPercent, nowIso, parseEpochOrIso, percentRemaining, } from "../lib/time.js";
import { failedProvider, sourceNames, staleFromCache, statusFromError, successProvider, } from "./common.js";
const QUOTA_SUMMARY_PATH = "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary";
const USER_STATUS_PATH = "/exa.language_server_pb.LanguageServerService/GetUserStatus";
const COMMAND_MODEL_CONFIGS_PATH = "/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs";
const UNLEASH_PATH = "/exa.language_server_pb.LanguageServerService/GetUnleashData";
const PROCESS_TIMEOUT_MS = 5_000;
const PORT_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 3_000;
const CLI_QUOTA_TIMEOUT_MS = 15_000;
const PROBE_BUDGET_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FIVE_HOURS_SECONDS = 18_000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
/**
 * The only two outcomes that show Antigravity genuinely absent: no `agy` on
 * PATH, and the process list was checked and contains no Antigravity runtimeProcess.
 * A process-list check that is unavailable still counts as absence for the
 * provider's established not-set-up presentation, but is never sufficient to
 * retire a cached reading. Every other skip - an installed CLI that timed out
 * or a discovered process whose endpoint is not accessible - leaves presence
 * unknown, so the human report keeps Antigravity in view.
 */
export const AGY_CLI_NOT_INSTALLED = "agy CLI is not installed";
export const AGY_NOT_RUNNING = "Antigravity/agy is not running";
export const AGY_PROCESS_DISCOVERY_UNAVAILABLE = "Antigravity process discovery unavailable";
/** Process list was checked but no usable endpoint was found; process may be running without an accessible port. */
export const AGY_NO_ENDPOINT = "Antigravity/agy has no accessible endpoint";
export const agyAdapter = {
    id: "agy",
    label: "Antigravity",
    isUncertainSkip: (attempt) => attempt.error !== AGY_CLI_NOT_INSTALLED &&
        attempt.error !== AGY_NOT_RUNNING &&
        attempt.error !== AGY_PROCESS_DISCOVERY_UNAVAILABLE,
    fetchQuota,
    inspectAuth,
};
export async function fetchQuota(_options) {
    try {
        const quota = await readLocalAgyQuota(normalizeAgyQuotaSummary);
        return successProvider({ provider: "agy", label: "Antigravity", source: "cli-rpc",
            windows: quota.windows, refreshedAt: quota.refreshedAt, sourcesTried: ["loopback"] });
    } catch (error) {
        const message = error?.message === "agy_discovery_limit"
            ? "Antigravity daemon discovery limit" : "Antigravity local daemon unavailable";
        return failedProvider({ provider: "agy", label: "Antigravity", status: "unavailable",
            error: message, sourcesTried: ["loopback"],
            attempts: [{ source: "loopback", status: "failed", error: message, degraded: false }] });
    }
}
export async function fetchQuotaWithRuntime(runtime) {
    const attempts = [{ source: "cli", status: "failed" }];
    let finalFailure;
    try {
        const quota = await fetchCliQuota(runtime);
        attempts[0] = { source: "cli", status: "success" };
        const provider = successProvider({
            provider: "agy",
            label: "Antigravity",
            source: "cli",
            plan: quota.plan,
            account: quota.account,
            windows: quota.windows,
            refreshedAt: quota.refreshedAt,
            sourcesTried: sourceNames(attempts),
            attempts,
        });
        return provider;
    }
    catch (error) {
        finalFailure = error;
        const skipped = error instanceof AgyUnavailableError || isMissingCommandError(error);
        attempts[0] = {
            source: "cli",
            status: skipped ? "skipped" : "failed",
            error: errorMessage(error),
            degraded: false,
        };
    }
    attempts.push({ source: "loopback", status: "failed", degraded: false });
    try {
        const quota = await fetchLoopbackQuota(runtime);
        attempts[attempts.length - 1] = { source: "loopback", status: "success" };
        const provider = successProvider({
            provider: "agy",
            label: "Antigravity",
            source: "cli-rpc",
            plan: quota.plan,
            account: quota.account,
            windows: quota.windows,
            refreshedAt: quota.refreshedAt,
            sourcesTried: sourceNames(attempts),
            attempts,
        });
        return provider;
    }
    catch (error) {
        const skipped = error instanceof AgyUnavailableError || isMissingCommandError(error);
        if (attempts[0].status === "skipped") {
            finalFailure = error;
        }
        else {
            finalFailure = strongerFailure(finalFailure, error);
        }
        attempts[attempts.length - 1] = {
            source: "loopback",
            status: skipped ? "skipped" : "failed",
            error: errorMessage(error),
            degraded: false,
        };
    }
    const finalError = errorMessage(finalFailure);
    if (isDefinitelyUninstalled(attempts)) {
        try {
            retireCachedSlot("agy");
        }
        catch {
            // Uninstall evidence stands when the cache cannot be rewritten.
        }
    }
    else if (staleEligibleFailure(finalFailure)) {
        const cached = readCachedProvider("agy");
        const stale = cached
            ? staleFromCache(cached, finalError, sourceNames(attempts), attempts)
            : undefined;
        if (stale)
            return stale;
    }
    else if (isDefinitiveAuthFailure(finalFailure)) {
        try {
            deleteCachedProvider("agy");
        }
        catch {
            // Cache retirement is best effort; preserve the definitive auth result.
        }
    }
    return failedProvider({
        provider: "agy",
        label: "Antigravity",
        status: statusForFailure(finalFailure),
        error: finalError,
        sourcesTried: sourceNames(attempts),
        attempts,
    });
}
export async function inspectAuth(_options) {
    return inspectAuthWithRuntime(defaultRuntime);
}
export async function inspectAuthWithRuntime(runtime) {
    try {
        const { endpoints } = await discoverAgyEndpoints(runtime, createProbeDeadline());
        return {
            provider: "agy",
            sources: [
                {
                    source: "loopback",
                    status: endpoints.length > 0 ? "available" : "missing",
                },
            ],
        };
    }
    catch (error) {
        return {
            provider: "agy",
            sources: [
                {
                    source: "loopback",
                    status: "error",
                    error: errorMessage(error),
                },
            ],
        };
    }
}
async function fetchCliQuota(runtime) {
    let commandPath;
    try {
        commandPath = await runtime.findCommandPath("agy");
    }
    catch {
        throw new AgyUnavailableError("Antigravity CLI discovery failed");
    }
    if (!commandPath) {
        throw new AgyUnavailableError(AGY_CLI_NOT_INSTALLED);
    }
    let text;
    let openerGuard;
    try {
        openerGuard = await createOpenerGuard();
        text = await runtime.execFileText(commandPath, ["-p", "/quota", "--output-format", "json"], CLI_QUOTA_TIMEOUT_MS, { env: openerGuard.env });
    }
    catch (error) {
        throw sanitizeCliError(error);
    }
    finally {
        await openerGuard?.dispose();
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new AgyMalformedResponseError("agy /quota returned invalid JSON");
    }
    const summary = normalizeAgyPrintUsage(parsed);
    if (!summary || summary.windows.length === 0) {
        throw new AgyMalformedResponseError("agy /quota quota summary malformed");
    }
    return summary;
}
async function createOpenerGuard() {
    const directory = await mkdtemp(join(tmpdir(), "quota-axi-agy-"));
    try {
        if (runtimeProcess.platform === "win32") {
            await Promise.all(["xdg-open.cmd", "open.cmd"].map((name) => writeFile(join(directory, name), "@exit /b 1\r\n")));
        }
        else {
            await Promise.all([
                ...["xdg-open", "open"].map((name) => writeFile(join(directory, name), "#!/bin/sh\nexit 1\n", {
                    mode: 0o700,
                })),
                symlink(runtimeProcess.execPath, join(directory, "node")),
            ]);
        }
        const inheritedPath = runtimeProcess.env.PATH;
        return {
            env: {
                ...process.env,
                ...(runtimeProcess.platform === "win32"
                    ? { NoDefaultCurrentDirectoryInExePath: "1" }
                    : {}),
                PATH: inheritedPath
                    ? `${directory}${delimiter}${inheritedPath}`
                    : directory,
            },
            async dispose() {
                await rm(directory, { recursive: true, force: true }).catch(() => undefined);
            },
        };
    }
    catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
}
function isMissingCommandError(error) {
    const code = error?.code;
    return code === "ENOENT";
}
export function normalizeAgyQuotaSummary(raw) {
    const payload = quotaSummaryPayload(raw);
    const groups = arrayValue(payload?.groups);
    const windows = groups
        .flatMap(normalizeQuotaSummaryGroup)
        .sort(compareAgyWindows);
    if (windows.length === 0)
        return undefined;
    return { windows, refreshedAt: nowIso() };
}
export function normalizeAgyPrintUsage(raw) {
    const root = objectValue(raw);
    const command = objectValue(root?.command);
    const name = stringValue(command?.name);
    if (name !== "usage" &&
        name !== "/usage" &&
        name !== "quota" &&
        name !== "/quota")
        return undefined;
    return normalizeAgyQuotaSummary(objectValue(command?.data));
}
export function normalizeAgyUserStatus(raw) {
    const data = objectValue(raw);
    const status = objectValue(data?.userStatus) ?? data;
    if (!status)
        return undefined;
    const planStatus = objectValue(status.planStatus);
    const planInfo = objectValue(planStatus?.planInfo);
    const accountEmail = stringValue(status.email);
    const userTier = objectValue(status.userTier);
    const plan = stringValue(userTier?.name) ?? stringValue(planInfo?.planName);
    const configData = objectValue(status.cascadeModelConfigData) ??
        objectValue(data?.cascadeModelConfigData) ??
        data;
    const windows = normalizeModelConfigWindows(configData);
    if (windows.length === 0 && !plan && !accountEmail)
        return undefined;
    return {
        plan,
        account: accountEmail ? { email: accountEmail } : undefined,
        windows,
        refreshedAt: nowIso(),
    };
}
export function processInfosFromPs(output) {
    const processes = [];
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match)
            continue;
        const pid = Number(match[1]);
        const command = match[2].trim();
        if (!Number.isInteger(pid) || command.length === 0)
            continue;
        const source = agyProcessSource(command);
        if (!source)
            continue;
        processes.push({
            pid,
            command,
            source,
            csrfToken: flagValue(command, "csrf_token"),
            extensionPort: numberValue(flagValue(command, "extension_server_port")),
            extensionServerCsrfToken: flagValue(command, "extension_server_csrf_token"),
        });
    }
    return processes;
}
export function portsFromLsof(output) {
    const ports = new Set();
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(/TCP\s+(?:\[[^\]]+\]|[^:]+):(\d+)\s+\(LISTEN\)/);
        const port = match ? Number(match[1]) : undefined;
        if (port && port > 0 && port <= 65535)
            ports.add(port);
    }
    return [...ports];
}
async function fetchLoopbackQuota(runtime) {
    const deadline = createProbeDeadline();
    const { endpoints, confirmedNoProcess, processDiscoveryUnavailable } = await discoverAgyEndpoints(runtime, deadline);
    if (endpoints.length === 0)
        throw new AgyUnavailableError(confirmedNoProcess
            ? AGY_NOT_RUNNING
            : processDiscoveryUnavailable
                ? AGY_PROCESS_DISCOVERY_UNAVAILABLE
                : AGY_NO_ENDPOINT);
    let lastError;
    for (const endpoint of endpoints) {
        try {
            if (endpoint.requiresUnleashProbe)
                await probeEndpoint(runtime, endpoint, deadline);
            return await fetchEndpointQuota(runtime, endpoint, deadline);
        }
        catch (error) {
            lastError = strongerFailure(lastError, error);
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error("Antigravity quota unavailable");
}
async function discoverAgyEndpoints(runtime, deadline) {
    const processListText = await readProcessList(runtime, deadline);
    const processes = processListText !== null ? processInfosFromPs(processListText) : [];
    const confirmedNoProcess = processListText !== null && processes.length === 0;
    const processDiscoveryUnavailable = processListText === null;
    const endpoints = [];
    let discoveryError;
    for (const processInfo of processes) {
        let listeningPorts;
        try {
            listeningPorts = await readListeningPorts(runtime, processInfo.pid, deadline);
        }
        catch (error) {
            if (error instanceof AgyProbeBudgetError)
                throw error;
            discoveryError = strongerFailure(discoveryError, error);
            continue;
        }
        if (processInfo.source === "agy") {
            for (const port of listeningPorts) {
                endpoints.push(endpointFor(processInfo, "https", port, undefined, false, false), endpointFor(processInfo, "http", port, undefined, false, false));
            }
            continue;
        }
        if (processInfo.csrfToken) {
            for (const port of listeningPorts) {
                endpoints.push(endpointFor(processInfo, "https", port, processInfo.csrfToken, true, true), endpointFor(processInfo, "http", port, processInfo.csrfToken, true, true));
            }
        }
        if (processInfo.extensionPort &&
            listeningPorts.includes(processInfo.extensionPort)) {
            const token = processInfo.extensionServerCsrfToken ?? processInfo.csrfToken;
            if (token) {
                endpoints.push(endpointFor(processInfo, "http", processInfo.extensionPort, token, true, true));
            }
        }
    }
    if (endpoints.length === 0 && discoveryError)
        throw discoveryError;
    return {
        endpoints: endpoints.sort(compareEndpoints),
        confirmedNoProcess,
        processDiscoveryUnavailable,
    };
}
function endpointFor(processInfo, scheme, port, csrfToken, requiresCsrfToken, requiresUnleashProbe) {
    return {
        scheme,
        port,
        source: processInfo.source,
        pid: processInfo.pid,
        csrfToken,
        requiresCsrfToken,
        requiresUnleashProbe,
    };
}
async function fetchEndpointQuota(runtime, endpoint, deadline) {
    let summaryError;
    try {
        const summary = normalizeAgyQuotaSummary(await withinProbeBudget(deadline, REQUEST_TIMEOUT_MS, (timeoutMs) => runtime.requestJson(endpoint, QUOTA_SUMMARY_PATH, timeoutMs)));
        if (summary) {
            const identity = await fetchEndpointIdentity(runtime, endpoint, deadline);
            return {
                ...summary,
                plan: identity?.plan,
                account: identity?.account,
            };
        }
        summaryError = new AgyMalformedResponseError("Antigravity quota summary malformed");
    }
    catch (error) {
        summaryError = strongerFailure(summaryError, error);
    }
    for (const path of [USER_STATUS_PATH, COMMAND_MODEL_CONFIGS_PATH]) {
        try {
            const fallback = normalizeAgyUserStatus(await withinProbeBudget(deadline, REQUEST_TIMEOUT_MS, (timeoutMs) => runtime.requestJson(endpoint, path, timeoutMs)));
            if (fallback && fallback.windows.length > 0)
                return fallback;
        }
        catch (error) {
            summaryError = strongerFailure(summaryError, error);
        }
    }
    throw summaryError instanceof Error
        ? summaryError
        : new Error("Antigravity quota unavailable");
}
async function probeEndpoint(runtime, endpoint, deadline) {
    await withinProbeBudget(deadline, REQUEST_TIMEOUT_MS, (timeoutMs) => runtime.requestJson(endpoint, UNLEASH_PATH, timeoutMs));
}
async function fetchEndpointIdentity(runtime, endpoint, deadline) {
    try {
        return normalizeAgyUserStatus(await withinProbeBudget(deadline, REQUEST_TIMEOUT_MS, (timeoutMs) => runtime.requestJson(endpoint, USER_STATUS_PATH, timeoutMs)));
    }
    catch {
        return undefined;
    }
}
async function readProcessList(runtime, deadline) {
    if (runtimeProcess.platform === "win32")
        return null;
    const effectiveUid = runtimeProcess.geteuid?.();
    if (effectiveUid === undefined)
        throw new AgyDiscoveryError("Antigravity process discovery failed");
    try {
        return await withinProbeBudget(deadline, PROCESS_TIMEOUT_MS, (timeoutMs) => runtime.execFileText("ps", currentUserProcessListArgs(effectiveUid), timeoutMs));
    }
    catch (error) {
        if (error instanceof AgyProbeBudgetError)
            throw error;
        throw new AgyDiscoveryError("Antigravity process discovery failed");
    }
}
async function readListeningPorts(runtime, pid, deadline) {
    if (runtimeProcess.platform === "win32")
        return [];
    try {
        return portsFromLsof(await withinProbeBudget(deadline, PORT_TIMEOUT_MS, (timeoutMs) => runtime.execFileText("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], timeoutMs)));
    }
    catch (error) {
        if (error instanceof AgyProbeBudgetError)
            throw error;
        throw new AgyDiscoveryError("Antigravity port discovery failed");
    }
}
function normalizeQuotaSummaryGroup(raw) {
    const group = objectValue(raw);
    if (!group)
        return [];
    const groupName = stringValue(group.displayName) ?? stringValue(group.name) ?? "Quota";
    return arrayValue(group.buckets)
        .map((bucket) => normalizeQuotaSummaryBucket(groupName, bucket))
        .filter((window) => Boolean(window));
}
function normalizeQuotaSummaryBucket(groupName, raw) {
    const bucket = objectValue(raw);
    if (!bucket)
        return undefined;
    const disabled = booleanValue(bucket.disabled) ?? false;
    if (disabled)
        return undefined;
    const bucketId = stringValue(bucket.bucketId) ??
        stringValue(bucket.bucket_id) ??
        stringValue(bucket.id);
    if (!bucketId)
        return undefined;
    const windowKind = agyWindowKind(bucket);
    const group = agyWindowGroup(groupName, bucketId);
    const label = `${group.label} ${windowKind.label}`;
    const result = {
        id: `${group.id}_${windowKind.id}`,
        label,
        kind: windowKind.kind,
        resetsAt: parseEpochOrIso(bucket.resetTime) ?? parseEpochOrIso(bucket.reset_time),
        resetText: stringValue(bucket.description),
    };
    if (windowKind.windowSeconds !== undefined) {
        result.windowSeconds = windowKind.windowSeconds;
    }
    const remaining = remainingFraction(bucket);
    if (remaining !== undefined) {
        const percentUsed = clampPercent((1 - clampFraction(remaining)) * 100);
        result.percentUsed = percentUsed;
        result.percentRemaining = percentRemaining(percentUsed);
    }
    if (result.percentUsed === undefined && !result.resetsAt && !result.resetText)
        return undefined;
    return result;
}
function normalizeModelConfigWindows(raw) {
    const data = objectValue(raw);
    const configs = arrayValue(data?.clientModelConfigs);
    return configs
        .map(normalizeModelConfigWindow)
        .filter((window) => Boolean(window));
}
function normalizeModelConfigWindow(raw) {
    const config = objectValue(raw);
    if (!config)
        return undefined;
    const label = stringValue(config.label);
    const quotaInfo = objectValue(config.quotaInfo);
    const modelOrAlias = objectValue(config.modelOrAlias);
    const modelId = stringValue(modelOrAlias?.model) ??
        stringValue(modelOrAlias?.alias) ??
        (label ? slugify(label) : undefined);
    if (!label || !modelId || !quotaInfo)
        return undefined;
    const remaining = remainingFraction(quotaInfo);
    const result = {
        id: `model:${slugify(modelId)}`,
        label,
        kind: "model",
        resetsAt: parseEpochOrIso(quotaInfo.resetTime) ??
            parseEpochOrIso(quotaInfo.reset_time),
    };
    if (remaining !== undefined) {
        const percentUsed = clampPercent((1 - clampFraction(remaining)) * 100);
        result.percentUsed = percentUsed;
        result.percentRemaining = percentRemaining(percentUsed);
    }
    return result.percentUsed === undefined && !result.resetsAt
        ? undefined
        : result;
}
function quotaSummaryPayload(raw) {
    const data = objectValue(raw);
    if (!data)
        return undefined;
    return (objectValue(data.response) ??
        objectValue(data.summary) ??
        (Array.isArray(data.groups) ? data : undefined));
}
function agyWindowGroup(groupName, bucketId) {
    const normalized = `${groupName} ${bucketId}`.toLowerCase();
    // Argon is its own quota on paid Pro plans, so it must not share the
    // `gemini_*` window ids or the Gemini bound.
    if (normalized.includes("gemini") && normalized.includes("argon")) {
        return { id: "gemini_argon", label: "Gemini Argon", sortRank: 2 };
    }
    if (normalized.includes("gemini")) {
        return { id: "gemini", label: "Gemini", sortRank: 0 };
    }
    if (normalized.includes("claude") ||
        normalized.includes("gpt") ||
        normalized.includes("3p")) {
        return { id: "claude_gpt", label: "Claude/GPT", sortRank: 1 };
    }
    const id = slugify(groupName) || "quota";
    return { id, label: groupName, sortRank: 2 };
}
function agyWindowKind(bucket) {
    const raw = [
        stringValue(bucket.window),
        stringValue(bucket.bucketId),
        stringValue(bucket.bucket_id),
        stringValue(bucket.displayName),
        stringValue(bucket.name),
    ]
        .filter((value) => Boolean(value))
        .map((value) => value.toLowerCase());
    if (raw.some((value) => /^(?:(?:gemini|3p|third-party)[-_])?(?:5h|5-hour|five[ _-]hour)(?: limit)?$/.test(value))) {
        return {
            id: "5h",
            label: "5-hour",
            kind: "session",
            sortRank: 0,
            windowSeconds: FIVE_HOURS_SECONDS,
        };
    }
    if (raw.some((value) => /^(?:(?:gemini|3p|third-party)[-_])?weekly(?: limit)?$/.test(value))) {
        return {
            id: "weekly",
            label: "weekly",
            kind: "weekly",
            sortRank: 1,
            windowSeconds: WEEK_SECONDS,
        };
    }
    return { id: "unknown", label: "quota", kind: "unknown", sortRank: 2 };
}
function remainingFraction(data) {
    return (numberValue(data.remainingFraction) ??
        numberValue(data.remaining_fraction) ??
        oneofRemainingFraction(data.remaining));
}
function oneofRemainingFraction(raw) {
    const direct = numberValue(raw);
    if (direct !== undefined)
        return direct;
    const data = objectValue(raw);
    if (!data)
        return undefined;
    return (numberValue(data.remainingFraction) ??
        numberValue(data.remaining_fraction) ??
        (stringValue(data.case) === "remainingFraction" ||
            stringValue(data.case) === "remaining_fraction"
            ? numberValue(data.value)
            : undefined));
}
function compareAgyWindows(left, right) {
    const leftGroup = windowGroupRank(left.id);
    const rightGroup = windowGroupRank(right.id);
    if (leftGroup !== rightGroup)
        return leftGroup - rightGroup;
    return windowKindRank(left) - windowKindRank(right);
}
function windowGroupRank(id) {
    if (id.startsWith("gemini_"))
        return 0;
    if (id.startsWith("claude_gpt_"))
        return 1;
    return 2;
}
function windowKindRank(window) {
    if (window.kind === "session")
        return 0;
    if (window.kind === "weekly")
        return 1;
    return 2;
}
function agyProcessSource(command) {
    const commandTokens = tokenizeCommand(command);
    const invokedExecutable = executableName(commandTokens[0] ?? "");
    if (invokedExecutable === "agy")
        return "agy";
    if (invokedExecutable &&
        /^(?:node|nodejs|bun|mcp-server(?:\.cjs)?)$/.test(invokedExecutable)) {
        const script = invokedExecutable.startsWith("mcp-server")
            ? commandTokens[0]
            : commandTokens[1];
        if (isAgyMcpScript(script))
            return "agy";
    }
    if (isAgyAppExecutable(command))
        return "app";
    return undefined;
}
function tokenizeCommand(command) {
    return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
}
function isAgyMcpScript(token) {
    if (!token)
        return false;
    const path = normalizedPath(token);
    return (path.split("/").pop() === "mcp-server.cjs" &&
        path.split("/").includes("antigravity-cli"));
}
function isAgyAppExecutable(command) {
    const normalized = normalizedPath(command);
    const executablePath = normalized.split(/\s+--/, 1)[0];
    if (/^\/applications\/(?:[^/\n]+\/)*[^/\n]*antigravity[^/\n]*\.app\/contents\/[^\n]*\/language[-_]server(?:_[a-z0-9_]+)?$/.test(executablePath))
        return true;
    const firstToken = tokenizeCommand(command)[0];
    if (!firstToken)
        return false;
    const path = normalizedPath(firstToken);
    return (path.includes("antigravity") &&
        /(?:^|\/)language[-_]server(?:_[a-z0-9_]+)?(?:\.exe)?$/.test(path));
}
function normalizedPath(value) {
    return value.replace(/\\/g, "/").toLowerCase();
}
function executableName(command) {
    const token = command.trim().split(/\s+/, 1)[0];
    if (!token)
        return undefined;
    const name = token.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
    return name?.replace(/\.exe$/, "");
}
function flagValue(command, name) {
    const pattern = new RegExp(`(?:^|\\s)--${name}(?:=([^\\s]+)|\\s+([^\\s]+))`);
    const match = command.match(pattern);
    return match?.[1] ?? match?.[2];
}
function portsFromEndpoint(endpoint) {
    return endpoint.port;
}
function compareEndpoints(left, right) {
    const sourceRank = sourceSortRank(left.source) - sourceSortRank(right.source);
    if (sourceRank !== 0)
        return sourceRank;
    const portRank = portsFromEndpoint(left) - portsFromEndpoint(right);
    if (portRank !== 0)
        return portRank;
    return schemeSortRank(left.scheme) - schemeSortRank(right.scheme);
}
function sourceSortRank(source) {
    return source === "agy" ? 0 : 1;
}
function schemeSortRank(scheme) {
    return scheme === "https" ? 0 : 1;
}
function statusForError(error) {
    if (/not running|no local|loopback (?:access )?unavailable|(?:loopback|probe) timed out|ECONNREFUSED|ECONNRESET|ECONNABORTED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|EPIPE|EPROTO|socket hang up/i.test(error))
        return "unavailable";
    return statusFromError(error);
}
function statusForFailure(error) {
    if (error instanceof AgyUnavailableError)
        return "unavailable";
    return statusForError(errorMessage(error));
}
export function requestLoopbackJson(endpoint, path, timeoutMs) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(requestBodyForPath(path));
        const headers = {
            accept: "application/json",
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "connect-protocol-version": "1",
        };
        if (endpoint.requiresCsrfToken && endpoint.csrfToken) {
            headers["x-codeium-csrf-token"] = endpoint.csrfToken;
        }
        const options = {
            hostname: "127.0.0.1",
            port: endpoint.port,
            path,
            method: "POST",
            headers,
        };
        if (endpoint.scheme === "https")
            options.rejectUnauthorized = false;
        const client = endpoint.scheme === "https" ? https : http;
        let response;
        let settled = false;
        const finish = (error, value) => {
            if (settled)
                return;
            settled = true;
            runtimeClearTimeout(timer);
            if (error) {
                response?.destroy();
                request.destroy();
                reject(error);
            }
            else {
                resolve(value);
            }
        };
        const request = client.request(options, (incoming) => {
            response = incoming;
            const chunks = [];
            let receivedBytes = 0;
            incoming.on("data", (chunk) => {
                if (settled)
                    return;
                const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
                receivedBytes += bytes.byteLength;
                if (receivedBytes > MAX_RESPONSE_BYTES) {
                    finish(new AgyMalformedResponseError("Antigravity loopback response too large"));
                    return;
                }
                chunks.push(new Uint8Array(bytes));
            });
            incoming.on("end", () => {
                if (settled)
                    return;
                const text = Buffer.concat(chunks).toString("utf8");
                if (!incoming.statusCode ||
                    incoming.statusCode < 200 ||
                    incoming.statusCode >= 300) {
                    finish(httpResponseError(incoming.statusCode ?? 0, text));
                    return;
                }
                try {
                    finish(undefined, JSON.parse(text));
                }
                catch {
                    finish(new AgyMalformedResponseError("Antigravity loopback returned invalid JSON"));
                }
            });
            incoming.on("error", (error) => finish(sanitizeTransportError(error)));
        });
        const timer = runtimeSetTimeout(() => finish(new AgyUnavailableError("Antigravity loopback timed out")), timeoutMs);
        request.on("error", (error) => finish(sanitizeTransportError(error)));
        request.end(body);
    });
}
function requestBodyForPath(path) {
    if (path === QUOTA_SUMMARY_PATH)
        return { request: {}, forceRefresh: false };
    return {
        metadata: {
            ideName: "antigravity",
            extensionName: "antigravity",
            ideVersion: "unknown",
            locale: "en",
        },
    };
}
function clampFraction(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(1, Math.max(0, value));
}
function objectValue(value) {
    return value && typeof value === "object"
        ? value
        : undefined;
}
function arrayValue(value) {
    return Array.isArray(value) ? value : [];
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
function booleanValue(value) {
    return typeof value === "boolean" ? value : undefined;
}
function slugify(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return "Antigravity quota unavailable";
}
function sanitizeTransportError(error) {
    const code = error.code;
    if (code && /^[A-Z][A-Z0-9_]+$/.test(code)) {
        return new AgyUnavailableError(`Antigravity loopback unavailable (${code})`);
    }
    return new AgyUnavailableError("Antigravity loopback unavailable");
}
function sanitizeCliError(error) {
    const details = objectValue(error);
    const code = stringValue(details?.code);
    if (details?.killed === true || code === "ETIMEDOUT")
        return new AgyUnavailableError("Antigravity CLI /quota timed out");
    if (code === "ENOENT")
        return new AgyUnavailableError(AGY_CLI_NOT_INSTALLED);
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
        return new AgyMalformedResponseError("Antigravity CLI /quota response too large");
    return new Error("Antigravity CLI /quota failed");
}
function strongerFailure(current, candidate) {
    if (current === undefined)
        return candidate;
    return failureRank(candidate) > failureRank(current) ? candidate : current;
}
function failureRank(error) {
    if (error instanceof AgyCsrfError)
        return 2;
    const status = statusForFailure(error);
    if (status === "auth_required")
        return 4;
    if (status === "rate_limited")
        return 3;
    if (status === "error")
        return 2;
    if (status === "unavailable")
        return 1;
    return 0;
}
/**
 * `agy` has no credential or configuration state that this provider reads.
 * Absence is established only when both independent discovery paths agree:
 * PATH contains no CLI, and the process list was successfully read and
 * contains no Antigravity runtimeProcess. A process that is running but has no
 * accessible endpoint, or a platform where process discovery is unavailable
 * (Windows), does not meet this test and continues to use the stale fallback.
 */
function isDefinitelyUninstalled(attempts) {
    return (attempts.length === 2 &&
        attempts[0]?.source === "cli" &&
        attempts[0]?.status === "skipped" &&
        attempts[0]?.error === AGY_CLI_NOT_INSTALLED &&
        attempts[1]?.source === "loopback" &&
        attempts[1]?.status === "skipped" &&
        attempts[1]?.error === AGY_NOT_RUNNING);
}
function staleEligibleFailure(error) {
    if (error instanceof AgyCsrfError)
        return false;
    if (error instanceof AgyHttpError)
        return error.status === 429 || error.status >= 500;
    return statusForFailure(error) === "unavailable";
}
function isDefinitiveAuthFailure(error) {
    if (error instanceof AgyCsrfError)
        return false;
    return statusForError(errorMessage(error)) === "auth_required";
}
function createProbeDeadline() {
    return Date.now() + PROBE_BUDGET_MS;
}
function withinProbeBudget(deadline, perOperationTimeoutMs, operation) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
        return Promise.reject(new AgyProbeBudgetError("Antigravity probe timed out"));
    const timeoutMs = Math.min(perOperationTimeoutMs, remainingMs);
    return new Promise((resolve, reject) => {
        const timer = runtimeSetTimeout(() => reject(new AgyProbeBudgetError("Antigravity probe timed out")), timeoutMs);
        operation(timeoutMs).then((value) => {
            runtimeClearTimeout(timer);
            resolve(value);
        }, (error) => {
            runtimeClearTimeout(timer);
            reject(error);
        });
    });
}
class AgyUnavailableError extends Error {
}
class AgyCsrfError extends AgyUnavailableError {
}
class AgyProbeBudgetError extends AgyUnavailableError {
}
class AgyMalformedResponseError extends Error {
}
class AgyDiscoveryError extends Error {
}
class AgyHttpError extends Error {
    status;
    constructor(status) {
        super(httpErrorMessage(status));
        this.status = status;
    }
}
function httpResponseError(status, body) {
    if ((status === 401 || status === 403) && isCsrfRejection(body)) {
        return new AgyCsrfError("Antigravity CLI quota unavailable because its runtime CSRF token is not exposed; use Antigravity /quota");
    }
    return new AgyHttpError(status);
}
function isCsrfRejection(body) {
    if (/missing\s+CSRF\s+token/i.test(body))
        return true;
    try {
        const payload = objectValue(JSON.parse(body));
        const message = stringValue(payload?.message);
        return /^(?:missing|invalid) CSRF token$/i.test(message ?? "");
    }
    catch {
        return false;
    }
}
function httpErrorMessage(status) {
    if (status === 401 || status === 403)
        return "Antigravity sign-in required";
    if (status === 429)
        return "Antigravity quota endpoint rate limited";
    return `Antigravity quota endpoint returned HTTP ${status}`;
}
const defaultRuntime = {
    findCommandPath: async (command) => {
        const { findCommandPath } = await import("../lib/process.js");
        return findCommandPath(command);
    },
    execFileText,
    requestJson: requestLoopbackJson,
};
