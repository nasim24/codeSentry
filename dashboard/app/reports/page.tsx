"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  BarChart2, User, TrendingUp, TrendingDown,
  Calendar, AlertTriangle, GitMerge,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface DeveloperStat {
  author: string;
  mr_count: number;
  avg_score: number;
  total_issues: number;
  critical_count: number;
}

interface MR {
  mr_iid: number;
  title: string;
  author: string;
  score: number | null;
  status: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  reviewed_at: string | null;
  updated_at: string;
}

interface DailyScore {
  date: string;
  avg_score: number;
  mr_count: number;
}

interface Report {
  date?: string;
  from?: string;
  to?: string;
  mrs: MR[];
  developer_stats: DeveloperStat[];
}

// ── Helpers ────────────────────────────────────────────────────

function scoreColor(score: number | null) {
  if (!score) return "var(--text-muted)";
  if (score >= 90) return "#00d084";
  if (score >= 70) return "#f5a623";
  if (score >= 50) return "#ff8c00";
  return "#ff3b30";
}

function getDateRange(preset: string): { from: string; to: string } {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];

  const pad = (d: Date) => d.toISOString().split("T")[0];

  switch (preset) {
    case "today": {
      return { from: today, to: today };
    }
    case "week": {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { from: pad(start), to: today };
    }
    case "month": {
      const start = new Date(now);
      start.setDate(now.getDate() - 29);
      return { from: pad(start), to: today };
    }
    default:
      return { from: today, to: today };
  }
}

type PresetType = "today" | "week" | "month" | "custom";

// ── Score Trend Mini Chart ─────────────────────────────────────

function ScoreTrendChart({ data }: { data: DailyScore[] }) {
  if (!data || data.length === 0) return null;

  const maxScore = 100;
  const minScore = Math.min(...data.map((d) => d.avg_score)) - 5;
  const range    = maxScore - minScore;
  const width    = 600;
  const height   = 80;
  const padX     = 10;
  const padY     = 10;

  const points = data.map((d, i) => {
    const x = padX + (i / Math.max(data.length - 1, 1)) * (width - padX * 2);
    const y = padY + ((maxScore - d.avg_score) / range) * (height - padY * 2);
    return { x, y, ...d };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const areaD = [
    `M ${points[0].x} ${height}`,
    ...points.map((p) => `L ${p.x} ${p.y}`),
    `L ${points[points.length - 1].x} ${height}`,
    "Z",
  ].join(" ");

  const lastScore  = data[data.length - 1]?.avg_score ?? 0;
  const firstScore = data[0]?.avg_score ?? 0;
  const trend      = lastScore - firstScore;

  return (
    <div style={{
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "16px 20px",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 4 }}>
            SCORE TREND
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: scoreColor(lastScore) }}>
              {lastScore.toFixed(1)}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>/100 latest avg</span>
            <span style={{
              fontSize: 11,
              color: trend >= 0 ? "#00d084" : "#ff3b30",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}>
              {trend >= 0
                ? <TrendingUp size={12} />
                : <TrendingDown size={12} />}
              {trend >= 0 ? "+" : ""}{trend.toFixed(1)} vs start
            </span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {data.length} day{data.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* SVG chart */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: 80, overflow: "visible" }}
      >
        {/* Area fill */}
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c6cfc" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#7c6cfc" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#areaGrad)" />

        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke="#7c6cfc"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Dots */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x} cy={p.y} r={3}
              fill="#7c6cfc"
              stroke="var(--bg-secondary)"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>

        {/* X axis labels */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
            {data[0].date.slice(5)}
          </span>
          {data.length > 2 && (
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
              {data[Math.floor(data.length / 2)].date.slice(5)}
            </span>
          )}
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
            {data[data.length - 1].date.slice(5)}
          </span>
        </div>
    </div>
  );
}

// ── Common Issues ──────────────────────────────────────────────

function CommonIssues({ mrs }: { mrs: MR[] }) {
  // Aggregate issue counts from MRs
  const totals = {
    critical: mrs.reduce((s, m) => s + (m.critical_count || 0), 0),
    high:     mrs.reduce((s, m) => s + (m.high_count || 0), 0),
    medium:   mrs.reduce((s, m) => s + (m.medium_count || 0), 0),
    low:      mrs.reduce((s, m) => s + (m.low_count || 0), 0),
  };

  const total = totals.critical + totals.high + totals.medium + totals.low;
  if (total === 0) return null;

  const bars = [
    { label: "Critical", count: totals.critical, color: "#ff3b30", bg: "rgba(255,59,48,0.15)" },
    { label: "High",     count: totals.high,     color: "#ff8c00", bg: "rgba(255,140,0,0.15)" },
    { label: "Medium",   count: totals.medium,   color: "#f5a623", bg: "rgba(245,166,35,0.15)" },
    { label: "Low",      count: totals.low,      color: "#8888a8", bg: "rgba(136,136,168,0.1)" },
  ];

  return (
    <div style={{
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "16px 20px",
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 14 }}>
        ISSUE BREAKDOWN — {total} total issues found
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {bars.map(({ label, count, color, bg }) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, color, minWidth: 56, fontWeight: 600 }}>{label}</span>
              <div style={{ flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: color,
                  borderRadius: 3,
                  transition: "width 0.6s ease",
                }} />
              </div>
              <span style={{
                fontSize: 11,
                color,
                fontWeight: 700,
                background: bg,
                padding: "1px 8px",
                borderRadius: 4,
                minWidth: 28,
                textAlign: "center",
              }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Weekly Summary ─────────────────────────────────────────────

function WeeklySummary({ report }: { report: Report | null }) {
  if (!report || !report.mrs?.length) return null;

  const mrs         = report.mrs;
  const scores      = mrs.map((m) => m.score ?? 0).filter(Boolean);
  const avgScore    = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const devCount    = new Set(mrs.map((m) => m.author)).size;
  const topDev      = report.developer_stats?.[0];
  const mostIssues  = [...(report.developer_stats || [])].sort((a, b) => b.total_issues - a.total_issues)[0];

  return (
    <div style={{
      background: "linear-gradient(135deg, rgba(124,108,252,0.08), rgba(168,85,247,0.05))",
      border: "1px solid var(--accent-border)",
      borderRadius: 10,
      padding: "16px 20px",
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "0.1em", marginBottom: 12 }}>
        PERIOD SUMMARY
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Total MRs Reviewed</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{mrs.length}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Avg Code Score</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(avgScore) }}>{avgScore}/100</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Active Developers</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{devCount}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Most Active Dev</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>
            @{topDev?.author ?? "—"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {topDev?.mr_count ?? 0} MRs
          </div>
        </div>
        {mostIssues && mostIssues.total_issues > 0 && (
          <div style={{ gridColumn: "span 2", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={11} color="#f5a623" />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Most issues: <span style={{ color: "#f5a623" }}>@{mostIssues.author}</span>
                {" "}— {mostIssues.total_issues} issues across {mostIssues.mr_count} MR{mostIssues.mr_count !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────

export default function ReportsPage() {
  const today = new Date().toISOString().split("T")[0];

  const [preset, setPreset]       = useState<PresetType>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo]   = useState(today);
  const [report, setReport]       = useState<Report | null>(null);
  const [trendData, setTrendData] = useState<DailyScore[]>([]);
  const [loading, setLoading]     = useState(false);

  const fetchReport = useCallback(() => {
    setLoading(true);

    let url = "/api/reports?";

    if (preset === "today") {
      url += `date=${today}`;
    } else if (preset === "custom") {
      url += `from=${customFrom}&to=${customTo}`;
    } else {
      const { from, to } = getDateRange(preset);
      url += `from=${from}&to=${to}`;
    }

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setReport(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [preset, customFrom, customTo, today]);

  // Build trend data from MRs grouped by date
  useEffect(() => {
    if (!report?.mrs?.length) {
      setTrendData([]);
      return;
    }

    const byDate: Record<string, { scores: number[]; count: number }> = {};

    report.mrs.forEach((mr) => {
      if (!mr.reviewed_at || !mr.score) return;
      const date = mr.reviewed_at.split("T")[0].split(" ")[0];
      if (!byDate[date]) byDate[date] = { scores: [], count: 0 };
      byDate[date].scores.push(mr.score);
      byDate[date].count++;
    });

    const trend = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { scores, count }]) => ({
        date,
        avg_score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        mr_count:  count,
      }));

    setTrendData(trend);
  }, [report]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const presets: { id: PresetType; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week",  label: "Last 7 Days" },
    { id: "month", label: "Last 30 Days" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 900 }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", marginBottom: 6 }}>ANALYTICS</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 4 }}>Reports</h1>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Code review activity and team insights</p>
      </div>

      {/* Date range filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: `1px solid ${preset === p.id ? "var(--accent-border)" : "var(--border)"}`,
              background: preset === p.id ? "var(--accent-dim)" : "var(--bg-secondary)",
              color: preset === p.id ? "var(--accent)" : "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              transition: "all 0.15s",
            }}
          >
            {p.label}
          </button>
        ))}

        {/* Custom date range inputs */}
        {preset === "custom" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>
              <Calendar size={12} color="var(--text-muted)" />
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ background: "none", border: "none", color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-mono)", outline: "none", colorScheme: "dark" }}
              />
            </div>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>
              <Calendar size={12} color="var(--text-muted)" />
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={today}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ background: "none", border: "none", color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-mono)", outline: "none", colorScheme: "dark" }}
              />
            </div>
            <button
              onClick={fetchReport}
              style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--accent-border)", background: "var(--accent-dim)", color: "var(--accent)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)" }}
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0" }}>Loading...</div>
      ) : !report ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No data</div>
      ) : (report?.mrs?.length ?? 0) === 0 ? (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "48px 24px", textAlign: "center" }}>
          <BarChart2 size={32} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>No reviews in this period</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Try selecting a different date range</div>
        </div>
      ) : (
        <>
          {/* 1. Weekly Summary */}
          <WeeklySummary report={report} />

          {/* 2. Summary stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }} className="stagger">
            {[
              { label: "MRs Reviewed",     value: report.mrs.length,                   icon: BarChart2,  color: "#7c6cfc" },
              { label: "Developers Active", value: report.developer_stats?.length ?? 0, icon: User,       color: "#00d084" },
              {
                label: "Avg Score",
                value: report.mrs.length > 0
                  ? `${Math.round(report.mrs.reduce((a, m) => a + (m.score ?? 0), 0) / report.mrs.length)}/100`
                  : "—",
                icon: TrendingUp, color: "#f5a623",
              },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="animate-fade-up" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em" }}>{label.toUpperCase()}</span>
                  <Icon size={13} color={color} opacity={0.8} />
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* 3. Score trend chart */}
          {trendData.length > 1 && <ScoreTrendChart data={trendData} />}

          {/* 4. Issue breakdown */}
          <CommonIssues mrs={report.mrs} />

          {/* Developer breakdown */}
          {(report.developer_stats?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 10 }}>DEVELOPER BREAKDOWN</div>
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 80px 70px 80px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}>
                  <span>DEVELOPER</span><span>MRs</span><span>AVG SCORE</span><span>ISSUES</span><span>CRITICAL</span>
                </div>
                {report.developer_stats.map((dev, i) => (
                  <div key={dev.author} style={{ display: "grid", gridTemplateColumns: "1fr 70px 80px 70px 80px", padding: "12px 16px", borderBottom: i < report.developer_stats.length - 1 ? "1px solid var(--border)" : "none", fontSize: 12, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>
                        {dev.author[0].toUpperCase()}
                      </div>
                      <span style={{ color: "var(--text-primary)" }}>@{dev.author}</span>
                    </div>
                    <span style={{ color: "var(--text-secondary)" }}>{dev.mr_count}</span>
                    <span style={{ color: scoreColor(dev.avg_score), fontWeight: 600 }}>{dev.avg_score}</span>
                    <span style={{ color: "var(--text-secondary)" }}>{dev.total_issues}</span>
                    <span style={{ color: dev.critical_count > 0 ? "#ff3b30" : "var(--text-muted)", fontWeight: dev.critical_count > 0 ? 600 : 400 }}>{dev.critical_count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MR list */}
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 10 }}>
              MRs IN THIS PERIOD ({report.mrs.length})
            </div>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {report.mrs.map((mr, i) => (
                <Link key={mr.mr_iid} href={`/mr/${mr.mr_iid}`} style={{ textDecoration: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < report.mrs.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer" }}>
                    <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600, minWidth: 34 }}>!{mr.mr_iid}</span>
                    <span style={{ flex: 1, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mr.title}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>@{mr.author}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(mr.critical_count ?? 0) > 0 && <span style={{ fontSize: 9, color: "#ff3b30", background: "rgba(255,59,48,0.1)", padding: "1px 5px", borderRadius: 3 }}>{mr.critical_count}C</span>}
                      {(mr.high_count ?? 0) > 0 && <span style={{ fontSize: 9, color: "#ff8c00", background: "rgba(255,140,0,0.1)", padding: "1px 5px", borderRadius: 3 }}>{mr.high_count}H</span>}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(mr.score), minWidth: 36, textAlign: "right" }}>{mr.score ?? "—"}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}