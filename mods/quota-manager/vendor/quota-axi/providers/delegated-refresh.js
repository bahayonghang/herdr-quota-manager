// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
export const REFRESH_COMMAND_NOT_FOUND = "refresh_command_not_found";
export const REFRESH_SPAWN_FAILED = "refresh_spawn_failed";
export const REFRESH_TIMED_OUT = "refresh_timed_out";
export const REFRESH_EXIT_STATUS = "refresh_exit_status";
export const REFRESH_LIVE_VENDOR_PROCESS = "refresh_live_vendor_process";
export const REFRESH_VENDOR_UNKNOWN = "refresh_vendor_processes_unknown";
export async function runRefreshDelegate() { return { status: "unavailable", error: REFRESH_COMMAND_NOT_FOUND }; }
export function refreshDelegateAttempt(delegate) { return { source: delegate.source, status: "skipped", error: REFRESH_COMMAND_NOT_FOUND }; }
export async function delegateCredentialRefresh(args) { return { attempt: refreshDelegateAttempt(args.delegate) }; }
