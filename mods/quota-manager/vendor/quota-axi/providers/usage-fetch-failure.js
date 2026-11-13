// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
const USAGE_FETCH_FAILURE = Symbol("usageFetchFailure");
export function withUsageFetchFailure(provider) {
    const evidence = {
        ...provider,
        [USAGE_FETCH_FAILURE]: true,
    };
    return evidence;
}
export function isUsageFetchFailure(provider) {
    return provider[USAGE_FETCH_FAILURE] === true;
}
