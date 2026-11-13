// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { createHash } from "crypto";
// The stamp follows this reading through object spreads without entering JSON,
// TOON, or other serialized output. It never re-reads a mutable credential file.
const ZAI_READING_CONTEXT = Symbol("zaiReadingContext");
export function stampZaiReadingContext(provider, contextId) {
    provider[ZAI_READING_CONTEXT] = contextId;
    return provider;
}
export function zaiReadingContextId(provider) {
    return provider[ZAI_READING_CONTEXT];
}
// A key, rather than its file or source name, identifies the account. The same
// key can answer through either store, while a rotated key cannot inherit quota.
export function zaiCacheContextId(credential) {
    return createHash("sha256")
        .update(`zai-credential-v1\0${credential}`)
        .digest("hex");
}
