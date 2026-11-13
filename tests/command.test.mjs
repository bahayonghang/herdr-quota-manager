import test from "node:test";
import assert from "node:assert/strict";
import { fetchQuota, commandsFor, QUERY_TIMEOUT } from "../mods/quota-manager/command.js";
import { report, NOW } from "./helpers.mjs";

const ok = { code: 0, stdout: JSON.stringify(report()), stderr: "" };
const unexpectedExec = async () => { throw new Error("exec must not be called for local queries"); };

test("local query calls in-Mod runner directly without exec and passes home/appHome/force", async () => {
  const calls = [];
  const lanes = await fetchQuota(unexpectedExec, "codex", {
    on: null,
    platform: "windows",
    force: false,
    now: () => NOW,
    local: {
      home: () => "/h",
      appHome: () => "/a",
      query: async (id, options) => {
        calls.push([id, options]);
        return JSON.stringify(report(id, { accountKeys: ["user@example.com"], error: { message: "secret token" } }));
      },
    },
  });
  assert.deepEqual(calls, [["codex", { force: false, platform: "windows", home: "/h", appHome: "/a" }]]);
  assert.equal(lanes[0].windows[0].remaining, 25);
  assert.equal(JSON.stringify(lanes).includes("user@example.com"), false);
  assert.equal(JSON.stringify(lanes).includes("secret token"), false);
});

test("local manual reads pass force: true and never invoke exec", async () => {
  const calls = [];
  await fetchQuota(unexpectedExec, "codex", {
    on: null,
    platform: "linux",
    force: true,
    now: () => NOW,
    local: {
      home: () => "/h",
      appHome: () => "/a",
      query: async (id, options) => {
        calls.push([id, options]);
        return JSON.stringify(report(id));
      },
    },
  });
  assert.deepEqual(calls, [["codex", { force: true, platform: "linux", home: "/h", appHome: "/a" }]]);
});

test("no arbitrary provider can enter commandsFor or fetchQuota", async () => {
  for (const id of ["codex & whoami", "codex\nls", "$(env)", "codex,cursor", "../codex"]) {
    assert.throws(() => commandsFor(id));
    await assert.rejects(() => fetchQuota(unexpectedExec, id, { on: null, local: { query: async () => "{}" } }));
  }
});

test("local malformed or unsupported schema throws invalid_report", async () => {
  await assert.rejects(() => fetchQuota(unexpectedExec, "codex", {
    on: null,
    local: { query: async () => "not JSON" },
  }), e => e.message === "invalid_report");
  await assert.rejects(() => fetchQuota(unexpectedExec, "codex", {
    on: null,
    local: { query: async () => JSON.stringify({ schemaVersion: 99, generatedAt: new Date(NOW).toISOString(), providers: [] }) },
  }), e => e.message === "invalid_report");
});

test("local errors map timeout to host_unavailable and generic failures to redacted cli_failed", async () => {
  await assert.rejects(() => fetchQuota(unexpectedExec, "codex", {
    on: null,
    local: { query: async () => { throw new Error("request timed out at C:\\secret\\auth.json"); } },
  }), e => e.message === "host_unavailable");
  await assert.rejects(() => fetchQuota(unexpectedExec, "codex", {
    on: null,
    local: { query: async () => { throw new Error("Bearer raw-secret-token"); } },
  }), e => e.message === "cli_failed");
});

test("remote Windows .cmd shim fallback passes fixed provider flags and timeout", async () => {
  let calls = 0;
  await fetchQuota(async (command, args, options) => {
    assert.equal(options.on, "remote");
    assert.equal(options.timeout, QUERY_TIMEOUT);
    if (!calls++) throw new Error("cannot start");
    assert.equal(command, "cmd.exe");
    assert.equal(args[0], "/d");
    assert.equal(args.at(-1), "quota-axi --json --provider codex --no-credential-refresh --max-age 90s");
    return ok;
  }, "codex", {
    platform: "windows",
    on: "remote",
    now: () => NOW,
    local: { query: async () => { throw new Error("local runner must not run for remote"); } },
  });
  assert.equal(calls, 2);
});

test("remote fallbacks try quota-axi, sh, cmd.exe and never fall back to local execution", async () => {
  let calls = 0;
  let localCalled = false;
  await assert.rejects(fetchQuota(async (command, args, options) => {
    calls++;
    assert.equal(options.on, "remote host");
    assert.notEqual(command, "node");
    assert.equal(JSON.stringify(args).includes("query.mjs"), false);
    return { code: 127, stderr: "Bearer secret" };
  }, "codex", {
    on: "remote host",
    now: () => NOW,
    local: { query: async () => { localCalled = true; return JSON.stringify(report()); } },
  }), e => e.message === "cli_missing");
  assert.equal(calls, 3);
  assert.equal(localCalled, false);
});

test("remote structured exit code 1 is parsed once without shell fallback", async () => {
  let calls = 0;
  const lanes = await fetchQuota(async (_command, _args, options) => {
    calls++;
    assert.equal(options.on, "remote");
    return { ...ok, code: 1, stdout: JSON.stringify(report("codex", { state: { status: "auth_required" }, windows: [] })) };
  }, "codex", { on: "remote", now: () => NOW });
  assert.equal(calls, 1);
  assert.equal(lanes[0].status, "auth_required");
});

test("remote non-JSON success and validation exit code fail once without retrying", async () => {
  let nonJsonCalls = 0;
  await assert.rejects(fetchQuota(async () => { nonJsonCalls++; return { ...ok, stdout: "not JSON" }; }, "codex", { on: "remote" }), /invalid_report/);
  assert.equal(nonJsonCalls, 1);

  let exitTwoCalls = 0;
  await assert.rejects(fetchQuota(async () => { exitTwoCalls++; return { code: 2, stderr: "secret", stdout: "" }; }, "codex", { on: "remote" }), /cli_failed/);
  assert.equal(exitTwoCalls, 1);

  let timeoutCalls = 0;
  await assert.rejects(fetchQuota(async () => { timeoutCalls++; throw new Error("timed out"); }, "codex", { on: "remote" }), /host_unavailable/);
  assert.equal(timeoutCalls, 1);
});
