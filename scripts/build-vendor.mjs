import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const COLLECTOR_COMMIT = "5734c41eee52eb9a80ba67f47269ebc06c0c41fc";
export const COLLECTOR_VERSION = "0.1.69";

const BANNER = `// Adapted from quota-axi ${COLLECTOR_VERSION} (${COLLECTOR_COMMIT}), MIT License, Copyright (c) 2026 Kun Chen.\n`;

const SKIP_FILES = new Set([
  "cli.js",
  "args.js",
  "models.js",
  "model-kb.js",
  "skill.js",
  "tui.js",
  "tui-live.js",
  "tui-viewport.js",
  "commands.js",
  "index.js",
  "version.js",
  "render.js",
  "lib/system-theme.js",
  "lib/fetch-lock.js",
  "lib/http.js",
  "lib/process.js",
  "providers/delegated-refresh.js",
  "providers/claude-native-quota.js",
  "providers/claude-swap.js",
]);

const exists = async p => {
  try { return await stat(p); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
};

function pnpmBins() { return process.platform === "win32" ? ["pnpm.cmd", "pnpm"] : ["pnpm"]; }
function quoteCmd(value) {
  const text = String(value);
  return /[\s"&|<>^]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function run(command, args, cwd) {
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.npm_config_production;
  delete env.pnpm_config_prod;
  const options = { cwd, env, encoding: "utf8", windowsHide: true, timeout: 600000 };
  // Node will not start a Windows .cmd shim directly. One quoted command line avoids shell:true.
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteCmd).join(" ")], options);
  }
  return spawnSync(command, args, options);
}
function runDetail(result) {
  return `${result.stderr ?? ""}${result.stdout ?? ""}${result.error?.message ?? ""}`.trim();
}
export function runPnpm(cwd, args) {
  let detail = "pnpm was not found";
  for (const bin of pnpmBins()) {
    const result = run(bin, args, cwd);
    if (result.status === 0) return;
    if (result.error?.code === "ENOENT") continue;
    detail = runDetail(result) || detail;
    if (!/ERR_PNPM_BAD_PM_VERSION|packageManager|version of pnpm/i.test(detail)) {
      throw new Error(`Failed to build the vendored quota-axi snapshot.\n${detail}`);
    }
    break;
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const retry = run(npm, ["exec", "--yes", "--package", "pnpm@11.1.1", "--", "pnpm", ...args], cwd);
  if (retry.status === 0) return;
  throw new Error(`Failed to build the vendored quota-axi snapshot.\n${detail}\n${runDetail(retry)}`.trim());
}

async function walkJsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walkJsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function runtimeImportPath(relPosix) {
  const depth = relPosix.split("/").length - 1;
  return depth === 0 ? "./runtime.js" : `${"../".repeat(depth)}runtime.js`;
}

function parseNamedBindings(clause) {
  const inner = clause.trim().replace(/^\{|\}$/g, "");
  return inner.split(",").map(part => part.trim()).filter(Boolean);
}

function addRuntimeImport(code, names, relRuntime) {
  if (!names.length) return code;
  const unique = [...new Set(names)];
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${relRuntime.replaceAll(".", "\\.")}["'];?`);
  const match = code.match(re);
  if (match) {
    const existing = new Set(parseNamedBindings(match[1]));
    for (const n of unique) existing.add(n);
    return code.replace(re, `import { ${[...existing].join(", ")} } from "${relRuntime}";`);
  }
  return `import { ${unique.join(", ")} } from "${relRuntime}";\n${code}`;
}

function transformDistModule(raw, relPosix) {
  const relRuntime = runtimeImportPath(relPosix);
  let code = raw.replace(/\r\n/g, "\n").replace(/\n?\/\/# sourceMappingURL=.*$/gm, "");
  const runtimeNeeded = new Set();

  code = code.replace(/from\s+["']node:crypto["']/g, 'from "crypto"');
  code = code.replace(/from\s+["']node:url["']/g, 'from "url"');

  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']node:path["'];?/g, (_, id) => {
    runtimeNeeded.add(`runtimePath as ${id}`);
    return "";
  });
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']node:http["'];?/g, (_, id) => {
    runtimeNeeded.add(`httpStub as ${id}`);
    return "";
  });
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']node:https["'];?/g, (_, id) => {
    runtimeNeeded.add(`httpsStub as ${id}`);
    return "";
  });

  code = code.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']node:(path|os|fs|fs\/promises|async_hooks|util|child_process|timers\/promises)["'];?/g,
    (_, clause, modName) => {
      for (const spec of parseNamedBindings(clause)) {
        if (modName === "util" && /^TextDecoder(?:\s|$)/.test(spec)) {
          const alias = spec.includes(" as ") ? spec.split(/\s+as\s+/)[1].trim() : "TextDecoder";
          runtimeNeeded.add(`RuntimeTextDecoder as ${alias}`);
        } else if (modName === "timers/promises" && /^setTimeout(?:\s|$)/.test(spec)) {
          const alias = spec.includes(" as ") ? spec.split(/\s+as\s+/)[1].trim() : "setTimeout";
          runtimeNeeded.add(`sleep as ${alias}`);
        } else {
          runtimeNeeded.add(spec);
        }
      }
      return "";
    },
  );

  if (relPosix === "providers/cursor.js") {
    code = code
      .replace("const STATE_DB = cursorStateDbPath();", "const STATE_DB = null;")
      .replace("statSync(STATE_DB,", "statSync(cursorStateDbPath(),")
      .replace('"-readonly",\n        STATE_DB,', '"-readonly",\n        cursorStateDbPath(),')
      .replace('"-readonly",\n    STATE_DB,', '"-readonly",\n    cursorStateDbPath(),');
  }

  if (/(?<![./])\bprocess\.(?!js\b)/.test(code)) {
    code = code.replace(/(?<![./])\bprocess\.(?!js\b)/g, "runtimeProcess.");
    runtimeNeeded.add("runtimeProcess");
  }
  if (/\bnew\s+AbortController\s*\(/.test(code)) {
    code = code.replace(/\bnew\s+AbortController\s*\(/g, "new RuntimeAbortController(");
    runtimeNeeded.add("RuntimeAbortController");
  }
  if (/\bnew\s+TextDecoder\s*\(/.test(code)) {
    code = code.replace(/\bnew\s+TextDecoder\s*\(/g, "new RuntimeTextDecoder(");
    runtimeNeeded.add("RuntimeTextDecoder");
  }
  if (/\bsetTimeout\s*\(/.test(code)) {
    code = code.replace(/\bsetTimeout\s*\(/g, "runtimeSetTimeout(");
    runtimeNeeded.add("runtimeSetTimeout");
  }
  if (/\bclearTimeout\s*\(/.test(code)) {
    code = code.replace(/\bclearTimeout\s*\(/g, "runtimeClearTimeout(");
    runtimeNeeded.add("runtimeClearTimeout");
  }

  code = addRuntimeImport(code.replace(/^\n+/, ""), [...runtimeNeeded], relRuntime);
  return `${BANNER}${code.trimEnd()}\n`;
}

function runtimeModuleSource() {
  return `${BANNER}import { mkdir, readFile as hostReadFile, unlink as hostUnlink, writeFile as hostWriteFile } from "fs/promises";
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
  return String(p || "").replace(/[\\\\/]+$/, "");
}

function normKey(filePath, plat) {
  const s = String(filePath || "").replace(/\\\\/g, "/").replace(/\\/+/g, "/");
  return plat === "win32" ? s.toLowerCase() : s;
}

function winIsAbsolute(p) {
  return /^[a-zA-Z]:[\\\\/]/.test(p) || p.startsWith("\\\\\\\\") || p.startsWith("/");
}
function winJoin(...parts) {
  return parts.filter(Boolean).join("\\\\").replace(/\\\\+/g, "\\\\");
}
function winDirname(p) {
  const idx = Math.max(p.lastIndexOf("\\\\"), p.lastIndexOf("/"));
  return idx <= 0 ? (p.slice(0, 2) || ".") : p.slice(0, idx);
}
function winBasename(p) {
  const clean = trimEndSep(p);
  const idx = Math.max(clean.lastIndexOf("\\\\"), clean.lastIndexOf("/"));
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
  sep: "\\\\",
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
    const raw = await hostReadFile(filePath);
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const key = normKey(filePath, plat);
    const ino = createHash("sha256").update(key).digest().readUInt32BE(0) || 1;
    vfs.set(key, { rawPath: filePath, bytes, mtimeMs: 0, ino });
  } catch {
    // Missing or unreadable files are valid absent inputs.
  }
}

function insideCacheBase(filePath, cacheBase, plat) {
  if (!cacheBase) return false;
  const f = normKey(resolve(filePath), plat);
  const c = normKey(resolve(cacheBase), plat).replace(/\\/+$/, "");
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
      await hostWriteFile(entry.rawPath, entry.bytes);
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
  return Object.assign(new Error(\`ENOENT: no such file or directory, open '\${filePath}'\`), { code: "ENOENT" });
}

export function existsSync(filePath) {
  if (!active || !filePath) return false;
  return active.vfs.has(normKey(filePath, active.platform));
}

export function readFileSync(filePath, encoding) {
  if (!active || !filePath) throw enoent(filePath);
  const entry = active.vfs.get(normKey(filePath, active.platform));
  if (!entry) throw enoent(filePath);
  return encoding ? entry.bytes.toString(typeof encoding === "string" ? encoding : encoding.encoding ?? "utf8") : Buffer.from(entry.bytes);
}

export function statSync(filePath, options) {
  const key = active ? normKey(filePath, active.platform) : "";
  const entry = active?.vfs.get(key);
  if (!entry) {
    if (options?.throwIfNoEntry === false) return undefined;
    throw enoent(filePath);
  }
  if (options?.bigint) {
    const digest = createHash("sha256").update(entry.bytes).digest();
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
  const bytes = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data), "utf8");
  const key = normKey(filePath, active.platform);
  const existing = active.vfs.get(key);
  const entry = { rawPath: filePath, bytes, mtimeMs: Date.now(), ino: existing?.ino ?? active.vfs.size + 1 };
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
      if (count > 0) entry.bytes.copy(buffer, offset, pos, pos + count);
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
  return String(text ?? "").replace(/\\u001B\\[[0-9;]*[a-zA-Z]/g, "");
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

export function createTempUnique(prefix) { return \`\${prefix}\${randomUUID()}\`; }
`;
}

function httpModuleSource() {
  return `${BANNER}import { Buffer } from "buffer";
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
  if (declared && /^\\d+$/.test(declared) && Number(declared) > PROVIDER_RESPONSE_LIMIT_BYTES) {
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
`;
}

function indexModuleSource() {
  return `${BANNER}import { annotateQuotaAdvice } from "./advice.js";
import {
  fetchLockPathFor, isSnapshotFile, readReusableProviders, readSnapshotProviders, stampReadingInputs, writeCachedProviders,
} from "./cache.js";
import { CLAUDE_PROFILES_ENV, claudeListedProfiles } from "./lib/claude-profile.js";
import { takeFetchTurn } from "./lib/fetch-lock.js";
import { withInputTrace } from "./lib/input-trace.js";
import { withQuotaSemantics } from "./interpretation.js";
import { providerPresence } from "./lib/source-attempts.js";
import { nowIso } from "./lib/time.js";
import { coalesceVerifiedSubscriptions, fetchAccountQuotas } from "./providers/accounts.js";
import { failedProvider } from "./providers/common.js";
import { claudeSwapEnabled } from "./providers/claude-swap.js";
import { PROVIDERS } from "./providers/index.js";
import { quotaJsonReport } from "./render.js";
import { AxiError, delimiter, runWithRuntimeContext, runtimeProcess } from "./runtime.js";

const SNAPSHOT_ENV = "QUOTA_AXI_SNAPSHOT";
function snapshotFile() { return runtimeProcess.env[SNAPSHOT_ENV]?.trim() || undefined; }

function validateClaudeProfiles(providers, options) {
  if (!providers.includes("claude") || options.credentialMode === "profile-only") return;
  const [invalid] = claudeListedProfiles()?.invalid ?? [];
  if (invalid === undefined) return;
  throw new AxiError(\`\${CLAUDE_PROFILES_ENV} entry \${JSON.stringify(invalid)} is not an absolute path\`, "VALIDATION_ERROR", [
    \`List each Claude config directory as an absolute path, separated by "\${delimiter}"\`,
  ]);
}

async function tracedReadings(provider, options) {
  const { value, inputs } = await withInputTrace(() => fetchAccountQuotas(PROVIDERS[provider], options));
  for (const reading of value) stampReadingInputs(reading, inputs);
  return value;
}

function reusableReadings(provider, maxAgeSeconds) {
  try { return readReusableProviders(provider, maxAgeSeconds); }
  catch { return undefined; }
}

function snapshotReadings(provider, file) {
  let readings;
  try { readings = readSnapshotProviders(file, provider); }
  catch { readings = undefined; }
  if (Array.isArray(readings)) {
    return coalesceVerifiedSubscriptions(readings.map(reading => ({
      ...reading,
      state: { ...reading.state, sourcesTried: ["snapshot"] },
    })));
  }
  return [failedProvider({
    provider,
    label: PROVIDERS[provider].label,
    status: "unavailable",
    error: readings === "expired" ? "snapshot_expired" : "not_in_snapshot",
    sourcesTried: ["snapshot"],
  })];
}

async function readProvider(provider, options, maxAgeSeconds, markCached) {
  if (!(maxAgeSeconds > 0)) return tracedReadings(provider, options);
  const reused = reusableReadings(provider, maxAgeSeconds);
  if (reused) return reused;
  const turn = await takeFetchTurn(fetchLockPathFor(provider), () => reusableReadings(provider, maxAgeSeconds));
  if (turn.kind === "answered") return turn.value;
  if (turn.kind === "unlocked") return tracedReadings(provider, options);
  try {
    const readings = await tracedReadings(provider, options);
    const readingAt = nowIso();
    writeCachedProvidersBestEffort(readings.map(r => withQuotaSemantics(r, readingAt)), readingAt);
    markCached();
    return readings;
  } finally {
    turn.lock?.release?.();
  }
}

function writeCachedProvidersBestEffort(providers, readingAt) {
  try { writeCachedProviders(providers, readingAt); }
  catch { return; }
}

async function fetchQuotaCore(providers, options, maxAgeSeconds = 0) {
  const snapshot = snapshotFile();
  if (snapshot && !isSnapshotFile(snapshot)) {
    throw new AxiError(\`\${SNAPSHOT_ENV} is not a readable quota snapshot\`, "VALIDATION_ERROR");
  }
  if (!snapshot && !claudeSwapEnabled()) validateClaudeProfiles(providers, options);
  const writesCache = options.credentialMode !== "profile-only" && !snapshot;
  const cached = new Set();
  const fetched = (await Promise.all(providers.map(provider => snapshot
    ? snapshotReadings(provider, snapshot)
    : readProvider(provider, options, writesCache ? maxAgeSeconds : 0, () => cached.add(provider))))).flat();
  const generatedAt = nowIso();
  const results = fetched.map(provider => withQuotaSemantics(provider, generatedAt));
  if (writesCache) writeCachedProvidersBestEffort(results.filter(p => !cached.has(p.provider)), generatedAt);
  return annotateQuotaAdvice({ generatedAt, providers: results });
}

export async function queryLocalQuota(id, { force = false, home = "", appHome = "", platform = "unknown", snapshot, env, fetchImpl } = {}) {
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(PROVIDERS, id)) {
    throw new Error("Unsupported provider");
  }
  return runWithRuntimeContext({ id, home, appHome, platform, snapshot, env, fetchImpl }, async () => {
    const options = { allowKeychainPrompt: false, refreshCredentials: false };
    const response = await fetchQuotaCore([id], options, force ? 0 : 90);
    const laneAbsent = response.providers.map(p => providerPresence(p, PROVIDERS[p.provider]) === "absent");
    return JSON.stringify(quotaJsonReport(response, false, laneAbsent));
  });
}
`;
}

export async function buildVendor({
  repoRoot = root,
  outDir = join(repoRoot, "mods", "quota-manager", "vendor", "quota-axi"),
} = {}) {
  const srcRoot = join(repoRoot, "third_party", "quota-axi");
  const pkg = JSON.parse(await readFile(join(srcRoot, "package.json"), "utf8"));
  if (pkg.version !== COLLECTOR_VERSION) {
    throw new Error(`Vendored quota-axi version is ${pkg.version}, expected ${COLLECTOR_VERSION}`);
  }
  if (!await exists(join(srcRoot, "node_modules", "typescript")) || !await exists(join(srcRoot, "node_modules", "@types", "node"))) {
    runPnpm(srcRoot, ["install", "--frozen-lockfile"]);
  }
  runPnpm(srcRoot, ["build"]);
  const distSrc = join(srcRoot, "dist", "src");
  if (!await exists(join(distSrc, "commands.js"))) {
    throw new Error("Vendored quota-axi build did not produce dist/src/commands.js");
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "lib"), { recursive: true });
  await mkdir(join(outDir, "providers"), { recursive: true });
  await cp(join(srcRoot, "LICENSE"), join(outDir, "LICENSE"));

  for (const file of await walkJsFiles(distSrc)) {
    const rel = relative(distSrc, file).replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) continue;
    const raw = await readFile(file, "utf8");
    const transformed = transformDistModule(raw, rel);
    await writeFile(join(outDir, rel), transformed);
  }

  // Transform render.js to drop TOON / CLI output while preserving quotaJsonReport & redactedResponse.
  const rawRender = await readFile(join(distSrc, "render.js"), "utf8").then(s => s.replace(/\r\n/g, "\n"));
  const cut = rawRender.indexOf("export function redactedResponse(");
  if (cut < 0) throw new Error("Unexpected render.js structure");
  const endHelpers = rawRender.indexOf("function attemptRow(");
  const renderSlice = (endHelpers >= 0 ? rawRender.slice(cut, endHelpers) : rawRender.slice(cut))
    .replace(/\n?\/\/# sourceMappingURL=.*$/gm, "");
  await writeFile(join(outDir, "render.js"), `${BANNER}${renderSlice.trimEnd()}\n`);

  await writeFile(join(outDir, "version.js"), `${BANNER}export const VERSION = ${JSON.stringify(COLLECTOR_VERSION)};\n`);
  await writeFile(join(outDir, "runtime.js"), runtimeModuleSource());
  await writeFile(join(outDir, "lib", "http.js"), httpModuleSource());
  await writeFile(join(outDir, "lib", "fetch-lock.js"), `${BANNER}export function fetchLockPath(cacheDir = "") { return \`\${cacheDir}/fetch.lock\`; }
export function fetchLockPathFor(provider) { return \`lock:\${provider}\`; }
export function withLockSync(_lockPath, fn) { return fn(); }
export async function takeFetchTurn(_lockPath, checkReusable) {
  const value = checkReusable ? checkReusable() : undefined;
  return value !== undefined ? { kind: "answered", value } : { kind: "unlocked" };
}
`);
  await writeFile(join(outDir, "lib", "process.js"), `${BANNER}export async function execFileText() { throw Object.assign(new Error("Subprocess disabled"), { code: "ENOENT" }); }
export async function commandExists() { return false; }
export async function findCommandPath() { return undefined; }
export function terminateChild() {}
export function currentUserProcessListArgs() { return []; }
`);
  await writeFile(join(outDir, "providers", "delegated-refresh.js"), `${BANNER}export const REFRESH_COMMAND_NOT_FOUND = "refresh_command_not_found";
export const REFRESH_SPAWN_FAILED = "refresh_spawn_failed";
export const REFRESH_TIMED_OUT = "refresh_timed_out";
export const REFRESH_EXIT_STATUS = "refresh_exit_status";
export const REFRESH_LIVE_VENDOR_PROCESS = "refresh_live_vendor_process";
export const REFRESH_VENDOR_UNKNOWN = "refresh_vendor_processes_unknown";
export async function runRefreshDelegate() { return { status: "unavailable", error: REFRESH_COMMAND_NOT_FOUND }; }
export function refreshDelegateAttempt(delegate) { return { source: delegate.source, status: "skipped", error: REFRESH_COMMAND_NOT_FOUND }; }
export async function delegateCredentialRefresh(args) { return { attempt: refreshDelegateAttempt(args.delegate) }; }
`);
  await writeFile(join(outDir, "providers", "claude-native-quota.js"), `${BANNER}export async function fetchClaudeNativeQuota() {
  return { status: "skipped", source: "claude-native", error: "claude_native_incompatible" };
}
`);
  await writeFile(join(outDir, "providers", "claude-swap.js"), `${BANNER}export const CLAUDE_SWAP_SOURCE = "claude-swap";
export const CLAUDE_SWAP_EXECUTABLE_REMEDY = "pipx install claude-swap";
export function claudeSwapEnabled() { return false; }
export async function readClaudeSwapAccounts() { return []; }
`);
  await writeFile(join(outDir, "index.js"), indexModuleSource());
  return outDir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildVendor().then(dir => console.log(`Built vendored quota-axi Mod modules at ${dir}`)).catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
