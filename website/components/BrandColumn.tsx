"use client";

export default function BrandColumn() {
  return (
    <aside
      style={{
        borderRight: "1px solid #1e1a1a",
        padding: "48px 40px 48px 40px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: "calc(100vh - 49px)",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "44px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div
            style={{
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.2em",
              color: "#5a5454",
            }}
          >
            local policy plane
          </div>
          <h1
            style={{
              fontSize: "clamp(2.1rem, 3.8vw, 3rem)",
              fontWeight: 700,
              lineHeight: 1.04,
              letterSpacing: "-0.03em",
              textTransform: "uppercase",
            }}
          >
            Before agents
            <br />
            act, Charon
            <br />
            decides.
          </h1>
          <p
            style={{
              fontSize: "13px",
              lineHeight: 1.8,
              color: "#8a8282",
              maxWidth: "340px",
            }}
          >
            A local boundary for shell commands, file access, network calls,
            and MCP tools. Charon checks the action first, returns a verdict,
            then writes proof of the decision.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", border: "1px solid #1e1a1a" }}>
          <Verdict label="PASS" sub="launch" color="#4a8a5c" />
          <Verdict label="PAUSE" sub="review" color="#c49a74" />
          <Verdict label="DENY" sub="block" color="#a05040" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0", border: "1px solid #1e1a1a" }}>
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid #1e1a1a",
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: "#5a5454",
            }}
          >
            Boundary contract
          </div>
          <ContractRow label="input" value="typed agent action" />
          <ContractRow label="checks" value="policy + inspection" />
          <ContractRow label="output" value="verdict + receipt" />
          <ContractRow label="storage" value=".charon/receipts" />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          fontSize: "11px",
          color: "#5a5454",
        }}
      >
        <div style={{ fontSize: "10px" }}>v0.2.0</div>
      </div>
    </aside>
  );
}

function Verdict({ label, sub, color }: { label: string; sub: string; color: string }) {
  return (
    <div style={{ padding: "12px", borderRight: "1px solid #1e1a1a", display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ color, fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ color: "#5a5454", fontSize: "11px" }}>{sub}</span>
    </div>
  );
}

function ContractRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "86px 1fr", padding: "9px 12px", borderBottom: "1px solid #1e1a1a", fontSize: "12px" }}>
      <span style={{ color: "#5a5454" }}>{label}</span>
      <span style={{ color: "#8a8282", fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
}
