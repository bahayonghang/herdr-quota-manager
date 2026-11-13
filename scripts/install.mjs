import { cp, mkdir, rename, rm, lstat, writeFile, readFile } from "node:fs/promises";
import { basename, resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { buildVendor, COLLECTOR_COMMIT, COLLECTOR_VERSION } from "./build-vendor.mjs";
export { buildVendor, COLLECTOR_COMMIT, COLLECTOR_VERSION };
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const marker = ".quota-manager-install.json";
const exists = async p => { try { return await lstat(p); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
export function nativeCheck(path) {
  const result = spawnSync("herdr-app", ["check", path], { encoding: "utf8", timeout: 30000, windowsHide: true });
  const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  if (result.error?.code === "ENOENT") throw new Error(
    "Native check failed. Install herdr-app on PATH and retry. No installed mod was changed.");
  if (result.error || result.status !== 0) throw new Error(
    `Native check failed. No installed mod was changed.${detail ? `\n${detail}` : result.error?.message ? `\n${result.error.message}` : ""}`);
}
export async function installMod({ appHome, source = join(root, "mods", "quota-manager"), check = nativeCheck, skipCheck = false }) {
  const home = resolve(appHome), target = join(home, "mods", "quota-manager");
  const current = await exists(target);
  if (current?.isSymbolicLink() || (current && !current.isDirectory())) throw new Error("Refusing to replace a symlink or non-directory mod");
  await mkdir(home, { recursive: true });
  const staging = join(home, `.quota-manager-stage-${randomUUID()}`);
  let backup = null;
  try {
    await cp(source, staging, { recursive: true, dereference: false });
    await writeFile(join(staging, marker), JSON.stringify({ project: "herdr-quota-manager", version: "0.1.0" }) + "\n");
    if (!skipCheck) await check(staging);
    await mkdir(join(home, "mods"), { recursive: true });
    if (current) {
      const parent = join(home, ".quota-manager-backups");
      await mkdir(parent, { recursive: true });
      backup = join(parent, `${Date.now()}-${randomUUID()}`);
      await rename(target, backup);
    }
    try { await rename(staging, target); }
    catch (e) { if (backup) await rename(backup, target); throw e; }
    return { target, backup, nativeChecked: !skipCheck };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
export async function uninstallMod(appHome) {
  const home = resolve(appHome), target = join(home, "mods", "quota-manager");
  const stat = await exists(target);
  if (!stat) return null;
  if (stat.isSymbolicLink()) throw new Error("Refusing to uninstall a symlink");
  const info = JSON.parse(await readFile(join(target, marker), "utf8"));
  if (info.project !== "herdr-quota-manager") throw new Error("Not an installation owned by this installer");
  const parent = join(home, ".quota-manager-backups");
  await mkdir(parent, { recursive: true });
  const backup = join(parent, `removed-${Date.now()}-${randomUUID()}`);
  await rename(target, backup);
  return backup;
}
const collectorMarkerName = ".quota-manager-collector.json";
export function installPaths(appHome) {
  const home = resolve(appHome);
  return {
    mod: join(home, "mods", "quota-manager"),
    collector: join(home, "collectors", "quota-manager"),
    legacyCollector: join(home, "collectors", "quota-axi"),
  };
}
export async function retireOwnedCollectors(appHome) {
  const home = resolve(appHome), paths = installPaths(home), retired = [];
  for (const target of [paths.collector, paths.legacyCollector]) {
    const stat = await exists(target);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) continue;
    let info = null;
    try { info = JSON.parse(await readFile(join(target, collectorMarkerName), "utf8")); }
    catch { info = null; }
    if (info?.project !== "herdr-quota-manager") continue;
    const parent = join(home, ".quota-manager-backups");
    await mkdir(parent, { recursive: true });
    const backup = join(parent, `retired-collector-${basename(target)}-${Date.now()}-${randomUUID()}`);
    await rename(target, backup);
    retired.push(backup);
  }
  return retired;
}
async function main() {
  const args = process.argv.slice(2);
  let appHome = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
  let skipCheck = false, dry = false, uninstall = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--app-home" && args[i + 1]) appHome = args[++i];
    else if (args[i] === "--skip-native-check") skipCheck = true;
    else if (args[i] === "--dry-run") dry = true;
    else if (args[i] === "--uninstall") uninstall = true;
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  const paths = installPaths(appHome);
  if (dry) {
    console.log(`${uninstall ? "Uninstall" : "Install"}: ${paths.mod}`);
    return;
  }
  if (uninstall) {
    console.log("Moved mod to backup:", await uninstallMod(appHome) ?? "not installed");
    for (const backup of await retireOwnedCollectors(appHome)) {
      console.log("Moved retired collector directory to backup:", backup);
    }
    console.log("Remove its block from personal layouts if still present. Shared preferences and history were retained.");
    return;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) throw new Error("Node.js 22.19+ is required to build vendored quota-axi");
  await buildVendor({ repoRoot: root });
  const result = await installMod({ appHome, skipCheck });
  const retired = await retireOwnedCollectors(appHome);
  console.log(`Installed: ${result.target}`);
  if (result.backup) console.log(`Previous mod backed up: ${result.backup}`);
  console.log(result.nativeChecked ? "Native initial-render check passed. Verify the live UI next." : "WARNING: native validation was explicitly skipped; this is not a verified installation.");
  for (const backup of retired) {
    console.log(`Moved retired collector directory to backup: ${backup}`);
  }
  console.log("Open Quota Manager settings, choose providers, and click Start. Existing layouts and keybindings were not rewritten.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
