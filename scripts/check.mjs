import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
async function walk(folder) {
  const result = [];
  for (const item of await readdir(folder, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(item.name)) continue;
    const path = join(folder, item.name);
    result.push(...(item.isDirectory() ? await walk(path) : [path]));
  }
  return result;
}
let count = 0;
for (const path of await walk(root)) {
  if (path.endsWith(".json")) JSON.parse(await readFile(path, "utf8"));
  if (/\.(?:js|mjs)$/.test(path)) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    count++;
  }
  if (path.includes(`${join("mods", "quota-manager")}`) && path.endsWith(".js")) {
    const code = await readFile(path, "utf8");
    if (/\b(?:setTimeout|setInterval|require)\s*\(|from\s+["']node:/.test(code)) throw new Error(`Non-Herdr runtime API: ${path}`);
  }
}
console.log(`Syntax and JSON checks passed (${count} JavaScript modules). Native validation is separate: npm run check:herdr`);
