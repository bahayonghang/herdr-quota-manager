// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
/**
 * Shared credential-selection machinery.
 *
 * Contract: a stored expiry field is advisory ordering metadata, never a
 * verdict. Only an empirical, bounded, read-only attempt against the
 * provider's own first-party endpoint may produce a definitive negative
 * authentication result. This generalizes the long-standing Claude contract
 * ("local `expiresAt` metadata is advisory; HTTP 401/403 is the definitive
 * authentication result") so no provider reports expired or sign-in-required
 * while a credential it can read is verifiably live.
 *
 * Each provider declares ordered credential candidates plus an attempt
 * function; `selectCredential`:
 *
 * 1. tries candidates whose stored metadata says they are valid first, in
 *    declared order;
 * 2. then, instead of declaring the provider expired, tries candidates whose
 *    stored metadata says they are expired (the attempt doubles as the
 *    liveness probe);
 * 3. stops at the first `quota` outcome - fresh provider data is the best
 *    possible result;
 * 4. records a `live_no_quota` outcome as an established usability floor and
 *    keeps going, because a later candidate may still yield quota windows;
 * 5. stops on a `transient` outcome without trying further candidates, so
 *    transport, decoding, and server failures never trigger credential
 *    switching or masquerade as authentication verdicts;
 * 6. continues past `rejected` outcomes to the next candidate.
 *
 * Verdict merge: any empirical success wins. Otherwise a transient outcome
 * keeps the provider transient (stored-metadata classification stands, and
 * stale-cache fallback stays available). Only when every try-able candidate
 * is empirically rejected, or nothing is try-able at all, may the provider
 * be declared expired or signed out, with refresh-path presence preserved so
 * soft expiry is never reported as sign-out.
 *
 * Secret hygiene by construction: credential values flow only from a
 * candidate into the provider's attempt function. Every output shape
 * (`SelectedCandidate`, `CandidateResult`, `CredentialSelection`) carries
 * source names, local states, and error strings - never credential material.
 */
export async function selectCredential(candidates, attempt) {
    const ordered = [
        ...candidates.filter((candidate) => candidate.localState === "valid"),
        ...candidates.filter((candidate) => candidate.localState === "expired"),
    ];
    const resultBySource = new Map();
    for (const candidate of ordered) {
        resultBySource.set(candidate, {
            ...selectedCandidate(candidate),
            outcome: "not_tried",
        });
    }
    const orderedResults = () => ordered.map((candidate) => resultBySource.get(candidate));
    let liveWinner;
    let transientError;
    let retryAfter;
    let tried = 0;
    let rejectedCount = 0;
    for (const candidate of ordered) {
        tried += 1;
        let outcome;
        try {
            outcome = await attempt(candidate);
        }
        catch {
            // An attempt crash is transport-class trouble, never an auth verdict.
            outcome = { kind: "transient", error: "credential_attempt_failed" };
        }
        const record = resultBySource.get(candidate);
        record.outcome = outcome.kind;
        if (outcome.kind === "quota") {
            return {
                outcome: "quota",
                winner: selectedCandidate(candidate),
                result: outcome.result,
                refreshable: false,
                results: orderedResults(),
            };
        }
        if (outcome.kind === "live_no_quota") {
            liveWinner ??= selectedCandidate(candidate);
            continue;
        }
        if (outcome.kind === "rejected") {
            record.error = outcome.error;
            rejectedCount += 1;
            continue;
        }
        record.error = outcome.error;
        record.retryAfter = outcome.retryAfter;
        transientError = outcome.error;
        retryAfter = outcome.retryAfter;
        break;
    }
    const results = orderedResults();
    const refreshable = results.some((result) => result.refreshable === true &&
        (result.outcome === "rejected" || result.outcome === "not_tried"));
    if (liveWinner) {
        return {
            outcome: "live_no_quota",
            winner: liveWinner,
            transientError,
            retryAfter,
            refreshable,
            results,
        };
    }
    if (transientError !== undefined) {
        return {
            outcome: "transient",
            transientError,
            retryAfter,
            refreshable,
            results,
        };
    }
    if (tried > 0 && rejectedCount === tried) {
        return { outcome: "all_rejected", refreshable, results };
    }
    return { outcome: "no_candidates", refreshable, results };
}
function selectedCandidate(candidate) {
    return {
        source: candidate.source,
        localState: candidate.localState,
        ...(candidate.refreshable !== undefined
            ? { refreshable: candidate.refreshable }
            : {}),
    };
}
