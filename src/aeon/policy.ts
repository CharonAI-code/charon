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
        { id: "aeon.intent_secret_exfil.deny", verdict: "DENY", role: "unknown", includes: "aeon.intent:secret-exfil" },
        { id: "aeon.webhook_exfil.deny", verdict: "DENY", role: "fetch-url", includes: "webhook.site" },
        { id: "aeon.interact_exfil.deny", verdict: "DENY", role: "fetch-url", includes: "interact.sh" },
        { id: "aeon.ngrok_exfil.deny", verdict: "DENY", role: "fetch-url", includes: "ngrok" },
        { id: "aeon.intent_delete.deny", verdict: "DENY", role: "delete-path", includes: "." },
        { id: "aeon.workflow_write.pause", verdict: "PAUSE", role: "write-path", includes: "" },
        { id: "aeon.external_feature.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:external-feature" },
        { id: "aeon.auto_merge.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:auto-merge" },
        { id: "aeon.deploy.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:deploy-prototype" },
        { id: "aeon.wallet.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:vigil-revoke" },
        { id: "aeon.workflow_edit.deny", verdict: "DENY", role: "mcp-tool", includes: "aeon.skill:workflow-audit" },
      ],
    },
  };
}

module.exports = { defaultAeonPolicy };
