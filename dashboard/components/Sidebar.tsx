"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitMerge, CheckCircle, BarChart2, Code2, Settings as SettingsIcon } from "lucide-react";
import WebhookStatus from "@/components/WebhookStatus";

const NAV = [
  { href: "/",        label: "Active MRs",  icon: GitMerge,    accent: "#7c6cfc" },
  { href: "/closed",  label: "Closed MRs",  icon: CheckCircle, accent: "#00d084" },
  { href: "/reports", label: "Reports",     icon: BarChart2,   accent: "#f5a623" },
  { href: "/settings", label: "Settings",   icon: SettingsIcon, accent: "#8a8f98" },
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <aside style={{
      width: 220, minWidth: 220,
      background: "var(--bg-secondary)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      height: "100vh", position: "sticky", top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #7c6cfc, #a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Code2 size={15} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>CodeSentryAI</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>AI Code Reviewer</div>
        </div>
      </div>

      {/* Real webhook status — checks every 30s */}
      <WebhookStatus />

      {/* Nav */}
      <nav style={{ padding: "12px 10px", flex: 1 }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", padding: "0 8px 8px" }}>
          NAVIGATION
        </div>
        {NAV.map(({ href, label, icon: Icon, accent }) => {
          const active = path === href;
          return (
            <Link key={href} href={href} style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "8px 10px", borderRadius: 7, marginBottom: 2,
              fontSize: 13,
              color:          active ? "var(--text-primary)" : "var(--text-secondary)",
              background:     active ? "var(--accent-dim)"   : "transparent",
              border:         active ? "1px solid var(--accent-border)" : "1px solid transparent",
              textDecoration: "none",
              transition:     "all 0.15s ease",
            }}>
              <Icon size={15} color={active ? accent : "var(--text-muted)"} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--text-muted)" }}>
        <div>Powered by Gemma 4</div>
        <div style={{ marginTop: 2 }}>local · private · free</div>
      </div>
    </aside>
  );
}