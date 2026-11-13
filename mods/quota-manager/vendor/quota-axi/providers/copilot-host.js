// Adapted from quota-axi 0.1.69 (5734c41eee52eb9a80ba67f47269ebc06c0c41fc), MIT License, Copyright (c) 2026 Kun Chen.
import { runtimeProcess } from "../runtime.js";
const PUBLIC_GITHUB_HOST = "github.com";
const GHE_CLOUD_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ghe\.com$/;
/**
 * The GitHub host whose Copilot quota is read. It is `github.com` unless
 * `QUOTA_AXI_COPILOT_HOST` opts into one GitHub Enterprise Cloud host with data
 * residency (`<subdomain>.ghe.com`), whose API lives at `api.<host>`. Any other
 * value is ignored so a token can never be sent to an arbitrary host.
 */
export function copilotGithubHost(environment = runtimeProcess.env) {
    const configured = environment.QUOTA_AXI_COPILOT_HOST?.trim().toLowerCase();
    return configured && GHE_CLOUD_HOST.test(configured)
        ? configured
        : PUBLIC_GITHUB_HOST;
}
