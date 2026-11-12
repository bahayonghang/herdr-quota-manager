import { assertProvider } from "./providers.js";
import { parseReport, normalizeReport } from "./model.js";
export const QUERY_TIMEOUT = 45000;
export function queryArgs(id, force = false) {
  return ["--json", "--provider", assertProvider(id), "--no-credential-refresh", "--max-age", force ? "0" : "90s"];
}
export function commandsFor(id, platform = "unknown", force = false) {
  const args = queryArgs(id, force);
  // Only fixed flags and allowlisted ids enter these scripts. No paths, tokens or user text.
  const command = ["quota-axi", ...args].join(" ");
  const direct = ["quota-axi", args];
  const windows = ["cmd.exe", ["/d", "/s", "/c", command]];
  const unix = ["sh", ["-c", `exec "${"${SHELL:-/bin/sh}"}" -lic '${command}' </dev/null`]];
  return platform === "windows" ? [direct, windows] : platform === "unknown" ? [direct, unix, windows] : [direct, unix];
}
export async function fetchQuota(exec, id, { on = null, platform = "unknown", force = false, now = Date.now } = {}) {
  for (const [command, args] of commandsFor(id, platform, force)) {
    let result;
    try { result = await exec(command, args, { on, timeout: QUERY_TIMEOUT }); }
    catch (error) {
      if (/timeout|timed out|unreachable|disconnect|offline/i.test(String(error))) throw new Error("host_unavailable");
      continue; // Could not start: try the platform's shim / login-shell lookup.
    }
    if ([127, 9009].includes(result.code)) continue;
    // Exit 1 still carries a useful structured all-failed provider report. Never run it twice.
    if (![0, 1].includes(result.code)) throw new Error("cli_failed");
    return normalizeReport(parseReport(result.stdout), id, now());
  }
  throw new Error("cli_missing");
}
