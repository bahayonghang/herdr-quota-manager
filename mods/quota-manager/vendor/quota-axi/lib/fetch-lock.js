// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
export function fetchLockPath(cacheDir = "") { return `${cacheDir}/fetch.lock`; }
export function fetchLockPathFor(provider) { return `lock:${provider}`; }
export function withLockSync(_lockPath, fn) { return fn(); }
export async function takeFetchTurn(_lockPath, checkReusable) {
  const value = checkReusable ? checkReusable() : undefined;
  return value !== undefined ? { kind: "answered", value } : { kind: "unlocked" };
}
