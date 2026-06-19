// @ts-nocheck
"use strict";

function defaultAeonPolicy() {
  return {
    version: 1,
    defaultVerdict: "PASS",
    bounds: {
      pass: [],
      pause: [],
      deny: [],
      rules: [
        { id: "aeon.secret_exfil.deny", verdict: "DENY", role: "unknown", includes: "aeon.intent:secret-exfil" },
        { id: "aeon.webhook_exfil.deny", verdict: "DENY", role: "fetch-url", includes: "webhook.site" },
        { id: "aeon.interact_exfil.deny", verdict: "DENY", role: "fetch-url", includes: "interact.sh" },
        { id: "aeon.ngrok_exfil.deny", verdict: "DENY", role: "fetch-url", includes: "ngrok" },
        { id: "aeon.repo_wipe.deny", verdict: "DENY", role: "delete-path", includes: "." },
        { id: "aeon.repo_actions.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:repo-actions" },
        { id: "aeon.pr_review.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:pr-review" },
        { id: "aeon.issue_triage.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:issue-triage" },
        { id: "aeon.auto_merge.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:auto-merge" },
        { id: "aeon.deploy.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:deploy-prototype" },
        { id: "aeon.wallet.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:vigil-revoke" },
        { id: "aeon.workflow_audit.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:workflow-audit" },
      ],
    },
  };
}

module.exports = { defaultAeonPolicy };
