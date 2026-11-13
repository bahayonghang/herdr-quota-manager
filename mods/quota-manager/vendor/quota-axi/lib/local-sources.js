// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { Buffer } from "buffer";
import { localQueryRuntime } from "../runtime.js";

let lastDaemon = null;
const QUOTA_PATH = "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary";

function bounded(runtime, work, ms) {
  return typeof runtime.deadline === "function" ? runtime.deadline(work, ms) : work;
}

function jsonRequest(runtime, url, options, limit, ms) {
  // Capture the transport and timer before any await; a timed-out request may
  // settle after another provider has acquired the serialized runtime context.
  const fetchImpl = runtime.fetch;
  const work = (async () => {
    const response = await fetchImpl(url, options);
    const ok = response.ok ?? (response.status >= 200 && response.status < 300);
    let data = null;
    if (ok) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > limit) throw new Error("response_too_large");
      data = JSON.parse(text);
    }
    return { status: response.status, ok, data,
      headers: { get: name => response.headers?.get?.(name) ?? null } };
  })();
  return bounded(runtime, work, ms);
}

export function fetchLocalJson(url, options, limit, ms) {
  return jsonRequest(localQueryRuntime(), url, options, limit, ms);
}

export async function readLocalAgyQuota(normalize) {
  const runtime = localQueryRuntime();
  if (!runtime.home) throw new Error("agy_daemon_unavailable");
  const directory = join(runtime.home, ".gemini", "antigravity", "daemon");
  let stopped = false;
  const discovery = (async () => {
    const names = (await readdir(directory)).filter(name => /^hub_[1-9]\d{0,4}\.json$/.test(name)).sort();
    if (stopped) throw new Error("provider_timeout");
    if (names.length > 256) throw new Error("agy_discovery_limit");
    if (!names.length) throw new Error("agy_daemon_unavailable");
    if (lastDaemon?.home === runtime.home && names.includes(lastDaemon.name)) {
      names.splice(names.indexOf(lastDaemon.name), 1);
      names.unshift(lastDaemon.name);
    }
    let next = 0;
    return new Promise((resolve, reject) => {
      const worker = async () => {
        while (!stopped && next < names.length) {
          const name = names[next++];
          try {
            const text = await readFile(join(directory, name), "utf8");
            if (stopped) return;
            if (Buffer.byteLength(text, "utf8") > 16384) continue;
            const state = JSON.parse(text);
            const port = Number(name.slice(4, -5));
            if (!Number.isInteger(port) || port < 1 || port > 65535 || state.httpPort !== port ||
                !Number.isInteger(state.pid) || state.pid <= 0 || typeof state.csrfToken !== "string" ||
                !state.csrfToken.length || state.csrfToken.length > 4096 || /[\r\n]/.test(state.csrfToken)) continue;
            const response = await jsonRequest(runtime, "http://127.0.0.1:" + port + QUOTA_PATH, {
              method: "POST", headers: { accept: "application/json", "content-type": "application/json",
                "connect-protocol-version": "1", "x-codeium-csrf-token": state.csrfToken },
              body: JSON.stringify({ request: {}, forceRefresh: false }),
            }, 262144, 1000);
            if (stopped || !response.ok) continue;
            const quota = normalize(response.data);
            if (!quota?.windows?.length) continue;
            lastDaemon = { home: runtime.home, name };
            stopped = true;
            resolve(quota);
          } catch { /* Malformed or stale daemon state is not installation evidence. */ }
        }
      };
      Promise.all(Array.from({ length: Math.min(4, names.length) }, worker)).then(() => {
        if (!stopped) reject(new Error("agy_daemon_unavailable"));
      }, reject);
    });
  })();
  try {
    return await bounded(runtime, discovery, 10000);
  } finally {
    stopped = true;
  }
}
