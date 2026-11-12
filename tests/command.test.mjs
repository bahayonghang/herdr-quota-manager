import test from "node:test";
import assert from "node:assert/strict";
import { fetchQuota, commandsFor } from "../mods/quota-manager/command.js";
import { report, NOW } from "./helpers.mjs";
const ok = { code: 0, stdout: JSON.stringify(report()), stderr: "" };
test("direct argv selects exactly one provider and disables credential refresh", async () => {
  await fetchQuota(async (command, args, options) => {
    assert.equal(command, "quota-axi");
    assert.deepEqual(args, ["--json", "--provider", "codex", "--no-credential-refresh", "--max-age", "90s"]);
    assert.equal(options.timeout, 45000); return ok;
  }, "codex", { now: () => NOW });
});
test("manual reads bypass upstream fresh reuse", () => assert.equal(commandsFor("codex", "windows", true)[0][1].at(-1), "0"));
test("no arbitrary provider can enter a shell command", () => {
  for (const id of ["codex & whoami", "codex\nls", "$(env)", "codex,cursor", "../codex"])
    assert.throws(() => commandsFor(id));
});
test("Windows .cmd shim fallback is fixed and still provider-scoped", async () => {
  let calls = 0;
  await fetchQuota(async (command, args) => {
    if (!calls++) throw new Error("cannot start");
    assert.equal(command, "cmd.exe"); assert.equal(args[0], "/d");
    assert.equal(args.at(-1), "quota-axi --json --provider codex --no-credential-refresh --max-age 90s"); return ok;
  }, "codex", { platform: "windows", now: () => NOW });
  assert.equal(calls, 2);
});
test("remote fallbacks never fall back to local execution", async () => {
  let calls = 0;
  await fetchQuota(async (_command, _args, options) => {
    assert.equal(options.on, "remote host");
    if (++calls < 3) throw new Error("not installed"); return ok;
  }, "codex", { on: "remote host", now: () => NOW });
  assert.equal(calls, 3);
});
test("structured exit code 1 is retained without duplicate queries", async () => {
  let calls = 0;
  const lanes = await fetchQuota(async () => { calls++; return { ...ok, code: 1, stdout: JSON.stringify(report("codex", { state: { status: "auth_required" }, windows: [] })) }; }, "codex", { now: () => NOW });
  assert.equal(calls, 1); assert.equal(lanes[0].status, "auth_required");
});
test("non-JSON success fails once without trying other shells", async () => {
  let calls = 0;
  await assert.rejects(fetchQuota(async () => { calls++; return { ...ok, stdout: "not JSON" }; }, "codex"), /invalid_report/);
  assert.equal(calls, 1);
});
test("validation exit code does not trigger another execution", async () => {
  let calls = 0;
  await assert.rejects(fetchQuota(async () => { calls++; return { code: 2, stderr: "secret", stdout: "" }; }, "codex"), /cli_failed/);
  assert.equal(calls, 1);
});
test("timeouts do not spawn alternate shell queries", async () => {
  let calls = 0;
  await assert.rejects(fetchQuota(async () => { calls++; throw new Error("timed out at sensitive path"); }, "codex"), /host_unavailable/);
  assert.equal(calls, 1);
});
test("missing collector errors contain no raw process stderr", async () => {
  await assert.rejects(fetchQuota(async () => ({ code: 127, stderr: "Bearer secret" }), "codex"), e => e.message === "cli_missing");
});
