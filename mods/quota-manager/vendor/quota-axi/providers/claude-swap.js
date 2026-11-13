// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
export const CLAUDE_SWAP_SOURCE = "claude-swap";
export const CLAUDE_SWAP_EXECUTABLE_REMEDY = "pipx install claude-swap";
export function claudeSwapEnabled() { return false; }
export async function readClaudeSwapAccounts() { return []; }
