# Charon for Aeon

Runtime guardrails for Aeon skill runs.

Charon guards what crosses during autonomous Aeon runs.

Charon installs into an Aeon fork, patches the skill execution path, and enforces policy before Claude runs. It is built for unattended Aeon workflows where secrets, file access, network calls, and irreversible commands need a boundary.

**Install**

Recommended one-command setup inside an Aeon fork:

```bash
npx charon setup --commit
git push
```

This installs Charon, generates a starter policy, verifies the integration,
and commits the required files.

After pulling upstream Aeon updates:

```bash
npx charon sync --commit
```

This re-applies the workflow guard and verifies Charon is still active.

Lower-level commands:

```bash
npx charon install
charon status
charon compile
charon passport
charon passport contract-audit
charon receipts list
charon receipts latest
charon receipts inspect latest
charon uninstall
```

**What It Does**

- install-once Aeon workflow integration
- per-run receipts
- denied secret unsets before Claude runs
- `curl`/`wget`/`gh api` host allowlist shims
- global red-line blocked hosts
- red-line file read blocking for common read commands
- irreversible command blocking for common high-impact commands
- prompt redaction before Claude receives the prompt
- sandbox backend detection with shim fallback
- starter policy generation from installed Aeon skills
- skill passports for blast-radius inspection
- receipt summaries and JSON inspection

**Passports**

```bash
charon passport
charon passport contract-audit
charon passport contract-audit --json
```

Passports summarize inferred risk before a skill runs:

- secrets referenced by the skill
- network hosts inferred from the skill
- write surfaces such as articles, memory, issues, or social posts
- irreversible action hints
- a low/medium/high risk label

**Receipts**

```bash
charon receipts list
charon receipts latest
charon receipts inspect latest
```

Receipts summarize what happened during guarded runs:

- verdict
- skill name
- prompt redactions
- allowed events
- blocked events
- raw JSON for deeper inspection

**Aeon Auth**

- Charon does not require an `ANTHROPIC_API_KEY` specifically.
- Real `aeon.yml` runs still need whatever Aeon auth path the fork uses:
  - `CLAUDE_CODE_OAUTH_TOKEN`
  - `ANTHROPIC_API_KEY`
  - `BANKR_LLM_KEY` when `gateway.provider=bankr`
- In our real Actions test, Charon executed correctly before Claude. The downstream Aeon skill run stopped only because the private test repo had no Aeon auth secret configured.

**What Is Still In Progress**

- full OS-level file sandboxing
- post-Claude output redaction
- active OS sandbox execution backend

**Verification**

```bash
npm run smoke
npm test
```
