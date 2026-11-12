import { resolve } from "node:path";
import { nativeCheck } from "./install.mjs";
try {
  nativeCheck(resolve(process.argv[2] ?? "mods/quota-manager"));
  console.log("Herdr initial-render check passed. This does not validate later async states or live accounts.");
} catch (e) { console.error(e.message); process.exitCode = 1; }
