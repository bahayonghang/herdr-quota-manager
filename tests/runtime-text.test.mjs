import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

test("text VFS preserves UTF8 credentials and cache with the observed native Buffer behavior", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quota-native-text-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, "home"), appHome = join(dir, "app");
  await mkdir(join(home, ".codex"), { recursive: true });
  const credential = JSON.stringify({ tokens: { access_token: "synthetic-token" }, label: "额度 café 😀" });
  const authFile = join(home, ".codex", "auth.json");
  await writeFile(authFile, credential);
  const source = await readFile(new URL("../mods/quota-manager/vendor/quota-axi/runtime.js", import.meta.url), "utf8");
  await writeFile(join(dir, "runtime.mjs"), source.replace('from "fs/promises"', 'from "./native-fs.mjs"').replace('from "buffer"', 'from "./native-buffer.mjs"'));
  await writeFile(join(dir, "native-fs.mjs"), `
import * as fs from 'node:fs/promises';
export const {mkdir,unlink,writeFile} = fs;
export async function readFile(file, encoding) {
  const value = await fs.readFile(file, encoding);
  return typeof value === 'string' ? value : new Uint8Array(value);
}
`);
  await writeFile(join(dir, "native-buffer.mjs"), `
import {Buffer as NodeBuffer} from 'node:buffer';
export const Buffer = {
  isBuffer: NodeBuffer.isBuffer,
  byteLength: NodeBuffer.byteLength,
  alloc: NodeBuffer.alloc,
  from(value, encoding) {
    // Native proof: string encoding keeps indexed bytes; typed-array input
    // produces length zero, and native Buffer.toString always returns empty.
    const buffer = typeof value === 'string' ? NodeBuffer.from(value, encoding) : NodeBuffer.alloc(0);
    buffer.toString = () => '';
    return buffer;
  },
};
`);
  const runtime = await import(pathToFileURL(join(dir, "runtime.mjs")));
  const cacheFile = join(appHome, "quota-manager-collector", "quota-axi", "quotas.json");
  const cache = JSON.stringify({ schemaVersion: 3, providers: [], label: "缓存 résumé 😀" });
  await runtime.runWithRuntimeContext({ id: "codex", home, appHome, platform: "windows" }, () => {
    assert.equal(runtime.existsSync(authFile), true);
    assert.equal(runtime.readFileSync(authFile, "utf8"), credential);
    assert.deepEqual(JSON.parse(runtime.readFileSync(authFile, "utf8")), JSON.parse(credential));
    assert.equal(runtime.statSync(authFile).size, Buffer.byteLength(credential, "utf8"));
    const expectedFingerprint = BigInt(createHash("sha256").update(credential).digest().readUInt32BE(0));
    assert.equal(runtime.statSync(authFile, { bigint: true }).mtimeNs, expectedFingerprint);
    runtime.writeFileSync(cacheFile, cache);
    assert.equal(runtime.readFileSync(cacheFile, { encoding: "utf8" }), cache);
    assert.equal(runtime.statSync(cacheFile).size, Buffer.byteLength(cache, "utf8"));
  });
  assert.equal(await readFile(cacheFile, "utf8"), cache);
  await runtime.runWithRuntimeContext({ id: "codex", home, appHome, platform: "windows" }, () => {
    assert.equal(runtime.readFileSync(cacheFile, "utf8"), cache);
    assert.deepEqual(JSON.parse(runtime.readFileSync(cacheFile, "utf8")), JSON.parse(cache));
  });
  const jwtText = JSON.stringify({ sub: "synthetic-user", name: "用户 café 😀" });
  assert.equal(runtime.decodeBase64Utf8(Buffer.from(jwtText).toString("base64")), jwtText);
});
