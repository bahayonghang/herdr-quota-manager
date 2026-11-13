import { assertProvider } from "./providers.js";
import { parseReport, normalizeReport } from "./model.js";
import { queryLocalQuota } from "./vendor/quota-axi/index.js";

export const QUERY_TIMEOUT = 45000;

export function queryArgs(id, force = false) {
  return ["--json", "--provider", assertProvider(id), "--no-credential-refresh", "--max-age", force ? "0" : "90s"];
}

export function commandsFor(id, platform = "unknown", force = false) {
  const args = queryArgs(id, force);
  // Remote lookup only. The shell string is the command name plus fixed flags.
  const command = ["quota-axi", ...args].join(" ");
  const direct = ["quota-axi", args];
  const windows = ["cmd.exe", ["/d", "/s", "/c", command]];
  const unix = ["sh", ["-c", `exec "${"${SHELL:-/bin/sh}"}" -lic '${command}' </dev/null`]];
  return platform === "windows" ? [direct, windows] : platform === "unknown" ? [direct, unix, windows] : [direct, unix];
}

export async function fetchQuota(exec, id, { on = null, platform = "unknown", force = false, now = Date.now, local = null } = {}) {
  const providerId = assertProvider(id);
  if (on == null) {
    const runner = typeof local === "function" ? local : (local?.query ?? queryLocalQuota);
    const home = typeof local?.home === "function" ? local.home() : (local?.home ?? "");
    const appHome = typeof local?.appHome === "function" ? local.appHome() : (local?.appHome ?? "");
    let raw;
    try {
      raw = await runner(providerId, { force, platform, home, appHome });
    } catch (error) {
      const msg = error?.message ?? "";
      if (/timeout|timed out|unreachable|disconnect|offline/i.test(String(error))) throw new Error("host_unavailable");
      if (msg === "invalid_report" || msg === "cli_missing") throw new Error(msg);
      throw new Error("cli_failed");
    }
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    return normalizeReport(parseReport(text), providerId, now());
  }

  for (const [command, args] of commandsFor(providerId, platform, force)) {
    let result;
    try { result = await exec(command, args, { on, timeout: QUERY_TIMEOUT }); }
    catch (error) {
      if (/timeout|timed out|unreachable|disconnect|offline/i.test(String(error))) throw new Error("host_unavailable");
      continue; // Could not start: try the platform's shim / login-shell lookup.
    }
    if ([127, 9009].includes(result.code)) continue;
    // Exit 1 still carries a useful structured all-failed provider report. Never run it twice.
    if (![0, 1].includes(result.code)) throw new Error("cli_failed");
    return normalizeReport(parseReport(result.stdout), providerId, now());
  }
  throw new Error("cli_missing");
}
