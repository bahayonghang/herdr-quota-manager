import { cp, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
const appBase = resolve(process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app"));
const name = `quota-runtime-probe-${randomUUID()}`;
const target = resolve(appBase, "mods", name);
const output = join(appBase, "data", `${name}.json`);
const scratch = await mkdtemp(join(tmpdir(), "quota-native-runtime-"));
let published = false;
function app(args) {
  const r = spawnSync("herdr-app", args, { encoding: "utf8", timeout: 30000, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`Native probe ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  if (args[0] === "do" && JSON.parse(r.stdout).error) throw new Error("Native probe action rejected");
  return r.stdout;
}
try {
  if (JSON.parse(app(["status"])).overlays.length) throw new Error("Unexpected open overlay");
  await cp(resolve("mods/quota-manager/vendor/quota-axi/runtime.js"), join(scratch, "runtime.js"));
  await writeFile(join(scratch, "mod.json"), JSON.stringify({ place: "none", overlay: { width: 400, height: 100 } }));
  await writeFile(join(scratch, "main.js"), `import { View, div } from "gpui-kit";
import { home, appHome, props, closeOverlay } from "herdr";
import { readFile, writeFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { Buffer } from "buffer";
import { join } from "path";
import { runWithRuntimeContext, existsSync, readFileSync } from "./runtime.js";
export default class RuntimeProbe extends View {
  init(_props, cx) {
    const overlay = props()?.overlay;
    cx.spawn(async () => {
      const digest = createHash("sha256").update("safe-probe").digest();
      const plain = new Uint8Array([123, 125]);
      const result = { bufferIsBuffer: typeof Buffer.isBuffer, bufferByteLength: typeof Buffer.byteLength,
        plainUint8IsBuffer: Buffer.isBuffer(plain), plainUint8DecodesJson: plain.toString("utf8") === "{}",
        copiedBufferDecodesJson: Buffer.from(plain).toString("utf8") === "{}",
        syntheticCopiedText: Buffer.from(plain).toString("utf8"),
        syntheticArrayText: Buffer.from(Array.from(plain)).toString("utf8"),
        syntheticStringText: Buffer.from("{}", "utf8").toString("utf8"),
        syntheticArrayBufferText: Buffer.from(plain.buffer).toString("utf8"),
        syntheticFromLength: Buffer.from(plain).length,
        syntheticStringLength: Buffer.from("{}").length,
        syntheticDefaultText: Buffer.from("{}").toString(),
        syntheticDashedText: Buffer.from("{}").toString("utf-8"),
        syntheticExplicitRangeText: Buffer.from("{}").toString("utf8", 0, 2),
        syntheticByte0: Buffer.from("{}")[0],
        syntheticAtob: atob("e30=") === "{}",
        syntheticNormalizedByteLength: Uint8Array.from(Buffer.from("{}")).byteLength,
        syntheticNormalizedBytes: Array.from(Uint8Array.from(Buffer.from("{}"))),
        digestReadUInt32BE: typeof digest.readUInt32BE, digestLength: digest.length, digestFirstByte: typeof digest[0], sources: [] };
      for (const id of ["codex", "grok"]) {
        const file = join(home(), "." + id, "auth.json");
        const source = { id };
        let stage = "read";
        try {
          const raw = await readFile(file);
          source.read = true; source.rawType = Object.prototype.toString.call(raw);
          stage = "bufferIsBuffer";
          const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          source.rawIsBuffer = Buffer.isBuffer(raw);
          source.currentDecodeMatchesText = bytes.toString("utf8") === await readFile(file, "utf8");
          source.forcedBufferDecodeMatchesText = Buffer.from(raw).toString("utf8") === await readFile(file, "utf8");
          source.bufferConverted = true;
          stage = "hashReadUInt32BE";
          createHash("sha256").update("safe-probe").digest().readUInt32BE(0);
          source.hashRead = true;
          stage = "json";
          const auth = JSON.parse(bytes.toString("utf8"));
          source.codexTokenPresent = !!auth.tokens?.access_token;
        } catch { source.failedStage = stage; }
        try {
          const textAuth = JSON.parse(await readFile(file, "utf8"));
          source.directTextJson = true;
          source.directCodexTokenPresent = !!textAuth.tokens?.access_token;
        } catch { source.directTextJson = false; }
        try {
          await runWithRuntimeContext({ id, home: home(), appHome: appHome(), platform: "windows" }, () => {
            source.vfsExists = existsSync(file);
            if (source.vfsExists) source.vfsJson = typeof JSON.parse(readFileSync(file, "utf8")) === "object";
          });
        } catch { source.runtimeProbeFailed = true; }
        result.sources.push(source);
      }
      await mkdir(join(appHome(), "data"), { recursive: true });
      await writeFile(${JSON.stringify(output)}, JSON.stringify(result));
      if (overlay) closeOverlay(overlay);
    });
  }
  render() { return div().p(12).child("Checking native quota runtime"); }
}
`);
  app(["check", scratch]);
  await mkdir(target); published = true;
  await cp(scratch, target, { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 300));
  app(["do", "mod.open", JSON.stringify({ name })]);
  let result;
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { result = JSON.parse(await readFile(output, "utf8")); break; } catch {}
  }
  if (!result) throw new Error("Native probe produced no diagnostic result");
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (published && target.startsWith(resolve(appBase, "mods") + sep)) await rm(target, { recursive: true, force: true });
  await rm(output, { force: true });
  if (resolve(scratch).startsWith(resolve(tmpdir()) + sep)) await rm(scratch, { recursive: true, force: true });
  await rmdir(join(appBase, "data", name)).catch(error => {
    if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
  });
}
