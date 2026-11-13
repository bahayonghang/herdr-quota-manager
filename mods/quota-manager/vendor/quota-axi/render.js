// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
export function redactedResponse(response, full) {
    if (full)
        return response;
    return {
        ...response,
        providers: response.providers.map((provider) => ({
            ...provider,
            account: undefined,
            accountLocator: undefined,
            attempts: undefined,
        })),
    };
}
/**
 * The `--json` payload: redaction plus derivation-input demotion. Structure and
 * field names are untouched - a demoted field is simply absent until `--full`.
 * Eligibility and uncertainty fields are never demoted, so an unknown can never
 * read as healthy.
 */
export function quotaJsonReport(response, full, laneAbsent = []) {
    const redacted = redactedResponse(markNotSetUp(response, laneAbsent), full);
    if (full)
        return redacted;
    return {
        ...redacted,
        providers: redacted.providers.map((provider) => ({
            ...provider,
            label: undefined,
            source: undefined,
            windows: provider.windows.map(demotedWindow),
            ...(provider.quotaSemantics
                ? { quotaSemantics: demotedSemantics(provider.quotaSemantics) }
                : {}),
            state: {
                ...provider.state,
                // A reused reading's age is load-bearing, so its fetch time stays.
                refreshedAt: provider.state.reused
                    ? provider.state.refreshedAt
                    : undefined,
                sourcesTried: undefined,
            },
        })),
    };
}
/**
 * Sparse `notSetUp: true` on lanes the caller already classified absent.
 * The flags are computed before redaction strips `attempts`. An empty list
 * leaves the model untouched, so a caller that has not classified adds nothing.
 */
function markNotSetUp(response, laneAbsent) {
    if (!laneAbsent.some(Boolean))
        return response;
    return {
        ...response,
        providers: response.providers.map((provider, index) => laneAbsent[index] ? { ...provider, notSetUp: true } : provider),
    };
}
function demotedWindow(window) {
    return {
        ...window,
        percentUsed: window.shareOf === undefined ? undefined : window.percentUsed,
        startsAt: undefined,
        windowSeconds: undefined,
        ...(window.pace
            ? {
                pace: {
                    // Kept: `reason` is uncertainty, reserve and burn are tie-break
                    // evidence. Dropped: the inputs those two are derived from.
                    status: window.pace.status,
                    ...(window.pace.reason ? { reason: window.pace.reason } : {}),
                    reservePercentPoints: window.pace.reservePercentPoints,
                    burnMultiple: window.pace.burnMultiple,
                },
            }
            : {}),
    };
}
function demotedSemantics(semantics) {
    return {
        ...semantics,
        description: undefined,
        effectiveAvailability: semantics.effectiveAvailability.map((availability) => ({
            ...availability,
            ...(availability.pace
                ? {
                    pace: {
                        ...availability.pace,
                        behindWindowIds: undefined,
                        onPaceWindowIds: undefined,
                    },
                }
                : {}),
        })),
    };
}
