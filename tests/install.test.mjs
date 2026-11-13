import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { installMod, uninstallMod, retireOwnedCollectors, installPaths, COLLECTOR_COMMIT, COLLECTOR_VERSION } from "../scripts/install.mjs";

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "herdr quota '测试' "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const exists = async p => {
  try { return await stat(p); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
};

test("installer stages and validates before modifying the installed mod, including vendored quota-axi", async t => {
  const home = await sandbox(t); let checked = false;
  const r = await installMod({ appHome: home, check: async path => {
    assert.match(await readFile(join(path, "main.js"), "utf8"), /QuotaManager/);
    assert.match(await readFile(join(path, "vendor", "quota-axi", "index.js"), "utf8"), /queryLocalQuota/);
    checked = true;
  } });
  assert.equal(checked, true); assert.equal(r.nativeChecked, true);
  assert.match(await readFile(join(r.target, "main.js"), "utf8"), /QuotaManager/);
  assert.equal(await exists(join(home, "collectors")), null);
  assert.equal(COLLECTOR_VERSION, "0.1.69");
  assert.equal(COLLECTOR_COMMIT.length, 40);
});

test("failed native validation leaves existing mod, collectors, and shared state untouched", async t => {
  const home = await sandbox(t), target = join(home, "mods", "quota-manager");
  const owned = installPaths(home).collector;
  await mkdir(target, { recursive: true }); await writeFile(join(target, "main.js"), "old");
  await mkdir(owned, { recursive: true });
  await writeFile(join(owned, ".quota-manager-collector.json"), JSON.stringify({ project: "herdr-quota-manager" }));
  await writeFile(join(owned, "keep.txt"), "owned");
  await writeFile(join(home, "shared.json"), "private-state");
  await assert.rejects(installMod({ appHome: home, check: () => { throw new Error("native failure"); } }), /native failure/);
  assert.equal(await readFile(join(target, "main.js"), "utf8"), "old");
  assert.equal(await readFile(join(owned, "keep.txt"), "utf8"), "owned");
  assert.equal(await readFile(join(home, "shared.json"), "utf8"), "private-state");
  assert.ok(!(await readdir(home)).some(n => n.startsWith(".quota-manager-stage-")));
});

test("upgrade retains a complete backup and shared settings", async t => {
  const home = await sandbox(t); const first = await installMod({ appHome: home, skipCheck: true });
  await writeFile(join(first.target, "custom.txt"), "old custom file");
  await writeFile(join(home, "shared.json"), "settings");
  const next = await installMod({ appHome: home, skipCheck: true });
  assert.equal(await readFile(join(next.backup, "custom.txt"), "utf8"), "old custom file");
  assert.equal(await readFile(join(home, "shared.json"), "utf8"), "settings");
  assert.equal(next.nativeChecked, false);
});

test("uninstall moves only an owned install to backup", async t => {
  const home = await sandbox(t); await installMod({ appHome: home, skipCheck: true });
  const backup = await uninstallMod(home); assert.ok(backup);
  assert.match(await readFile(join(backup, "main.js"), "utf8"), /QuotaManager/);
  assert.equal(await uninstallMod(home), null);
});

test("uninstall refuses unmarked directories", async t => {
  const home = await sandbox(t); await mkdir(join(home, "mods", "quota-manager"), { recursive: true });
  await assert.rejects(uninstallMod(home));
});

test("retireOwnedCollectors moves only marked quota-manager and quota-axi collector dirs into backups", async t => {
  const home = await sandbox(t);
  const paths = installPaths(home);
  await mkdir(paths.collector, { recursive: true });
  await writeFile(join(paths.collector, ".quota-manager-collector.json"), JSON.stringify({ project: "herdr-quota-manager" }));
  await writeFile(join(paths.collector, "old.txt"), "retired module");
  await mkdir(paths.legacyCollector, { recursive: true });
  await writeFile(join(paths.legacyCollector, ".quota-manager-collector.json"), JSON.stringify({ project: "herdr-quota-manager" }));
  await writeFile(join(paths.legacyCollector, "legacy.txt"), "retired legacy");

  const backups = await retireOwnedCollectors(home);
  assert.equal(backups.length, 2);
  assert.match(await readFile(join(backups[0], "old.txt"), "utf8"), /retired module/);
  assert.match(await readFile(join(backups[1], "legacy.txt"), "utf8"), /retired legacy/);
  assert.equal(await exists(paths.collector), null);
  assert.equal(await exists(paths.legacyCollector), null);
  assert.deepEqual(await retireOwnedCollectors(home), []);
});

test("retireOwnedCollectors leaves unmarked, foreign, and symlinked collector dirs untouched", async t => {
  const home = await sandbox(t);
  const paths = installPaths(home);
  await mkdir(paths.collector, { recursive: true });
  await writeFile(join(paths.collector, "keep.txt"), "unmarked");
  await mkdir(paths.legacyCollector, { recursive: true });
  await writeFile(join(paths.legacyCollector, ".quota-manager-collector.json"), JSON.stringify({ project: "other-project" }));
  await writeFile(join(paths.legacyCollector, "keep.txt"), "foreign");

  assert.deepEqual(await retireOwnedCollectors(home), []);
  assert.equal(await readFile(join(paths.collector, "keep.txt"), "utf8"), "unmarked");
  assert.equal(await readFile(join(paths.legacyCollector, "keep.txt"), "utf8"), "foreign");
});

test("retireOwnedCollectors skips symlinked collector targets without throwing", async t => {
  const home = await sandbox(t);
  const paths = installPaths(home);
  await mkdir(join(home, "collectors"), { recursive: true });
  await mkdir(join(home, "outside"), { recursive: true });
  await writeFile(join(home, "outside", ".quota-manager-collector.json"), JSON.stringify({ project: "herdr-quota-manager" }));
  try { await symlink(join(home, "outside"), paths.collector, "junction"); }
  catch (e) { if (["EPERM", "EACCES"].includes(e.code)) { t.skip("symlink creation not permitted"); return; } throw e; }

  assert.deepEqual(await retireOwnedCollectors(home), []);
  assert.equal(await readFile(join(home, "outside", ".quota-manager-collector.json"), "utf8").then(JSON.parse).then(x => x.project), "herdr-quota-manager");
});

test("dry-run prints only the mod path and creates nothing", async t => {
  const home = await sandbox(t);
  const result = spawnSync(process.execPath, ["scripts/install.mjs", "--dry-run", "--app-home", home], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /mods[\\/]quota-manager/);
  assert.equal(/collectors[\\/]/.test(result.stdout), false);
  assert.equal(await exists(join(home, "mods")), null);
  assert.equal(await exists(join(home, "collectors")), null);
});

test("installer refuses a symlink mod target", async t => {
  const home = await sandbox(t); await mkdir(join(home, "mods")); await mkdir(join(home, "outside"));
  try { await symlink(join(home, "outside"), join(home, "mods", "quota-manager"), "junction"); }
  catch (e) { if (["EPERM", "EACCES"].includes(e.code)) { t.skip("symlink creation not permitted"); return; } throw e; }
  await assert.rejects(installMod({ appHome: home, skipCheck: true }), /symlink/);
});
