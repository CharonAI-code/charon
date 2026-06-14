"use client";

import BrandColumn from "../components/BrandColumn";
import SimulationTerminal from "../components/SimulationTerminal";
import CharonSections from "../components/CharonSections";
import Link from "next/link";

export default function Home() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <nav
        className="charon-nav"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 40px",
          borderBottom: "1px solid #1e1a1a",
          fontSize: "12px",
          position: "sticky",
          top: 0,
          background: "#0c0a0a",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "12px", height: "12px", background: "#e8a040", boxShadow: "0 0 8px rgba(232,160,64,0.4)" }} />
          <span style={{ fontWeight: 700, letterSpacing: "0.05em" }}>CHARON</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "24px", color: "#8a8282" }}>
          <a href="https://github.com/CharonAI-code/charon">gh</a>
          <a href="https://x.com/Charon_AI">x</a>
          <Link href="/docs" style={{ color: "#5a5454", textDecoration: "none" }}>docs</Link>
        </div>
      </nav>

      <div className="charon-hero-grid" style={{ display: "grid", gridTemplateColumns: "480px 1fr" }}>
        <BrandColumn />
        <SimulationTerminal />
      </div>

      <CharonSections />

      <footer
        className="charon-footer"
        style={{
          borderTop: "1px solid #1e1a1a",
          padding: "28px 40px",
          display: "flex",
          justifyContent: "space-between",
          gap: "16px",
          color: "#5a5454",
          fontSize: "11px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <span>Charon v0.2.0</span>
        <span>local policy plane / trusted receipts / mcp boundary</span>
      </footer>

    </div>
  );
}
