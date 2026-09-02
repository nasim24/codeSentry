"use client";

import { useEffect, useState } from "react";
import { GitMerge, Shield, TrendingUp, AlertTriangle } from "lucide-react";

interface Stats {
  total_mrs: number;
  open_mrs: number;
  reviewed: number;
  critical: number;
  avg_score: number;
}

export default function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats);
  }, []);

  const items = [
    {
      label: "Open MRs",
      value: stats?.open_mrs ?? "—",
      icon: GitMerge,
      color: "#7c6cfc",
    },
    {
      label: "Reviewed",
      value: stats?.reviewed ?? "—",
      icon: Shield,
      color: "#00d084",
    },
    {
      label: "Avg Score",
      value: stats ? `${stats.avg_score}/100` : "—",
      icon: TrendingUp,
      color: "#f5a623",
    },
    {
      label: "Critical",
      value: stats?.critical ?? "—",
      icon: AlertTriangle,
      color: "#ff3b30",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
        marginBottom: 24,
      }}
      className="stagger"
    >
      {items.map(({ label, value, icon: Icon, color }) => (
        <div
          key={label}
          className="animate-fade-up"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                letterSpacing: "0.1em",
              }}
            >
              {label.toUpperCase()}
            </span>
            <Icon size={13} color={color} opacity={0.8} />
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}