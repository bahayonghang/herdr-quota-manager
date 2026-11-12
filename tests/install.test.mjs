import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { installMod, uninstallMod } from "../scripts/install.mjs";
async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "herdr quota '测试' "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("installer stages and validates before modifying the installed mod", async t => {
  const home = await sandbox(t); let checked = false;
  const r = await installMod({ appHome: home, check: async path => {
    assert.match(await readFile(join(path, "main.js"), "utf8"), /QuotaManager/); checked = true;
  } });
  assert.equal(checked, true); assert.equal(r.nativeChecked, true);
  assert.match(await readFile(join(r.target, "main.js"), "utf8"), /QuotaManager/);
});
test("failed native validation leaves existing content and layout untouched", async t => {
  const home = await sandbox(t), target = join(home, "mods", "quota-manager");
  await mkdir(target, { recursive: true }); await writeFile(join(target, "main.js"), "old");
  await writeFile(join(home, "shared.json"), "private-state");
  await assert.rejects(installMod({ appHome: home, check: () => { throw new Error("native failure"); } }), /native failure/);
  assert.equal(await readFile(join(target, "main.js"), "utf8"), "old");
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
test("installer refuses a symlink target", async t => {
  const home = await sandbox(t); await mkdir(join(home, "mods")); await mkdir(join(home, "outside"));
  try { await symlink(join(home, "outside"), join(home, "mods", "quota-manager"), "junction"); }
  catch (e) { if (["EPERM", "EACCES"].includes(e.code)) { t.skip("symlink creation not permitted"); return; } throw e; }
  await assert.rejects(installMod({ appHome: home, skipCheck: true }), /symlink/);
});
