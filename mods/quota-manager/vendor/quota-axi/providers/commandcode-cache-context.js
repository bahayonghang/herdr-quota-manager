// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { createHash } from "crypto";
/**
 * The cache identity the Command Code reading this process produced belongs
 * to, or `undefined` when nothing has claimed one yet.
 *
 * Command Code has several local sources that can point at different
 * accounts. The cache writer reads this stamp rather than deriving an identity
 * for itself, so a snapshot is reused only for the source and account the
 * current `whoami` actually identified.
 */
let readingContextId;
/**
 * Claims the identity a snapshot written from here on belongs to. Publish
 * only after `whoami` identifies the current account.
 */
export function publishCommandCodeReadingContextId(contextId) {
    readingContextId = contextId;
}
/** Drop any previously published identity so a later reading cannot inherit it. */
export function clearCommandCodeReadingContextId() {
    readingContextId = undefined;
}
export function commandCodeReadingContextId() {
    return readingContextId;
}
/**
 * Opaque SHA-256 of the winning source plus the current-account identity.
 * The hash input never enters the cache.
 */
export function commandCodeCacheContextId(source, accountIdentity) {
    return createHash("sha256")
        .update(`commandcode\0${source}\0${accountIdentity}`)
        .digest("hex");
}
