// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
export function classifyPiAuthEntry(parsed, providerId) {
    if (!isObject(parsed))
        return { status: "invalid" };
    if (!Object.hasOwn(parsed, providerId))
        return { status: "missing" };
    const entry = parsed[providerId];
    return isObject(entry) ? { status: "present", entry } : { status: "invalid" };
}
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
