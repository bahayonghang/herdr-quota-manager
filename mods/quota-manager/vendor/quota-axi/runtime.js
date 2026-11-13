// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { mkdir, readFile as hostReadFile, unlink as hostUnlink, writeFile as hostWriteFile } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import { Buffer } from "buffer";
import {
  basename, delimiter, dirname, extname, format, isAbsolute, join, normalize, parse, relative, resolve, sep,
} from "path";
import { platform as hostOsPlatform } from "os";

export class AxiError extends Error {
  constructor(message, code = "INTERNAL_ERROR", help = []) {
    super(message);
    this.name = "AxiError";
    this.code = code;
    this.help = help;
  }
}

function mapPlatform(value) {
  if (value === "windows" || value === "win32") return "win32";
  if (value === "macos" || value === "darwin") return "darwin";
  if (value === "linux") return "linux";
  try {
    const osPlat = hostOsPlatform();
    if (osPlat === "windows" || osPlat === "win32") return "win32";
    if (osPlat === "macos" || osPlat === "darwin") return "darwin";
    return osPlat || "linux";
  } catch {
    return "linux";
  }
}

function trimEndSep(p) {
  return String(p || "").replace(/[\\/]+$/, "");
}

function normKey(filePath, plat) {
  const s = String(filePath || "").replace(/\\/g, "/").replace(/\/+/g, "/");
  return plat === "win32" ? s.toLowerCase() : s;
}

function winIsAbsolute(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("/");
}
function winJoin(...parts) {
  return parts.filter(Boolean).join("\\").replace(/\\+/g, "\\");
}
function winDirname(p) {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx <= 0 ? (p.slice(0, 2) || ".") : p.slice(0, idx);
}
function winBasename(p) {
  const clean = trimEndSep(p);
  const idx = Math.max(clean.lastIndexOf("\\"), clean.lastIndexOf("/"));
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}
function winExtname(p) {
  const base = winBasename(p);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

export const win32 = {
  isAbsolute: winIsAbsolute,
  join: winJoin,
  resolve: (...parts) => winJoin(...parts),
  dirname: winDirname,
  basename: winBasename,
  extname: winExtname,
  sep: "\\",
  delimiter: ";",
};

export const posix = {
  basename, delimiter: ":", dirname, extname, format, isAbsolute, join, normalize, parse, relative, resolve, sep: "/",
};

export { basename, delimiter, dirname, extname, format, isAbsolute, join, normalize, parse, relative, resolve, sep };

export const runtimePath = {
  basename, delimiter, dirname, extname, format, isAbsolute, join, normalize, parse, relative, resolve, sep, win32, posix,
};

let mutex = Promise.resolve();
let active = null;

function buildSyntheticEnv(cleanHome, cacheBase, plat, snapshot, extraEnv) {
  const env = {
    HOME: cleanHome,
    USERPROFILE: cleanHome,
    XDG_CACHE_HOME: cacheBase,
  };
  if (plat === "win32" && cleanHome) {
    const roaming = join(cleanHome, "AppData", "Roaming");
    const local = join(cleanHome, "AppData", "Local");
    env.APPDATA = roaming;
    env.AppData = roaming;
    env.LOCALAPPDATA = local;
  }
  if (plat !== "win32" && cleanHome) {
    env.XDG_CONFIG_HOME = join(cleanHome, ".config");
    env.XDG_DATA_HOME = join(cleanHome, ".local", "share");
    env.XDG_STATE_HOME = join(cleanHome, ".local", "state");
  }
  if (snapshot) env.QUOTA_AXI_SNAPSHOT = String(snapshot);
  if (extraEnv && typeof extraEnv === "object") {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v === "string") env[k] = v;
    }
  }
  return env;
}

function candidateFiles(id, cleanHome, cacheBase, snapshot, env, plat) {
  const list = [];
  if (snapshot) list.push(String(snapshot));
  if (cacheBase) {
    list.push(join(cacheBase, "quota-axi", "quotas.json"));
    list.push(join(cacheBase, "quota-axi", "muse-key-reads.json"));
  }
  if (snapshot || !cleanHome) return [...new Set(list.filter(Boolean))];

  const piAuth = env.PI_CODING_AGENT_DIR
    ? join(env.PI_CODING_AGENT_DIR, "auth.json")
    : join(cleanHome, ".pi", "agent", "auth.json");

  if (id === "codex") {
    list.push(join(env.CODEX_HOME || join(cleanHome, ".codex"), "auth.json"), piAuth);
  } else if (id === "claude") {
    const dir = env.CLAUDE_CONFIG_DIR || join(cleanHome, ".claude");
    list.push(join(dir, ".credentials.json"), join(dir, "credentials.json"), join(cleanHome, ".claude.json"));
  } else if (id === "cursor") {
    list.push(
      env.CURSOR_CLI_CONFIG || join(cleanHome, ".cursor", "cli-config.json"),
      join(env.XDG_CONFIG_HOME || join(cleanHome, ".config"), "cursor", "auth.json"),
    );
  } else if (id === "copilot") {
    const ghDir = env.GH_CONFIG_DIR || (env.XDG_CONFIG_HOME
      ? join(env.XDG_CONFIG_HOME, "gh")
      : (plat === "win32" && env.AppData ? join(env.AppData, "GitHub CLI") : join(cleanHome, ".config", "gh")));
    const appsDir = plat === "win32"
      ? (env.LOCALAPPDATA || join(cleanHome, "AppData", "Local"))
      : (env.XDG_CONFIG_HOME || join(cleanHome, ".config"));
    list.push(
      join(env.COPILOT_HOME || join(cleanHome, ".copilot"), "config.json"),
      env.GITHUB_COPILOT_APPS_JSON || join(appsDir, "github-copilot", "apps.json"),
      join(appsDir, "github-copilot", "hosts.json"),
      join(ghDir, "hosts.yml"),
    );
  } else if (id === "grok") {
    list.push(env.GROK_AUTH_PATH, join(env.GROK_HOME || join(cleanHome, ".grok"), "auth.json"), piAuth);
  } else if (id === "kimi") {
    const kimiHome = env.KIMI_CODE_HOME || join(cleanHome, ".kimi-code");
    list.push(
      join(kimiHome, "credentials", "kimi-code.json"),
      join(kimiHome, "config.toml"),
      join(cleanHome, ".kimi", "credentials", "kimi-code.json"),
      join(cleanHome, ".kimi", "config.toml"),
      piAuth,
    );
  } else if (id === "opencode-go" || id === "zai") {
    const openCodeBase = env.XDG_DATA_HOME || env.LOCALAPPDATA || join(cleanHome, ".local", "share");
    list.push(
      join(openCodeBase, "opencode", "auth.json"),
      join(cleanHome, ".local", "share", "opencode", "auth.json"),
      env.QUOTA_AXI_OPENCODE_GO_PI_AUTH,
      piAuth,
    );
  } else if (id === "minimax") {
    list.push(join(env.MMX_CONFIG_DIR || join(cleanHome, ".mmx"), "config.json"), piAuth);
  } else if (id === "commandcode") {
    list.push(
      join(cleanHome, ".commandcode", "auth.json"),
      join(env.XDG_CONFIG_HOME || join(cleanHome, ".config"), "commandcode", "auth.json"),
      piAuth,
    );
  } else if (id === "devin") {
    if (env.XDG_DATA_HOME) list.push(join(env.XDG_DATA_HOME, "devin", "credentials.toml"));
    if (env.APPDATA) list.push(join(env.APPDATA, "devin", "credentials.toml"));
    list.push(
      join(cleanHome, ".local", "share", "devin", "credentials.toml"),
      join(cleanHome, "AppData", "Roaming", "devin", "credentials.toml"),
      join(cleanHome, ".config", "devin", "credentials.toml"),
    );
  } else if (id === "muse") {
    list.push(
      join(env.XDG_CONFIG_HOME || join(cleanHome, ".config"), "muse", "auth.json"),
      join(cleanHome, ".muse", "auth.json"),
    );
  } else if (id === "mimo" || id === "deepseek" || id === "openrouter") {
    list.push(piAuth);
  }
  return [...new Set(list.filter(Boolean))];
}

async function preloadFile(vfs, filePath, plat) {
  if (!filePath) return;
  try {
    // All preloaded inputs are text configuration/cache files. Native Buffer
    // decoding is not Node-compatible, so preserve the host's UTF8 decoding.
    const text = await hostReadFile(filePath, "utf8");
    const bytes = Uint8Array.from(Buffer.from(text, "utf8"));
    const key = normKey(filePath, plat);
    const ino = createHash("sha256").update(key).digest().readUInt32BE(0) || 1;
    vfs.set(key, { rawPath: filePath, bytes, text, mtimeMs: 0, ino });
  } catch {
    // Missing or unreadable files are valid absent inputs.
  }
}

function insideCacheBase(filePath, cacheBase, plat) {
  if (!cacheBase) return false;
  const f = normKey(resolve(filePath), plat);
  const c = normKey(resolve(cacheBase), plat).replace(/\/+$/, "");
  return f === c || f.startsWith(c + "/");
}

async function flushCacheWrites(ctx) {
  if (!ctx.cleanAppHome || !ctx.cacheBase) return;
  for (const [, target] of ctx.deletedFiles) {
    if (!insideCacheBase(target, ctx.cacheBase, ctx.platform)) continue;
    try { await hostUnlink(target); } catch { /* ignore */ }
  }
  for (const [, entry] of ctx.dirtyFiles) {
    if (!insideCacheBase(entry.rawPath, ctx.cacheBase, ctx.platform)) continue;
    try {
      await mkdir(dirname(entry.rawPath), { recursive: true });
      await hostWriteFile(entry.rawPath, entry.text ?? entry.bytes);
    } catch { /* Best-effort cache write. */ }
  }
}

export async function runWithRuntimeContext(options, fn) {
  const prev = mutex;
  let release;
  mutex = new Promise(r => { release = r; });
  await prev;
  const plat = mapPlatform(options?.platform);
  const cleanHome = trimEndSep(options?.home);
  const cleanAppHome = trimEndSep(options?.appHome);
  const cacheBase = cleanAppHome
    ? join(cleanAppHome, "quota-manager-collector")
    : (cleanHome ? join(cleanHome, ".cache", "quota-manager-collector") : "");
  const env = buildSyntheticEnv(cleanHome, cacheBase, plat, options?.snapshot, options?.env);
  const vfs = new Map();
  const files = candidateFiles(options?.id, cleanHome, cacheBase, options?.snapshot, env, plat);
  await Promise.all(files.map(file => preloadFile(vfs, file, plat)));

  const ctx = {
    platform: plat,
    cleanHome,
    cleanAppHome,
    cacheBase,
    env,
    vfs,
    dirtyFiles: new Map(),
    deletedFiles: new Map(),
    fetchImpl: options?.fetchImpl ?? globalThis.fetch,
    deadline: options?.deadline,
    traceStore: null,
  };
  active = ctx;
  try {
    return await fn(ctx);
  } finally {
    active = null;
    try { await flushCacheWrites(ctx); } finally { release(); }
  }
}

export function currentFetch() {
  return active?.fetchImpl ?? globalThis.fetch;
}

export function localQueryRuntime() {
  return { home: active?.cleanHome || "", fetch: currentFetch(), deadline: active?.deadline };
}

export function decodeBase64Utf8(value) {
  const binary = atob(value);
  return decodeURIComponent(Array.from(binary, ch => "%" + ch.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
}

export const runtimeProcess = {
  get env() { return active?.env ?? {}; },
  get platform() { return active?.platform ?? mapPlatform(); },
  pid: 1,
  exitCode: undefined,
  cwd: () => active?.cleanHome || ".",
  execPath: "herdr",
  geteuid: undefined,
  kill: () => {},
  on: () => {},
  off: () => {},
  once: () => {},
  prependListener: () => {},
  removeListener: () => {},
  listenerCount: () => 0,
  stdin: {},
  stdout: { isTTY: false },
};

export function homedir() { return active?.cleanHome || ""; }
export function hostname() { return "local"; }
export function tmpdir() { return active?.cacheBase || "/tmp"; }
export function userInfo() { return { username: "local" }; }
export const devNull = "/dev/null";

function enoent(filePath) {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), { code: "ENOENT" });
}

export function existsSync(filePath) {
  if (!active || !filePath) return false;
  return active.vfs.has(normKey(filePath, active.platform));
}

export function readFileSync(filePath, encoding) {
  if (!active || !filePath) throw enoent(filePath);
  const entry = active.vfs.get(normKey(filePath, active.platform));
  if (!entry) throw enoent(filePath);
  const format = typeof encoding === "string" ? encoding : encoding?.encoding ?? "utf8";
  if (encoding && /^utf-?8$/i.test(format) && entry.text !== undefined) return entry.text;
  const bytes = entry.text !== undefined ? Buffer.from(entry.text, "utf8") : Buffer.from(entry.bytes);
  return encoding ? bytes.toString(format) : bytes;
}

export function statSync(filePath, options) {
  const key = active ? normKey(filePath, active.platform) : "";
  const entry = active?.vfs.get(key);
  if (!entry) {
    if (options?.throwIfNoEntry === false) return undefined;
    throw enoent(filePath);
  }
  if (options?.bigint) {
    const digest = createHash("sha256").update(entry.text ?? entry.bytes).digest();
    const mtimeNs = BigInt(digest.readUInt32BE(0));
    return {
      dev: 1n,
      ino: BigInt(entry.ino),
      size: BigInt(entry.bytes.byteLength),
      mtimeNs,
      ctimeNs: mtimeNs,
      isFile: () => true,
      isDirectory: () => false,
    };
  }
  return {
    dev: 1,
    ino: entry.ino,
    size: entry.bytes.byteLength,
    mtimeMs: entry.mtimeMs,
    ctimeMs: entry.mtimeMs,
    isFile: () => true,
    isDirectory: () => false,
  };
}

export function mkdirSync() {}
export function chmodSync() {}
export function mkdtempSync() { throw enoent("mkdtempSync"); }
export function rmSync() {}
export function realpathSync(p) { return p; }
export function openSync() { throw enoent("openSync"); }
export function closeSync() {}
export function writeSync() {}

export function writeFileSync(filePath, data) {
  if (!active || !filePath) return;
  const text = typeof data === "string" ? data : undefined;
  const bytes = text !== undefined ? Uint8Array.from(Buffer.from(text, "utf8")) : Uint8Array.from(data);
  const key = normKey(filePath, active.platform);
  const existing = active.vfs.get(key);
  const entry = { rawPath: filePath, bytes, text, mtimeMs: Date.now(), ino: existing?.ino ?? active.vfs.size + 1 };
  active.vfs.set(key, entry);
  active.deletedFiles.delete(key);
  active.dirtyFiles.set(key, entry);
}

export function renameSync(fromPath, toPath) {
  if (!active) return;
  const fromKey = normKey(fromPath, active.platform);
  const toKey = normKey(toPath, active.platform);
  const entry = active.vfs.get(fromKey);
  if (!entry) throw enoent(fromPath);
  const moved = { ...entry, rawPath: toPath };
  active.vfs.delete(fromKey);
  active.dirtyFiles.delete(fromKey);
  active.deletedFiles.delete(toKey);
  active.vfs.set(toKey, moved);
  active.dirtyFiles.set(toKey, moved);
}

export function unlinkSync(filePath) {
  if (!active || !filePath) return;
  const key = normKey(filePath, active.platform);
  active.vfs.delete(key);
  active.dirtyFiles.delete(key);
  active.deletedFiles.set(key, filePath);
}

export const constants = { F_OK: 0, X_OK: 1, R_OK: 4, W_OK: 2 };

export async function open(filePath) {
  if (!active || !filePath) throw enoent(filePath);
  const key = normKey(filePath, active.platform);
  let entry = active.vfs.get(key);
  if (!entry && active.cleanHome) {
    await preloadFile(active.vfs, filePath, active.platform);
    entry = active.vfs.get(key);
  }
  if (!entry) throw enoent(filePath);
  let pos = 0;
  return {
    async read(buffer, offset, length) {
      const avail = Math.max(0, entry.bytes.byteLength - pos);
      const count = Math.min(length, avail);
      if (count > 0) buffer.set(entry.bytes.subarray(pos, pos + count), offset);
      pos += count;
      return { bytesRead: count };
    },
    async close() {},
  };
}

export async function access() { throw enoent("access"); }
export async function stat() { throw enoent("stat"); }
export async function mkdtemp() { throw enoent("mkdtemp"); }
export async function rm() {}
export async function symlink() {}
export async function writeFile() {}
export async function readFile(filePath, encoding) { return readFileSync(filePath, encoding); }

export class AsyncLocalStorage {
  getStore() { return active?.traceStore ?? undefined; }
  async run(store, fn) {
    if (!active) return fn();
    const prev = active.traceStore;
    active.traceStore = store;
    try { return await fn(); }
    finally { active.traceStore = prev; }
  }
}

export class RuntimeAbortController {
  constructor() {
    const listeners = new Set();
    this._listeners = listeners;
    this.signal = {
      aborted: false,
      reason: undefined,
      addEventListener(type, fn) { if (type === "abort" && typeof fn === "function") listeners.add(fn); },
      removeEventListener(type, fn) { listeners.delete(fn); },
      dispatchEvent() { return true; },
    };
  }
  abort(reason) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason;
    for (const fn of [...this._listeners]) {
      try { fn({ type: "abort", target: this.signal }); } catch {}
    }
  }
}

export class RuntimeTextDecoder {
  constructor(_encoding = "utf-8", _options = {}) {}
  decode(input) {
    if (!input) return "";
    if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString("utf8");
    return Buffer.from(input).toString("utf8");
  }
}

export function stripVTControlCharacters(text) {
  return String(text ?? "").replace(/\u001B\[[0-9;]*[a-zA-Z]/g, "");
}

export function runtimeSetTimeout() { return { unref() {} }; }
export function runtimeClearTimeout() {}
export async function sleep() {}

export function execFile(_cmd, _args, _opts, cb) {
  const callback = typeof _opts === "function" ? _opts : cb;
  if (typeof callback === "function") queueMicrotask(() => callback(enoent("execFile"), "", ""));
}

export function spawn() {
  const listeners = new Map();
  const child = {
    stdout: { on() {}, destroy() {} },
    stderr: { on() {}, destroy() {} },
    stdin: { destroy() {} },
    exitCode: null,
    signalCode: null,
    unref() {},
    kill() {},
    on(ev, fn) { listeners.set(ev, fn); },
    once(ev, fn) { listeners.set(ev, fn); },
  };
  queueMicrotask(() => listeners.get("error")?.(enoent("spawn")));
  return child;
}

export const httpStub = { request() { throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }); } };
export const httpsStub = httpStub;

export function createTempUnique(prefix) { return `${prefix}${randomUUID()}`; }
