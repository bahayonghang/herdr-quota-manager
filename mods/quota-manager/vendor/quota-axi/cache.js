// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { chmodSync, existsSync, renameSync, writeFileSync, dirname, join, runtimeProcess } from "./runtime.js";
import { createHash } from "crypto";


import { cacheFilePath, claudeCredentialContextId, ensurePrivateParent, readUntracedJsonFile, } from "./lib/fs.js";
import { kimiReadingContextId } from "./providers/kimi-cache-context.js";
import { commandCodeReadingContextId } from "./providers/commandcode-cache-context.js";
import { devinReadingContextId } from "./providers/devin-cache-context.js";
import { elevenLabsReadingContextId } from "./providers/elevenlabs-cache-context.js";
import { miniMaxReadingContextId } from "./providers/minimax-cache-context.js";
import { museReadingContextId } from "./providers/muse-cache-context.js";
import { zaiReadingContextId } from "./providers/zai-cache-context.js";
import { copilotGithubHost } from "./providers/copilot-host.js";
import { isPiCodexSource } from "./providers/pi-codex-credential.js";
import { fetchLockPath, withLockSync } from "./lib/fetch-lock.js";
import { inputsDigest } from "./lib/input-trace.js";
import { reuseContextId } from "./lib/reuse-context.js";
import { PROVIDER_IDS } from "./types.js";
const PROVIDER_SOURCES = [
    "oauth",
    "pi:openai-codex",
    "cli-rpc",
    "cli",
    "api",
    "web",
    "cache",
    "unavailable",
];
const PROVIDER_STATUSES = [
    "fresh",
    "stale",
    "unavailable",
    "auth_required",
    "rate_limited",
    "error",
];
const WINDOW_KINDS = [
    "session",
    "weekly",
    "monthly",
    "model",
    "credits",
    "unknown",
];
const CACHE_SCHEMA_VERSION = 3;
/**
 * The filler an expanded report stamps on providers that selected one account.
 * It describes that report, not the snapshot, so it is never persisted: a stale
 * reading carrying it back would expand a report in which nothing expanded.
 */
const DEFAULT_ACCOUNT_KEY = "default";
const CREDENTIAL_CONTEXT_ID = /^[a-f0-9]{64}$/;
/**
 * Providers whose snapshots record which account they belong to, because the
 * cache slot alone does not say: a Claude profile selects the credential store,
 * a Kimi Code `config.toml` selects the deployment, Command Code's `whoami`
 * identifies the source-plus-account pair, an ElevenLabs API key is itself the
 * account, MiniMax stamps by credential source plus deployment host, a Muse
 * credential is the only local thing naming its subscription, and a Codex slot
 * can be signed in to another ChatGPT account. A snapshot from one such context
 * says nothing about another, so each is stamped on write and checked on stale
 * reuse - strictly for Claude, Kimi, Command Code, MiniMax, ElevenLabs, Devin,
 * and Muse, whose identity a reading always has (and which skip write and clear
 * when that identity is missing). Codex can write an unstamped snapshot, but
 * stale reuse requires a matching stored account id. Z.AI likewise requires an
 * identity, stamped on the reading from the key that actually answered.
 *
 * How that stamp is obtained is not the same question for each. A Claude
 * profile is fixed by this process's own environment, so deriving it here reads
 * the same selection the reading used. Kimi's is not derivable here at all.
 * Kimi Code rewrites `config.toml` on login, so a read taken after the quota
 * request has returned can describe a deployment the numbers never came from;
 * and a Kimi reading need not come from that configuration in the first place,
 * because Pi brokers a credential for the default endpoint while naming no
 * deployment. Kimi therefore reports the identity of whatever actually produced
 * its reading. Command Code likewise publishes the source-plus-account identity
 * `whoami` established, rather than deriving one here. Codex's slot is not local configuration either: a failed probe
 * can only name the accounts the credentials still store, so the stamp is the
 * stored id of the one credential that answered (not the vendor's response id,
 * which can differ while the token is the same) hashed because the cache holds
 * no account identity in the clear. MiniMax publishes the answering credential
 * source plus the deployment host its resolution implies. ElevenLabs publishes
 * a one-way digest of the key that answered, because that key is the only thing
 * naming the subscription and its single slot would otherwise be shared by
 * every key. Devin publishes the answering source, host, and a one-way digest
 * of the session token, because a new login replaces that token. Muse publishes
 * the same kind of digest for the credential that answered, and additionally
 * reuses its own fresh snapshot inside the key-endpoint interval, so that
 * stamp is what keeps a replayed reading on the credential that produced it.
 */
const CONTEXT_SCOPED_PROVIDERS = {
    claude: claudeReadingContextId,
    kimi: kimiReadingContextId,
    commandcode: commandCodeReadingContextId,
    elevenlabs: elevenLabsReadingContextId,
    devin: devinReadingContextId,
    codex: codexStampContextId,
    minimax: miniMaxReadingContextId,
    muse: museReadingContextId,
    copilot: copilotReadingContextId,
    zai: zaiReadingContextId,
};
export function copilotCacheContextId(host) {
    return createHash("sha256")
        .update(JSON.stringify(["copilot-host-v1", host]))
        .digest("hex");
}
function copilotReadingContextId() {
    return copilotCacheContextId(copilotGithubHost());
}
/**
 * The stored ChatGPT account id the credential that produced this report named.
 * A symbol key so it survives the object copies the quota command makes between
 * the adapter and this writer, while staying off every serialized surface:
 * `JSON.stringify`, `Object.keys` and the TOON encoder all skip symbol keys.
 */
const CODEX_STORED_ACCOUNT_ID = Symbol("codexStoredAccountId");
export function stampCodexStoredAccountId(provider, accountId) {
    if (accountId)
        provider[CODEX_STORED_ACCOUNT_ID] = accountId;
}
function codexStampContextId(provider) {
    return codexAccountContextId(provider[CODEX_STORED_ACCOUNT_ID]);
}
/**
 * The Claude profile context a lane reading was taken under. A symbol key,
 * like the Codex stamp, so it survives the quota command's object copies while
 * staying off every serialized surface. Only discovered profile lanes stamp
 * it; a reading without one belongs to the profile this process selects, as it
 * always has.
 */
const CLAUDE_READING_CONTEXT = Symbol("claudeReadingContext");
export function stampClaudeReadingContext(provider, contextId) {
    provider[CLAUDE_READING_CONTEXT] = contextId;
}
function claudeReadingContextId(provider) {
    return (provider[CLAUDE_READING_CONTEXT] ??
        claudeCredentialContextId());
}
function codexAccountContextId(accountId) {
    return accountId
        ? createHash("sha256")
            .update(JSON.stringify(["codex-account-v1", accountId]))
            .digest("hex")
        : undefined;
}
/**
 * The verified subscription a snapshot was read from, hashed because the cache
 * holds no account identity in the clear. A symbol key carries it onto the
 * snapshot, and from there through `staleFromCache`, while keeping it off every
 * serialized surface, so a stale reading can still be recognised as the same
 * subscription as a fresh sibling route.
 */
const SUBSCRIPTION_IDENTITY = Symbol("subscriptionIdentity");
/**
 * One comparable subscription identity per reading: the verified
 * `account.accountId` a live reading reports, else the stamp a cached snapshot
 * carried. Missing or unverified identity yields nothing, never a guess.
 */
export function subscriptionIdentity(report) {
    const accountId = report.account?.identityStatus === "unverified"
        ? undefined
        : report.account?.accountId?.trim();
    if (accountId) {
        const scoped = report;
        if (!Object.hasOwn(scoped, SUBSCRIPTION_SCOPE))
            return createHash("sha256")
                .update(JSON.stringify(["subscription-v1", report.provider, accountId]))
                .digest("hex");
        const scope = scoped[SUBSCRIPTION_SCOPE];
        if (!scope)
            return undefined;
        return createHash("sha256")
            .update(JSON.stringify(["subscription-v1", report.provider, accountId, scope]))
            .digest("hex");
    }
    return report[SUBSCRIPTION_IDENTITY];
}
/**
 * Where one account id holds more than one subscription, the reading names
 * which one it measured. A Claude login can belong to several organizations
 * (a personal plan and a team seat), each with its own limits, so the user id
 * alone would fold two quota pools into one row. `null` says the reading could
 * not name its subscription, which leaves its identity incomparable rather
 * than guessed. A symbol key keeps it off every serialized surface.
 */
const SUBSCRIPTION_SCOPE = Symbol("subscriptionScope");
export function stampSubscriptionScope(report, scope) {
    report[SUBSCRIPTION_SCOPE] = scope;
}
/**
 * Carry a cached snapshot's hashed subscription stamp onto a stale reading an
 * adapter assembled field by field, so it still coalesces with a fresh lane of
 * the same subscription.
 */
export function carrySubscriptionStamp(cached, stale) {
    const stamp = cached[SUBSCRIPTION_IDENTITY];
    if (stamp)
        stale[SUBSCRIPTION_IDENTITY] = stamp;
}
/**
 * Fresh lane readings a published reading superseded when it coalesced lanes
 * of one subscription. `writeCachedProviders` persists each in its own slot in
 * the same write as the winner, so a route that later fails still serves its
 * own stamped snapshot and coalesces again instead of surfacing as a separate
 * card. A symbol key keeps them off every serialized surface.
 */
const SUPERSEDED_READINGS = Symbol("supersededReadings");
export function supersededReadings(report) {
    return report[SUPERSEDED_READINGS] ?? [];
}
export function markSupersededReadings(report, readings) {
    report[SUPERSEDED_READINGS] = readings;
}
const AUTH_STATUSES = [
    "usable",
    "expired_refreshable",
    "unusable",
];
/**
 * The local inputs a provider's reading was traced to. A symbol key, like the
 * Codex stamp, so it survives the quota command's object copies while staying
 * off every serialized surface.
 */
const READING_INPUTS = Symbol("readingInputs");
/**
 * Attach the inputs a reading was traced to. Only a traced reading is ever
 * stamped for fresh reuse, because nothing else says what it depended on.
 */
export function stampReadingInputs(provider, inputs) {
    provider[READING_INPUTS] = inputs;
}
/**
 * The last successful reading of `provider`, when it was taken by a process
 * making the same credential selection as this one, no local file it was
 * derived from has changed since, every lane it reported was cached, and it is
 * younger than `maxAgeSeconds`. Returns `undefined`
 * whenever any of that is not established, so the caller reads the vendor.
 */
export function readReusableProviders(provider, maxAgeSeconds, now = Date.now(), contextId = reuseContextId()) {
    if (!(maxAgeSeconds > 0) || excludeFromFreshReuse(provider))
        return undefined;
    const records = readCacheProviders().filter((record) => record.snapshot.provider === provider &&
        record.reuse?.context === contextId);
    const readingAt = records
        .map((record) => record.reuse?.readingAt ?? "")
        .sort()
        .at(-1);
    const group = records.filter((record) => record.reuse?.readingAt === readingAt);
    if (group.length === 0 || group.length !== group[0].reuse?.lanes)
        return undefined;
    const young = group.every((record) => {
        const refreshedAt = Date.parse(record.snapshot.state.refreshedAt ?? "");
        return (Number.isFinite(refreshedAt) &&
            refreshedAt <= now &&
            now - refreshedAt < maxAgeSeconds * 1_000);
    });
    if (!young || !group.every((record) => stillCurrent(record, now)))
        return undefined;
    const stamp = group[0].reuse;
    if (inputsDigest(stamp.inputs) !== stamp.inputsDigest)
        return undefined;
    return group
        .sort((a, b) => (a.reuse?.lane ?? 0) - (b.reuse?.lane ?? 0))
        .map(reusedReading);
}
/**
 * The single-flight lock guarding vendor reads of `provider` under this
 * process's credential selection, so processes selecting different
 * credentials never wait on each other (#61).
 */
export function fetchLockPathFor(provider, contextId = reuseContextId()) {
    const key = createHash("sha256")
        .update(JSON.stringify(["fetch-lock-v1", provider, contextId]))
        .digest("hex");
    return fetchLockPath(dirname(cacheFilePath()), key);
}
/**
 * Whether a supplied snapshot file exists and every record in it parses as a
 * quota cache record. A record the cache reader would drop would otherwise
 * read as a fixture that never named that provider.
 */
export function isSnapshotFile(file) {
    const raw = readUntracedJsonFile(file);
    const records = objectValue(raw)?.providers;
    return (Array.isArray(records) &&
        parseCacheProviders(raw)?.length === records.length);
}
/**
 * Every reading of `provider` in a snapshot file supplied for tests and
 * fixtures, in file order. `undefined` when the file names no such provider;
 * `"expired"` when a window's own reset has already passed, because a number
 * that has stopped being true is never served (#257), not even from a stub.
 */
export function readSnapshotProviders(file, provider, now = Date.now()) {
    const records = readCacheProviders(file).filter((record) => record.snapshot.provider === provider);
    if (records.length === 0)
        return undefined;
    if (!records.every((record) => stillCurrent(record, now)))
        return "expired";
    return records.map(reusedReading);
}
/** Whether no window of this reading has reached its own reported reset. */
function stillCurrent(record, now) {
    return record.snapshot.windows.every((window) => window.resetsAt === undefined || Date.parse(window.resetsAt) > now);
}
function reusedReading(record) {
    const { snapshot, reuse } = record;
    return {
        ...snapshot,
        ...(reuse?.accountKeys ? { accountKeys: [...reuse.accountKeys] } : {}),
        ...(reuse?.accountLocator
            ? { accountLocator: { ...reuse.accountLocator } }
            : {}),
        windows: snapshot.windows.map((window) => ({ ...window })),
        state: {
            ...snapshot.state,
            status: "fresh",
            stale: false,
            reused: true,
            ...(reuse?.authStatus ? { authStatus: reuse.authStatus } : {}),
            ...(reuse?.degradedSources
                ? {
                    degradedSources: reuse.degradedSources.map((source) => ({
                        ...source,
                    })),
                }
                : {}),
        },
    };
}
export function readCachedProvider(provider, accountKey) {
    return readCachedRecord(provider, accountKey)?.snapshot;
}
function readCachedRecord(provider, accountKey) {
    return readCacheProviders().find((item) => item.snapshot.provider === provider &&
        (item.snapshot.accountKey ?? DEFAULT_ACCOUNT_KEY) ===
            (accountKey ?? DEFAULT_ACCOUNT_KEY));
}
/**
 * Codex stale quota, served only when the snapshot's stored ChatGPT account id
 * matches a credential the failed reading tried. A
 * Codex slot is not tied to one account by its name: the keyless slot is shared
 * by a sole discovered lane and the single-account path, and a stable Pi entry
 * key can be signed in to a different account, so the slot alone cannot say
 * whose windows it holds.
 *
 * The stamp is the stored id, not the vendor response id: those can differ
 * while the same token is live, and a later failed probe only has the store.
 * An unstamped snapshot, or a reading whose tried credentials name no account,
 * cannot establish ownership and is withheld from stale fallback.
 */
export function readCachedCodexProvider(accountKey, accountIds) {
    if (accountIds.length === 0)
        return undefined;
    const records = [
        readCachedRecord("codex", accountKey),
        ...(accountKey === "codex-home"
            ? [readCachedRecord("codex", undefined)]
            : []),
    ];
    return records.find((record) => record?.credentialContextId !== undefined &&
        accountIds.some((id) => codexAccountContextId(id) === record.credentialContextId))?.snapshot;
}
/**
 * Claude stale quota may only be reused when the cache record proves it was
 * captured for the same locally selected credential context.
 */
export function readCachedClaudeProvider(contextId) {
    return readCachedProviderInContext("claude", contextId);
}
/**
 * Kimi stale quota may only be reused when the cache record proves it was
 * captured from the same source and endpoint the caller is asking about, so one
 * deployment's numbers can never stand in for the other's and a Pi reading of
 * the default endpoint can never stand in for either.
 */
export function readCachedKimiProvider(contextId) {
    return readCachedProviderInContext("kimi", contextId);
}
/**
 * Command Code stale quota may only be reused when the cache record proves it
 * was captured for the same source and account the current `whoami` identified.
 */
export function readCachedCommandCodeProvider(contextId) {
    return readCachedProviderInContext("commandcode", contextId);
}
/**
 * MiniMax stale quota may only be reused when the cache record proves it was
 * captured from the same credential source and deployment host the caller is
 * asking about.
 */
export function readCachedMiniMaxProvider(contextId) {
    return readCachedProviderInContext("minimax", contextId);
}
/**
 * ElevenLabs stale quota may only be reused when the cache record proves it was
 * captured with the same API key, so one subscription's characters can never
 * stand in for another's.
 */
export function readCachedElevenLabsProvider(contextId) {
    return readCachedProviderInContext("elevenlabs", contextId);
}
/** Z.AI stale quota belongs only to the key that produced the snapshot. */
export function readCachedZaiProvider(contextId) {
    return readCachedProviderInContext("zai", contextId);
}
/**
 * Devin stale quota may only be reused when the cache record proves it was
 * captured for the same source, host, and key, so one login's windows can
 * never stand in for another's.
 */
export function readCachedDevinProvider(contextId) {
    return readCachedProviderInContext("devin", contextId);
}
/**
 * Muse quota may only be reused when the cache record proves it was captured
 * with the same credential, so one subscription's windows can never stand in
 * for another's.
 */
export function readCachedMuseProvider(contextId) {
    return readCachedProviderInContext("muse", contextId);
}
export function readCachedCopilotProvider(contextId) {
    return readCachedProviderInContext("copilot", contextId);
}
function readCachedProviderInContext(provider, contextId) {
    if (!CREDENTIAL_CONTEXT_ID.test(contextId))
        return undefined;
    const refreshedAt = (item) => {
        const time = Date.parse(item.snapshot.state.refreshedAt ?? "");
        return Number.isFinite(time) ? time : -Infinity;
    };
    return readCacheProviders()
        .filter((item) => item.snapshot.provider === provider &&
        item.credentialContextId === contextId)
        .reduce((newest, item) => newest && refreshedAt(newest) >= refreshedAt(item) ? newest : item, undefined)?.snapshot;
}
export function writeCachedProviders(published, readingAt = new Date().toISOString()) {
    // A reused reading is already the record it came from: rewriting it would
    // restamp its age, and a missing context identity must not clear it.
    const fresh = published.filter((provider) => !provider.state.reused);
    const reuseStamps = reuseStampsFor(fresh, readingAt);
    // A lane a coalesced report superseded still gets its own slot in this
    // write, so a later run where that route fails merges it from cache
    const providers = fresh
        .flatMap((provider) => [provider, ...supersededReadings(provider)])
        .filter((provider) => !isCacheExcluded(provider));
    const emptyReadings = providers.filter((provider) => provider.state.status === "fresh" &&
        provider.windows.length === 0 &&
        !missingRequiredContext(provider.provider));
    const clearProviders = new Set(emptyReadings.map(cacheIdentity));
    // One Claude profile can hold a plain slot and an opted-in lane slot, so a
    // confirmed-empty reading clears every slot its profile context wrote
    const clearClaudeContexts = new Set(emptyReadings
        .filter((provider) => provider.provider === "claude")
        .map(claudeReadingContextId));
    const cacheable = providers
        .map((provider) => {
        const record = toCacheProvider(provider);
        const reuse = reuseStamps.get(provider);
        return record && reuse ? { ...record, reuse } : record;
    })
        .filter((provider) => Boolean(provider));
    // Taking the lock creates the cache directory, so a reading that writes
    // and clears nothing must leave no trace on disk
    if (cacheable.length === 0 && clearProviders.size === 0)
        return;
    withCacheWriteLock(() => {
        const byProvider = new Map();
        let clearedExisting = false;
        for (const provider of readCacheProviders()) {
            if (clearProviders.has(cacheIdentity(provider.snapshot)) ||
                (provider.snapshot.provider === "claude" &&
                    clearClaudeContexts.has(provider.credentialContextId ?? ""))) {
                clearedExisting = true;
                continue;
            }
            byProvider.set(cacheIdentity(provider.snapshot), provider);
        }
        if (cacheable.length === 0 && !clearedExisting)
            return;
        for (const provider of cacheable)
            byProvider.set(cacheIdentity(provider.snapshot), provider);
        const merged = [...byProvider.values()].sort((a, b) => PROVIDER_IDS.indexOf(a.snapshot.provider) -
            PROVIDER_IDS.indexOf(b.snapshot.provider) ||
            (a.snapshot.accountKey ?? DEFAULT_ACCOUNT_KEY).localeCompare(b.snapshot.accountKey ?? DEFAULT_ACCOUNT_KEY));
        writeCacheFile(cacheFilePath(), merged);
    });
}
/**
 * Serialize the cache file's read-modify-write across processes. Leaders of
 * different providers write at once in a concurrent burst, and a merge that
 * read the file before another leader's write would drop that reading, so
 * its waiters would all find nothing and read the vendor together.
 */
function withCacheWriteLock(fn) {
    withLockSync(join(dirname(cacheFilePath()), "locks", "cache-write.lock"), fn);
}
/**
 * Fresh-reuse stamps for the providers whose every lane in this report is
 * cacheable. A provider with one failed, uncacheable, or empty lane gets none,
 * so the next read asks the vendor again instead of serving part of a report.
 */
function reuseStampsFor(providers, readingAt) {
    const stamps = new Map();
    let context;
    for (const id of new Set(providers.map((provider) => provider.provider))) {
        if (excludeFromFreshReuse(id))
            continue;
        const lanes = providers.filter((provider) => provider.provider === id);
        const inputs = lanes[0][READING_INPUTS];
        if (!inputs ||
            !lanes.every((provider) => provider[READING_INPUTS] === inputs &&
                !isCacheExcluded(provider) &&
                toCacheProvider(provider)))
            continue;
        context ??= reuseContextId();
        lanes.forEach((provider, lane) => {
            stamps.set(provider, {
                context: context,
                inputs: inputs.paths,
                inputsDigest: inputs.digest,
                readingAt,
                lanes: lanes.length,
                lane,
                ...(provider.accountKeys ? { accountKeys: provider.accountKeys } : {}),
                ...(provider.accountLocator
                    ? { accountLocator: provider.accountLocator }
                    : {}),
                ...(provider.state.authStatus
                    ? { authStatus: provider.state.authStatus }
                    : {}),
                ...(provider.state.degradedSources?.length
                    ? { degradedSources: provider.state.degradedSources }
                    : {}),
            });
        });
    }
    return stamps;
}
function isCacheExcluded(provider) {
    return ((provider.provider === "claude" || provider.provider === "copilot") &&
        provider.source === "cli");
}
function excludeFromFreshReuse(provider) {
    // Muse Keychain and Higgsfield CLI logins are not traced files, and the
    // Higgsfield status payload we already fetch has no stable non-email
    // account discriminator, so --max-age must never serve another seat's
    // credits or jobs as fresh.
    return provider === "muse" || provider === "higgsfield";
}
function cacheIdentity(provider) {
    return `${provider.provider}/${provider.accountKey ?? DEFAULT_ACCOUNT_KEY}`;
}
/**
 * Retire one slot. An omitted key retires only the default slot, so a sibling
 * account's snapshot stays. {@link deleteCachedProvider} with no key removes
 * every slot for that provider.
 */
export function retireCachedSlot(provider, accountKey) {
    deleteCachedProvider(provider, accountKey ?? DEFAULT_ACCOUNT_KEY);
}
/**
 * Retire Codex snapshots stamped with one of the rejected stored account ids.
 * A slot stamped for another account, or not stamped at all, stays.
 */
export function retireCodexAccount(accountIds) {
    if (!existsSync(cacheFilePath()))
        return;
    const contextIds = new Set(accountIds.map(codexAccountContextId));
    withCacheWriteLock(() => {
        const existing = readCacheProviders();
        const remaining = existing.filter((item) => item.snapshot.provider !== "codex" ||
            !(item.credentialContextId && contextIds.has(item.credentialContextId)));
        if (remaining.length === existing.length)
            return;
        writeCacheFile(cacheFilePath(), remaining);
    });
}
/**
 * Retire the snapshots one credential context wrote, whichever slot holds
 * them. A discovered Claude profile's sign-out speaks only for that profile,
 * so its siblings' snapshots stay.
 */
export function retireCachedContext(provider, contextId) {
    if (!CREDENTIAL_CONTEXT_ID.test(contextId) || !existsSync(cacheFilePath()))
        return;
    withCacheWriteLock(() => {
        const existing = readCacheProviders();
        const remaining = existing.filter((item) => item.snapshot.provider !== provider ||
            item.credentialContextId !== contextId);
        if (remaining.length === existing.length)
            return;
        writeCacheFile(cacheFilePath(), remaining);
    });
}
export function deleteCachedProvider(provider, accountKey) {
    if (!existsSync(cacheFilePath()))
        return;
    withCacheWriteLock(() => {
        const existing = readCacheProviders();
        const remaining = existing.filter((item) => item.snapshot.provider !== provider
            ? true
            : accountKey !== undefined &&
                (item.snapshot.accountKey ?? DEFAULT_ACCOUNT_KEY) !== accountKey);
        if (remaining.length === existing.length)
            return;
        writeCacheFile(cacheFilePath(), remaining);
    });
}
function writeCacheFile(file, providers) {
    ensurePrivateParent(file);
    const temp = `${file}.${runtimeProcess.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        schemaVersion: CACHE_SCHEMA_VERSION,
        providers: providers.map(serializeCachedProvider),
    }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, file);
    chmodSync(file, 0o600);
}
function readCacheProviders(file = cacheFilePath()) {
    return parseCacheProviders(readUntracedJsonFile(file)) ?? [];
}
/** `undefined` when the value is not a quota cache payload this version reads */
function parseCacheProviders(raw) {
    const payload = objectValue(raw);
    const schemaVersion = numberValue(payload?.schemaVersion);
    if (!payload ||
        (schemaVersion !== 1 &&
            schemaVersion !== 2 &&
            schemaVersion !== CACHE_SCHEMA_VERSION) ||
        !Array.isArray(payload.providers))
        return undefined;
    return payload.providers
        .map((provider) => normalizeCachedProvider(provider, schemaVersion))
        .filter((provider) => Boolean(provider));
}
function toCacheProvider(provider) {
    // A reading served from the cache observed nothing new; rewriting it would
    // only relabel an old observation.
    if (provider.state.status !== "fresh" ||
        provider.windows.length === 0 ||
        provider.source === "cache")
        return undefined;
    const snapshot = normalizeCachedProvider({
        provider: provider.provider,
        accountKey: provider.accountKey === DEFAULT_ACCOUNT_KEY
            ? undefined
            : provider.accountKey,
        label: provider.label,
        source: provider.source,
        plan: provider.plan,
        windows: provider.windows,
        credits: provider.credits,
        jobs: provider.jobs,
        state: {
            status: provider.state.status,
            stale: false,
            refreshedAt: provider.state.refreshedAt,
            untrustedWindowIds: provider.state.untrustedWindowIds,
            sourcesTried: provider.state.sourcesTried,
        },
    }, CACHE_SCHEMA_VERSION)?.snapshot;
    if (!snapshot)
        return undefined;
    const subscription = subscriptionIdentity(provider);
    if (subscription)
        snapshot[SUBSCRIPTION_IDENTITY] =
            subscription;
    const contextId = CONTEXT_SCOPED_PROVIDERS[provider.provider]?.(provider);
    // Claude, Kimi, Command Code, MiniMax, ElevenLabs, Devin, and Muse require a
    // published identity; Codex stamps are optional at write time, but an unstamped
    // snapshot cannot be served as stale.
    if (provider.provider !== "codex" &&
        CONTEXT_SCOPED_PROVIDERS[provider.provider] &&
        !contextId)
        return undefined;
    return {
        snapshot,
        ...(contextId ? { credentialContextId: contextId } : {}),
    };
}
function missingRequiredContext(provider) {
    // Codex stamps are optional; Claude, Kimi, Command Code, MiniMax,
    // ElevenLabs, Devin, and Muse must not clear when the current reading has
    // no published context identity.
    if (provider === "codex")
        return false;
    const scope = CONTEXT_SCOPED_PROVIDERS[provider];
    return scope !== undefined && !scope({ provider });
}
function serializeCachedProvider(provider) {
    const subscription = provider.snapshot[SUBSCRIPTION_IDENTITY];
    return {
        ...provider.snapshot,
        ...(subscription ? { subscription } : {}),
        ...(provider.credentialContextId
            ? { credentialContext: provider.credentialContextId }
            : {}),
        ...(provider.reuse ? { reuse: provider.reuse } : {}),
    };
}
function normalizeReuseStamp(raw) {
    const data = objectValue(raw);
    const context = stringValue(data?.context);
    const inputs = stringArrayValue(data?.inputs);
    const digest = stringValue(data?.inputsDigest);
    const readingAt = stringValue(data?.readingAt);
    const lanes = numberValue(data?.lanes);
    const lane = numberValue(data?.lane);
    if (!data ||
        !context ||
        !CREDENTIAL_CONTEXT_ID.test(context) ||
        !inputs ||
        !digest ||
        !CREDENTIAL_CONTEXT_ID.test(digest) ||
        !readingAt ||
        lanes === undefined ||
        !Number.isInteger(lanes) ||
        lanes < 1 ||
        lane === undefined ||
        !Number.isInteger(lane) ||
        lane < 0 ||
        lane >= lanes)
        return undefined;
    const stamp = {
        context,
        inputs,
        inputsDigest: digest,
        readingAt,
        lanes,
        lane,
    };
    const accountKeys = stringArrayValue(data.accountKeys);
    const authStatus = literalValue(data.authStatus, AUTH_STATUSES);
    const degradedSources = Array.isArray(data.degradedSources)
        ? data.degradedSources.map(normalizeDegradedSource)
        : undefined;
    if (accountKeys && accountKeys.length > 0)
        stamp.accountKeys = accountKeys;
    const accountLocator = normalizeAccountLocator(data.accountLocator);
    if (accountLocator)
        stamp.accountLocator = accountLocator;
    if (authStatus)
        stamp.authStatus = authStatus;
    if (degradedSources?.length && degradedSources.every(Boolean))
        stamp.degradedSources = degradedSources;
    return stamp;
}
function normalizeAccountLocator(raw) {
    const data = objectValue(raw);
    const kind = stringValue(data?.kind);
    const path = stringValue(data?.path);
    if (!data || !kind || !path)
        return undefined;
    const locator = { kind, path };
    const keychainService = stringValue(data.keychainService);
    const delegateEligible = booleanValue(data.delegateEligible);
    if (keychainService)
        locator.keychainService = keychainService;
    if (delegateEligible !== undefined)
        locator.delegateEligible = delegateEligible;
    return locator;
}
function normalizeDegradedSource(raw) {
    const data = objectValue(raw);
    const source = stringValue(data?.source);
    if (!source)
        return undefined;
    const error = stringValue(data?.error);
    return error ? { source, error } : { source };
}
function normalizeCachedProvider(raw, schemaVersion) {
    const data = objectValue(raw);
    if (!data)
        return undefined;
    const provider = literalValue(data.provider, PROVIDER_IDS);
    const label = stringValue(data.label);
    const source = cachedSource(data.source);
    const state = objectValue(data.state);
    const status = literalValue(state?.status, PROVIDER_STATUSES);
    const sourcesTried = stringArrayValue(state?.sourcesTried);
    const windows = Array.isArray(data.windows)
        ? data.windows
            .map(normalizeCachedWindow)
            .filter((window) => Boolean(window))
            .map((window) => provider === "kimi" ? upgradeLegacyKimiShareWindow(window) : window)
        : [];
    if (!provider ||
        !label ||
        !source ||
        !state ||
        !status ||
        !sourcesTried ||
        windows.length === 0 ||
        (provider === "codex" && hasInvalidCodexWindowIdentities(windows)))
        return undefined;
    const accountKey = stringValue(data.accountKey);
    if (data.accountKey !== undefined &&
        (schemaVersion < 3 ||
            !accountKey ||
            !/^[a-z0-9][a-z0-9:_-]{0,95}$/.test(accountKey)))
        return undefined;
    const snapshot = {
        provider,
        ...(accountKey ? { accountKey } : {}),
        label,
        source,
        windows,
        state: {
            status,
            stale: booleanValue(state.stale) ?? false,
            sourcesTried,
        },
    };
    const plan = stringValue(data.plan);
    const refreshedAt = stringValue(state.refreshedAt);
    const untrustedWindowIds = stringArrayValue(state.untrustedWindowIds);
    const credits = normalizeCachedCredits(data.credits);
    const jobs = normalizeCachedJobs(data.jobs);
    if (data.jobs !== undefined && !jobs)
        return undefined;
    if (plan)
        snapshot.plan = plan;
    if (refreshedAt)
        snapshot.state.refreshedAt = refreshedAt;
    if (untrustedWindowIds)
        snapshot.state.untrustedWindowIds = untrustedWindowIds;
    if (credits)
        snapshot.credits = credits;
    const subscription = stringValue(data.subscription);
    if (subscription && CREDENTIAL_CONTEXT_ID.test(subscription))
        snapshot[SUBSCRIPTION_IDENTITY] =
            subscription;
    if (jobs)
        snapshot.jobs = jobs;
    const credentialContext = stringValue(data.credentialContext);
    const reuse = normalizeReuseStamp(data.reuse);
    return {
        snapshot,
        ...(reuse ? { reuse } : {}),
        ...(schemaVersion >= 2 &&
            snapshot.provider in CONTEXT_SCOPED_PROVIDERS &&
            credentialContext &&
            CREDENTIAL_CONTEXT_ID.test(credentialContext)
            ? { credentialContextId: credentialContext }
            : {}),
    };
}
function hasInvalidCodexWindowIdentities(windows) {
    const counts = new Map();
    for (const window of windows) {
        const baseId = codexWindowBaseIdentity(window);
        if (!baseId)
            return true;
        const count = (counts.get(baseId) ?? 0) + 1;
        counts.set(baseId, count);
        if (window.id !== (count === 1 ? baseId : `${baseId}_${count}`))
            return true;
    }
    return false;
}
function codexWindowBaseIdentity(window) {
    const id = window.id.replace(/_[2-9]\d*$/, "");
    if (window.windowSeconds === undefined) {
        if (matchesWindowIdentity(window, id, "spend_control", "workspace credit cap", "credits"))
            return id;
        if (matchesWindowIdentity(window, id, "five_hour", "session", "session"))
            return id;
        if (matchesWindowIdentity(window, id, "weekly", "week", "weekly"))
            return id;
        if (matchesWindowIdentity(window, id, "code_review_five_hour", "code review session", "session") ||
            matchesWindowIdentity(window, id, "code_review_weekly", "code review week", "weekly") ||
            matchesModelWindowIdentity(window, id, "5h", "session") ||
            matchesModelWindowIdentity(window, id, "7d", "week"))
            return id;
        return undefined;
    }
    if (window.windowSeconds === 18_000) {
        if (matchesWindowIdentity(window, id, "five_hour", "session", "session") ||
            matchesWindowIdentity(window, id, "code_review_five_hour", "code review session", "session") ||
            matchesModelWindowIdentity(window, id, "5h", "session"))
            return id;
        return undefined;
    }
    if (window.windowSeconds === 604_800) {
        if (matchesWindowIdentity(window, id, "weekly", "week", "weekly") ||
            matchesWindowIdentity(window, id, "code_review_weekly", "code review week", "weekly") ||
            matchesModelWindowIdentity(window, id, "7d", "week"))
            return id;
        return undefined;
    }
    const duration = readableWindowDuration(window.windowSeconds);
    if (matchesWindowIdentity(window, id, `window:${duration}`, `${duration} window`, "unknown") ||
        matchesWindowIdentity(window, id, `code_review_window:${duration}`, `${duration} window`, "unknown") ||
        matchesModelWindowIdentity(window, id, `window:${duration}`, `${duration} window`))
        return id;
    return undefined;
}
function matchesWindowIdentity(window, actualId, expectedId, label, kind) {
    return (actualId === expectedId && window.label === label && window.kind === kind);
}
function matchesModelWindowIdentity(window, id, suffix, labelSuffix) {
    return (id.startsWith("model:") &&
        id.endsWith(`:${suffix}`) &&
        id.length > `model::${suffix}`.length &&
        window.label.endsWith(` ${labelSuffix}`) &&
        window.label.length > labelSuffix.length + 1 &&
        window.kind === "model");
}
function readableWindowDuration(windowSeconds) {
    const hours = windowSeconds / 3600;
    return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(2))}h`;
}
function normalizeCachedWindow(raw) {
    const data = objectValue(raw);
    if (!data)
        return undefined;
    const id = stringValue(data.id);
    const label = stringValue(data.label);
    const kind = literalValue(data.kind, WINDOW_KINDS);
    if (!id || !label || !kind)
        return undefined;
    const result = { id, label, kind };
    assignNumber(result, "percentUsed", data.percentUsed);
    assignNumber(result, "percentRemaining", data.percentRemaining);
    assignString(result, "shareOf", data.shareOf);
    assignString(result, "startsAt", data.startsAt);
    assignString(result, "resetsAt", data.resetsAt);
    assignString(result, "resetText", data.resetText);
    assignNumber(result, "windowSeconds", data.windowSeconds);
    assignNumber(result, "spentUsd", data.spentUsd);
    assignNumber(result, "limitUsd", data.limitUsd);
    assignNumber(result, "limitCredits", data.limitCredits);
    assignNumber(result, "usedCredits", data.usedCredits);
    assignNumber(result, "remainingCredits", data.remainingCredits);
    assignString(result, "creditUnit", data.creditUnit);
    return result;
}
// Kimi snapshots cached before `shareOf` existed store `month_code` with only
// `percentUsed`. `shareOf` is the sole share rule, so restore the marker on
// read; otherwise a stale fallback would render that share as missing data.
function upgradeLegacyKimiShareWindow(window) {
    return window.id === "month_code" &&
        window.shareOf === undefined &&
        window.percentUsed !== undefined
        ? { ...window, shareOf: "month_total" }
        : window;
}
function normalizeCachedCredits(raw) {
    const data = objectValue(raw);
    if (!data)
        return undefined;
    const remaining = numberValue(data.remaining);
    const unlimited = booleanValue(data.unlimited);
    const unit = literalValue(data.unit, ["usd", "cny", "credits"]);
    if (remaining === undefined && unlimited === undefined && unit === undefined)
        return undefined;
    return {
        remaining,
        unlimited,
        unit,
    };
}
function normalizeCachedJobs(raw) {
    const data = objectValue(raw);
    if (!data)
        return undefined;
    const sampled = numberValue(data.sampled);
    const completed = numberValue(data.completed);
    const failed = numberValue(data.failed);
    const other = numberValue(data.other);
    if (sampled === undefined ||
        completed === undefined ||
        failed === undefined ||
        other === undefined ||
        ![sampled, completed, failed, other].every(Number.isSafeInteger) ||
        sampled < 0 ||
        completed < 0 ||
        failed < 0 ||
        other < 0 ||
        sampled !== completed + failed + other)
        return undefined;
    return { sampled, completed, failed, other };
}
function assignNumber(target, key, value) {
    const number = numberValue(value);
    if (number !== undefined)
        target[key] = number;
}
function assignString(target, key, value) {
    const string = stringValue(value);
    if (string !== undefined)
        target[key] = string;
}
function objectValue(value) {
    return value && typeof value === "object"
        ? value
        : undefined;
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}
function booleanValue(value) {
    return typeof value === "boolean" ? value : undefined;
}
function stringArrayValue(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : undefined;
}
function cachedSource(value) {
    const source = stringValue(value);
    if (!source)
        return undefined;
    if (PROVIDER_SOURCES.includes(source)) {
        return source;
    }
    return isPiCodexSource(source) ? source : undefined;
}
function literalValue(value, values) {
    return typeof value === "string" && values.includes(value)
        ? value
        : undefined;
}
