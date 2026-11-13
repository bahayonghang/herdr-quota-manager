// One-time, user-approved setup through Herdr's documented host shared API.
// Run only after installing the checked quota-manager repair.
import { cp, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const appBase = resolve(process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app"));
const modsBase = join(appBase, "mods");
const helperName = `quota-manager-setup-${randomUUID()}`;
const target = resolve(modsBase, helperName);
const scratch = await mkdtemp(join(tmpdir(), "quota-local-setup-"));
let published = false;
function app(args) {
  const result = spawnSync("herdr-app", args, { encoding: "utf8", timeout: 30000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Herdr setup ${args[0]} failed (exit ${result.status}): ${(result.stderr || result.stdout).trim()}`);
  if (args[0] === "do" && JSON.parse(result.stdout).error) throw new Error("Herdr setup action was rejected");
  return result.stdout;
}
async function state() {
  const raw = JSON.parse(await readFile(join(appBase, "shared.json"), "utf8"));
  return raw["quota-manager.v1.config"];
}
try {
  const before = await state();
  const status = JSON.parse(app(["status"]));
  if (status.overlays?.length) throw new Error("Close the current Herdr overlay before applying local settings");
  for (const file of ["config.js", "providers.js"]) await cp(resolve("mods/quota-manager", file), join(scratch, file));
  await writeFile(join(scratch, "mod.json"), JSON.stringify({ place: "none", overlay: { width: 380, height: 100 } }));
  await writeFile(join(scratch, "main.js"), `import { View, div } from "gpui-kit";
import { shared, setShared, props, closeOverlay } from "herdr";
import { CONFIG_KEY, normalizeConfig, changeConfig } from "./config.js";
export default class LocalSetup extends View {
  init(_props, cx) {
    const cfg = normalizeConfig(shared(CONFIG_KEY));
    const providers = Object.fromEntries(["codex", "agy", "grok", "cursor"].map(id => [id,
      { ...cfg.providers[id], query: id !== "cursor" }]));
    setShared(CONFIG_KEY, changeConfig(cfg, { scope: "local", providers, consent: true }));
    const overlay = props()?.overlay;
    if (overlay) cx.timer.after(500, () => closeOverlay(overlay));
  }
  render() { return div().p(12).child("Local quota queries configured"); }
}
`);
  // The temporary helper is checked separately. The actual product is installed
  // exclusively by scripts/install.mjs; this helper never replaces product files.
  app(["check", scratch]);
  await mkdir(modsBase, { recursive: true });
  await mkdir(target);
  published = true;
  await cp(scratch, target, { recursive: true });
  app(["do", "mod.open", JSON.stringify({ name: helperName })]);
  let configured = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    const cfg = await state();
    if (cfg?.revision > (before?.revision ?? -1) && cfg.scope === "local" && cfg.consent === true &&
      ["codex", "agy", "grok"].every(id => cfg.providers?.[id]?.query === true) && cfg.providers?.cursor?.query === false) {
      configured = true;
      console.log(JSON.stringify({ configured: true, scope: cfg.scope, consent: cfg.consent,
        queries: ["codex", "agy", "grok"], hiddenCursorQuery: cfg.providers.cursor.query, revision: cfg.revision }));
      break;
    }
  }
  if (!configured) throw new Error("Local settings were not confirmed in Herdr state");
  await new Promise(resolve => setTimeout(resolve, 600));
} finally {
  if (published) {
    if (!target.startsWith(resolve(modsBase) + sep) || basename(target) !== helperName) throw new Error("Invalid setup cleanup target");
    await rm(target, { recursive: true, force: true });
  }
  const tempRoot = resolve(tmpdir()) + sep;
  if (!resolve(scratch).startsWith(tempRoot)) throw new Error("Invalid temporary cleanup target");
  await rm(scratch, { recursive: true, force: true });
  // Herdr may create an empty per-Mod data directory for the temporary helper.
  // rmdir refuses nonempty directories and never recursively removes app data.
  await rmdir(join(appBase, "data", helperName)).catch(error => {
    if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
  });
}
