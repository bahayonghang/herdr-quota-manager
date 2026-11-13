// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
export async function fetchClaudeNativeQuota() {
  return { status: "skipped", source: "claude-native", error: "claude_native_incompatible" };
}
