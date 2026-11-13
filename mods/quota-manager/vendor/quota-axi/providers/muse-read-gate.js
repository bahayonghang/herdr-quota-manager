// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { chmodSync, renameSync, writeFileSync, runtimeProcess } from "../runtime.js";
import { withLockSync } from "../lib/fetch-lock.js";
import { ensurePrivateParent, museKeyReadLedgerPath, readUntracedJsonFile, } from "../lib/fs.js";
/**
 * The shortest interval between two Muse key-endpoint requests for the same
 * credential.
 *
 * Muse's only quota read is the call its CLI makes at startup, and that call
 * returns the account's Model API key - verified (2026-09-24, Muse Code 1.3.0)
 * to be the identical standing key on consecutive calls, but issued on first
 * use with no documented rotation cadence. quota-axi therefore treats every
 * request as an action on a credential it does not own, and bounds it: one
 * request per credential per interval, whatever the outcome, across every
 * quota-axi process sharing the cache directory. The interval check and the
 * `pending` claim are one locked step; a claim that cannot be recorded does
 * not send. Inside the interval the adapter replays what the last request
 * established - its own cached reading, its empty successful observation, its
 * rejection, or a deferred read - and sends nothing. The interval equals the
 * `--tui` default refresh, so a live report issues at most one request per
 * refresh and a burst of agent calls issues one request in total.
 */
export const MUSE_KEY_READ_INTERVAL_MS = 5 * 60_000;
const LEDGER_SCHEMA_VERSION = 1;
const CONTEXT_ID = /^[a-f0-9]{64}$/;
const OUTCOMES = [
    "pending",
    "quota",
    "rejected",
    "transient",
];
export function createFileMuseKeyReadLedger(path = museKeyReadLedgerPath, now = Date.now) {
    return {
        recent(contextId, at) {
            const read = readLedger(path()).get(contextId);
            return read && withinInterval(read, at) ? read : undefined;
        },
        record(contextId, read) {
            if (!CONTEXT_ID.test(contextId))
                return;
            const file = path();
            withLockedLedger(file, () => {
                writeEntry(file, contextId, read, now());
            });
        },
        claim(contextId, at) {
            if (!CONTEXT_ID.test(contextId))
                return { kind: "unwritable" };
            const file = path();
            try {
                return withLockedLedger(file, () => {
                    const existing = readLedger(file).get(contextId);
                    if (existing && withinInterval(existing, at))
                        return { kind: "recent", read: existing };
                    writeEntry(file, contextId, { attemptedAt: at, outcome: "pending" }, now());
                    return { kind: "claimed" };
                });
            }
            catch {
                return { kind: "unwritable" };
            }
        },
    };
}
/**
 * Serialize every ledger mutation. The command-level fetch lock is not held
 * when `--max-age` is unset, so this is the gate that keeps two processes from
 * both seeing an empty interval and both POSTing. Fail closed: if the lock
 * cannot be taken, the caller must not send.
 */
function withLockedLedger(file, fn) {
    return withLockSync(`${file}.lock`, fn, { onUnavailable: "throw" });
}
function writeEntry(file, contextId, read, now) {
    const reads = new Map([...readLedger(file)].filter(([, entry]) => withinInterval(entry, now)));
    reads.set(contextId, persistedRead(read));
    writeLedger(file, reads);
}
/**
 * A request inside the interval on either side of `now`. A timestamp ahead of
 * the clock (the clock moved back) still gates for at most one interval rather
 * than forever, and never opens the gate early.
 */
function withinInterval(read, now) {
    return Math.abs(now - read.attemptedAt) < MUSE_KEY_READ_INTERVAL_MS;
}
function readLedger(file) {
    const reads = new Map();
    const payload = objectValue(readUntracedJsonFile(file));
    if (!payload || payload.schemaVersion !== LEDGER_SCHEMA_VERSION)
        return reads;
    const entries = objectValue(payload.reads);
    if (!entries)
        return reads;
    for (const [contextId, raw] of Object.entries(entries)) {
        const entry = objectValue(raw);
        if (!entry)
            continue;
        const attemptedAt = typeof entry.attemptedAt === "string"
            ? Date.parse(entry.attemptedAt)
            : Number.NaN;
        const outcome = OUTCOMES.find((value) => value === entry.outcome);
        if (!CONTEXT_ID.test(contextId) ||
            !Number.isFinite(attemptedAt) ||
            !outcome)
            continue;
        const emptyQuota = outcome === "quota" ? parseEmptyQuota(entry.emptyQuota) : undefined;
        reads.set(contextId, {
            attemptedAt,
            outcome,
            ...(emptyQuota ? { emptyQuota } : {}),
        });
    }
    return reads;
}
function writeLedger(file, reads) {
    ensurePrivateParent(file);
    const temp = `${file}.${runtimeProcess.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        reads: Object.fromEntries([...reads].map(([contextId, read]) => [
            contextId,
            {
                attemptedAt: new Date(read.attemptedAt).toISOString(),
                outcome: read.outcome,
                ...(read.emptyQuota
                    ? { emptyQuota: serializeEmptyQuota(read.emptyQuota) }
                    : {}),
            },
        ])),
    }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, file);
    chmodSync(file, 0o600);
}
function persistedRead(read) {
    const emptyQuota = read.outcome === "quota" ? copyEmptyQuota(read.emptyQuota) : undefined;
    return {
        attemptedAt: read.attemptedAt,
        outcome: read.outcome,
        ...(emptyQuota ? { emptyQuota } : {}),
    };
}
function copyEmptyQuota(empty) {
    if (!empty || !Number.isFinite(empty.refreshedAt))
        return undefined;
    const plan = nonemptyString(empty.plan);
    const untrustedWindowIds = parseUntrustedWindowIds(empty.untrustedWindowIds);
    return {
        refreshedAt: empty.refreshedAt,
        ...(plan ? { plan } : {}),
        ...(untrustedWindowIds ? { untrustedWindowIds } : {}),
    };
}
function serializeEmptyQuota(empty) {
    return {
        refreshedAt: new Date(empty.refreshedAt).toISOString(),
        ...(empty.plan ? { plan: empty.plan } : {}),
        ...(empty.untrustedWindowIds && empty.untrustedWindowIds.length > 0
            ? { untrustedWindowIds: [...empty.untrustedWindowIds] }
            : {}),
    };
}
function parseEmptyQuota(raw) {
    const entry = objectValue(raw);
    if (!entry)
        return undefined;
    const refreshedAt = typeof entry.refreshedAt === "string"
        ? Date.parse(entry.refreshedAt)
        : Number.NaN;
    if (!Number.isFinite(refreshedAt))
        return undefined;
    const plan = nonemptyString(entry.plan);
    const untrustedWindowIds = parseUntrustedWindowIds(entry.untrustedWindowIds);
    return {
        refreshedAt,
        ...(plan ? { plan } : {}),
        ...(untrustedWindowIds ? { untrustedWindowIds } : {}),
    };
}
function parseUntrustedWindowIds(value) {
    if (!Array.isArray(value))
        return undefined;
    const ids = value.flatMap((id) => {
        const text = nonemptyString(id);
        return text ? [text] : [];
    });
    return ids.length > 0 ? ids : undefined;
}
function nonemptyString(value) {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
function objectValue(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
