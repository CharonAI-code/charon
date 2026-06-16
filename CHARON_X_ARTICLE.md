# Charon: runtime security for AI agent actions

AI agents are getting access to real tools: shell, files, git, HTTP, package managers, API clients, and MCP servers.

That gives them power to build. It also gives them power to leak, overwrite, publish, push, delete, and call systems the user never meant to expose.

Charon is a local runtime boundary for those actions.

It checks what an agent is about to do before the machine does it.

Use visual 1 here: article cover.

---

## 1. The Problem

Agent security cannot stop at instructions.

Instructions live inside model context. Tool output, user messages, repo content, and remote data all enter that same reasoning path. A policy written as text is still text the model has to interpret while deciding what to do.

Execution policy needs runtime facts:

- exact command or tool call
- touched files, domains, and resources
- expected side effects
- expanded package scripts
- active policy version
- whether execution launched

The paper *Formal Policy Enforcement for Real-World Agentic Systems* argues for policy checks outside the agent reasoning path, at policy-relevant decisions. That maps cleanly to agent runtimes: inspect the attempted action before execution, decide with policy, then enforce the verdict.

Charon implements that control point locally.

---

## 2. Policy Enforcement

Charon treats every attempted operation as an action that needs a verdict before launch.

The verdict is small on purpose:

- `PASS`: execute
- `PAUSE`: wait for review
- `DENY`: block

Policy is evaluated outside the model context. The agent can propose an action, but Charon decides whether that action crosses a local boundary.

Use visual 2 here: runtime flow.

---

## 3. How Charon Works

Charon turns tool activity into a policy-checkable runtime event.

1. **Capture:** The runtime receives a raw tool call with the tool name, arguments, and working directory.

2. **Normalize:** Charon converts that raw call into an `ActionRequest`, so shell, files, HTTP, git, package scripts, and MCP tools can share one action model.

3. **Canonicalize:** Paths resolve, URLs normalize, domains extract, and git remotes parse before policy runs.

4. **Evaluate:** `charon.yml` rules run in order. First match wins. If nothing matches, the default verdict applies.

5. **Inspect:** Detectors run after policy evaluation. Findings can escalate a verdict, never downgrade it.

6. **Decide:** Charon returns `PASS`, `PAUSE`, or `DENY`.

7. **Record:** A signed local receipt stores the action, verdict, matched rule, policy hash, redactions, and launch status.

This gives Charon enough structure to reason about the operation itself: touched resource, possible side effect, matched rule, and execution status.

---

## 4. Runtime Surfaces

The first supported surfaces are:

- shell
- files
- HTTP
- secrets
- git
- package managers
- MCP tools

Use visual 3 here: action surface.

The interesting cases are not only direct commands. Charon also handles cases where the risky operation is hidden behind another layer:

- chained shell commands
- package script expansion
- env-indirected URLs
- MCP calls with remote side effects
- secret-looking output in receipts

Those cases are normalized before policy is evaluated.

---

## 5. Codex And MCP

The current MVP supports Codex and MCP.

First-time setup:

```bash
npx github:CharonAI-code/charon setup
```

That creates `charon.yml`, local identity keys, receipt storage, queue storage, and the Charon CLI.

Codex enforcement is enabled separately:

```bash
charon enforce codex
```

That disables Codex native shell execution, installs the Charon MCP server, binds it to the current working directory, and requires a Codex restart.

For MCP, Charon can guard existing MCP servers and route tool calls through policy before forwarding them upstream.

AEON and Hermes integrations are planned after the core runtime layer is stable.

---

## 6. Receipts

A receipt is the local record of a runtime decision.

It answers:

- what action was requested?
- what verdict was returned?
- which rule matched?
- did execution launch?
- what policy hash made the decision?
- what sensitive values were redacted?

Use visual 4 here: website simulation or receipt screenshot.

Receipts make agent behavior easier to debug and audit without exposing secrets again.

Receipts are local-first and signed with the workspace Ed25519 identity. `charon verify` can check the signature and hashes.

---

## 7. Current Status

Charon is early MVP.

Live today:

- Codex setup
- MCP guard
- local shell gate
- default policy
- receipts
- restore path

The current focus is making the runtime boundary reliable, local, and easy to install.

GitHub: https://github.com/CharonAI-code/charon

Website: https://charon.codes

---

## Research / References

- Formal Policy Enforcement for Real-World Agentic Systems
  https://arxiv.org/abs/2602.16708

- From Prompt Injections to Protocol Exploits
  https://arxiv.org/html/2506.23260v1

- AgentBound: Securing Execution Boundaries of AI Agents
  https://programming-group.com/assets/pdf/papers/2026_AgentBound-Securing-Execution-Boundaries-of-AI-Agents.pdf

- OWASP Agentic AI Threats and Mitigations
  https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/

- Microsoft: When prompts become shells
  https://www.microsoft.com/en-us/security/blog/2026/05/07/prompts-become-shells-rce-vulnerabilities-ai-agent-frameworks/
