"use client";

import Link from "next/link";
import { GitBranch, Clock, User } from "lucide-react";
import type { MR } from "@/lib/db";

function scoreColor(score: number | null) {
  if (!score) return "var(--text-muted)";
  if (score >= 90) return "#00d084";
  if (score >= 70) return "#f5a623";
  if (score >= 50) return "#ff8c00";
  return "#ff3b30";
}

function scoreEmoji(score: number | null) {
  if (!score) return "⬜";
  if (score >= 90) return "🟢";
  if (score >= 70) return "🟡";
  if (score >= 50) return "🟠";
  return "🔴";
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function MRCard({ mr }: { mr: MR }) {
  const reviewed = mr.score !== null;

  return (
    <Link
      href={`/mr/${mr.mr_iid}`}
      style={{ textDecoration: "none" }}
    >
      <div
        className="animate-fade-up"
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "14px 16px",
          cursor: "pointer",
          transition: "all 0.15s ease",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor =
            "var(--border-light)";
          (e.currentTarget as HTMLDivElement).style.background =
            "var(--bg-tertiary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor =
            "var(--border)";
          (e.currentTarget as HTMLDivElement).style.background =
            "var(--bg-secondary)";
        }}
      >
        {/* Score circle */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: `2px solid ${reviewed ? scoreColor(mr.score) : "var(--border-light)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: reviewed ? 12 : 10,
            fontWeight: 700,
            color: reviewed ? scoreColor(mr.score) : "var(--text-muted)",
            background: reviewed
              ? `${scoreColor(mr.score)}15`
              : "var(--bg-tertiary)",
          }}
        >
          {reviewed ? mr.score : "—"}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 5,
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "var(--accent)",
                fontWeight: 600,
              }}
            >
              !{mr.mr_iid}
            </span>
            <span
              style={{
                fontSize: 13,
                color: "var(--text-primary)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {mr.title}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <User size={10} />
              @{mr.author}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <GitBranch size={10} />
              {mr.source_branch} → {mr.target_branch}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={10} />
              {timeAgo(mr.updated_at)}
            </span>
          </div>
        </div>

        {/* Issue badges */}
        {reviewed && (
          <div
            style={{
              display: "flex",
              gap: 5,
              flexShrink: 0,
              alignItems: "center",
            }}
          >
            {(mr.critical_count ?? 0) > 0 && (
              <span
                style={{
                  fontSize: 10,
                  color: "#ff3b30",
                  background: "rgba(255,59,48,0.12)",
                  padding: "2px 7px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                {mr.critical_count}C
              </span>
            )}
            {(mr.high_count ?? 0) > 0 && (
              <span
                style={{
                  fontSize: 10,
                  color: "#ff8c00",
                  background: "rgba(255,140,0,0.12)",
                  padding: "2px 7px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                {mr.high_count}H
              </span>
            )}
            {(mr.medium_count ?? 0) > 0 && (
              <span
                style={{
                  fontSize: 10,
                  color: "#f5a623",
                  background: "rgba(245,166,35,0.12)",
                  padding: "2px 7px",
                  borderRadius: 4,
                }}
              >
                {mr.medium_count}M
              </span>
            )}
            {(mr.low_count ?? 0) > 0 && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  background: "var(--bg-tertiary)",
                  padding: "2px 7px",
                  borderRadius: 4,
                }}
              >
                {mr.low_count}L
              </span>
            )}
          </div>
        )}

        {!reviewed && (
          <span
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              background: "var(--bg-tertiary)",
              padding: "3px 8px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            pending
          </span>
        )}

        {/* Arrow */}
        <span style={{ color: "var(--text-muted)", fontSize: 16, flexShrink: 0 }}>
          →
        </span>
      </div>
    </Link>
  );
}