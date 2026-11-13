// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { isDegradedSourceAttempt } from "../lib/source-attempts.js";
import { percentRemaining } from "../lib/time.js";
export function withRemaining(window) {
    return {
        ...window,
        percentRemaining: percentRemaining(window.percentUsed),
    };
}
export function successProvider(provider) {
    const { refreshedAt, sourcesTried, ...rest } = provider;
    return {
        ...rest,
        state: {
            status: "fresh",
            stale: false,
            refreshedAt,
            sourcesTried,
        },
    };
}
export function failedProvider(args) {
    return {
        provider: args.provider,
        label: args.label,
        source: args.source ?? "unavailable",
        windows: [],
        state: {
            status: args.status,
            stale: false,
            error: args.error,
            retryAfter: args.retryAfter,
            sourcesTried: args.sourcesTried,
        },
        attempts: args.attempts,
    };
}
const FIVE_HOURS_SECONDS = 5 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
/** The shortest calendar month, so no monthly cycle can end sooner. */
const SHORTEST_MONTH_SECONDS = 28 * 24 * 60 * 60;
/**
 * The cached windows a stale fallback may still present at `now`.
 *
 * A window whose own reported reset is at or before `now` belongs to a cycle
 * the vendor has already ended, so its figures have stopped being true and it
 * is dropped. A window without a usable reset is kept only while the snapshot
 * is younger than the shortest cycle its duration or kind admits: after that
 * long a reset has certainly happened, even though the vendor never said when.
 * A resetless window with no known cycle length (credits balances, model or
 * unknown windows without `windowSeconds`) has no age at which that holds, so
 * it is dropped rather than given an invented shelf life, and so is every
 * resetless window when the snapshot's `refreshedAt` cannot be read. A
 * `refreshedAt` after `now` means the clock moved backwards since the write,
 * so the snapshot's age is unknowable and nothing is served.
 */
export function servableStaleWindows(cached, now, resetless = "age_bound") {
    const refreshedAt = cached.state.refreshedAt
        ? Date.parse(cached.state.refreshedAt)
        : Number.NaN;
    if (refreshedAt > now)
        return [];
    const ageMilliseconds = now - refreshedAt;
    return cached.windows.filter((window) => {
        const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
        if (Number.isFinite(resetsAt))
            return resetsAt > now;
        if (resetless === "never" || !Number.isFinite(refreshedAt))
            return false;
        const maxAgeSeconds = resetlessStaleMaxAgeSeconds(window);
        return maxAgeSeconds > 0 && ageMilliseconds < maxAgeSeconds * 1_000;
    });
}
/**
 * The cached `untrustedWindowIds` a stale report built from `windows` may
 * still carry: an id naming a cached window the stale filter dropped goes with
 * it, while an id that never named a cached window (such as Kimi's
 * `usages:<key>` marker for a declared entry with no usable ratio) stays,
 * because it still keeps the account bound partial.
 */
export function servableUntrustedWindowIds(cached, windows) {
    const served = new Set(windows.map(({ id }) => id));
    const dropped = new Set(cached.windows.map(({ id }) => id).filter((id) => !served.has(id)));
    const ids = cached.state.untrustedWindowIds?.filter((id) => !dropped.has(id));
    return ids && ids.length > 0 ? ids : undefined;
}
/**
 * The longest a resetless window can be served from cache: its own declared
 * duration, else the shortest cycle its kind admits, else zero (never).
 */
export function resetlessStaleMaxAgeSeconds(window) {
    if (window.windowSeconds !== undefined && window.windowSeconds > 0) {
        return window.windowSeconds;
    }
    switch (window.kind) {
        case "session":
            return FIVE_HOURS_SECONDS;
        case "weekly":
            return WEEK_SECONDS;
        case "monthly":
            return SHORTEST_MONTH_SECONDS;
        default:
            return 0;
    }
}
/**
 * A definitive sign-out retires the snapshot and returns undefined, so the
 * caller reports the same failure it would with no cache. Soft expiry and
 * transport failures stay eligible for {@link staleFromCache}, and so does a
 * sign-out while a present store was skipped unprobed: only a credential the
 * vendor rejected, or no credential at all, proves the snapshot's login gone.
 * A skip on an incidental source (another tool's login) is no such store.
 */
export function staleUnlessSignOut(cached, error, sourcesTried, attempts, signOut, now = Date.now()) {
    if (signOut.definitive &&
        !attempts.some((attempt) => attempt.status === "skipped" &&
            !signOut.incidentalSources?.includes(attempt.source) &&
            isDegradedSourceAttempt(attempt))) {
        try {
            signOut.retire();
        }
        catch {
            // The sign-out stands when the cache cannot be rewritten.
        }
        return undefined;
    }
    return cached
        ? staleFromCache(cached, error, sourcesTried, attempts, now)
        : undefined;
}
/**
 * Serve a cached snapshot as a stale reading of the current failure, keeping
 * only the windows {@link servableStaleWindows} still allows. Returns
 * `undefined` when none survive, so the caller reports the failed read exactly
 * as it would with no cache at all.
 */
export function staleFromCache(cached, error, sourcesTried, attempts, now = Date.now()) {
    const windows = servableStaleWindows(cached, now);
    if (windows.length === 0)
        return undefined;
    const state = {
        ...cached.state,
        status: "stale",
        stale: true,
        error,
        sourcesTried: [...new Set([...sourcesTried, "cache"])],
    };
    const untrustedWindowIds = servableUntrustedWindowIds(cached, windows);
    if (untrustedWindowIds)
        state.untrustedWindowIds = untrustedWindowIds;
    else
        delete state.untrustedWindowIds;
    return { ...cached, source: "cache", windows, state, attempts };
}
export function statusFromError(error) {
    if (error === "keychain_prompt_required" ||
        error === "credentials_expired" ||
        /sign-in|required|reauth|access token expired/i.test(error))
        return "auth_required";
    if (/rate.?limit/i.test(error))
        return "rate_limited";
    return "error";
}
/**
 * Attempt order, deduplicated: a source can be attempted twice in one run (a
 * credential store re-read after a delegated refresh), and `sourcesTried`
 * names which sources were tried, not how many times.
 */
export function sourceNames(attempts) {
    return [...new Set(attempts.map((attempt) => attempt.source))];
}
