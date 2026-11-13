// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { Buffer } from "buffer";
import { currentFetch } from "../runtime.js";

export const PROVIDER_RESPONSE_LIMIT_BYTES = 262_144;

function normalizeHeaders(headers) {
  if (!headers) return undefined;
  if (typeof headers.entries === "function") return Object.fromEntries(headers.entries());
  if (typeof headers === "object") {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined) out[k] = String(v);
    }
    return out;
  }
  return undefined;
}

function wrapHeaders(headers) {
  if (headers && typeof headers.get === "function") return headers;
  if (headers && typeof headers === "object") {
    return {
      get(name) {
        const lower = String(name).toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === lower) return String(v);
        }
        return null;
      },
    };
  }
  return { get: () => null };
}

export async function providerFetch(input, init = {}) {
  const fetchFn = currentFetch();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const opts = {};
  if (init.method) opts.method = init.method;
  const headers = normalizeHeaders(init.headers);
  if (headers) opts.headers = headers;
  if (init.body !== undefined) opts.body = init.body;
  const response = await fetchFn(url, opts);
  return {
    status: response.status,
    ok: response.ok ?? (response.status >= 200 && response.status < 300),
    url: response.url ?? url,
    headers: wrapHeaders(response.headers),
    text: () => response.text(),
    json: async () => {
      if (typeof response.text === "function") {
        const t = await response.text();
        if (Buffer.byteLength(t, "utf8") > PROVIDER_RESPONSE_LIMIT_BYTES) throw new Error("response_too_large");
        return JSON.parse(t);
      }
      return response.json();
    },
    body: response.body,
  };
}

export async function readBoundedResponseBody(response, signal, fail) {
  if (signal?.aborted) throw fail("provider_timeout");
  const declared = response.headers?.get?.("content-length")?.trim();
  if (declared && /^\d+$/.test(declared) && Number(declared) > PROVIDER_RESPONSE_LIMIT_BYTES) {
    await response.body?.cancel?.().catch(() => undefined);
    throw fail("response_too_large");
  }
  if (typeof response.text === "function") {
    const text = await response.text();
    if (signal?.aborted) throw fail("provider_timeout");
    const bytes = Buffer.from(text, "utf8");
    if (bytes.byteLength > PROVIDER_RESPONSE_LIMIT_BYTES) throw fail("response_too_large");
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (!response.body?.getReader) throw fail("response_size_unverifiable");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      if (signal?.aborted) throw fail("provider_timeout");
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > PROVIDER_RESPONSE_LIMIT_BYTES) throw fail("response_too_large");
      chunks.push(result.value);
    }
  } finally {
    void reader.cancel?.().catch(() => undefined);
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
