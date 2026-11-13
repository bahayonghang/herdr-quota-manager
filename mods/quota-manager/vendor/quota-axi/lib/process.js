// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
export async function execFileText() { throw Object.assign(new Error("Subprocess disabled"), { code: "ENOENT" }); }
export async function commandExists() { return false; }
export async function findCommandPath() { return undefined; }
export function terminateChild() {}
export function currentUserProcessListArgs() { return []; }
