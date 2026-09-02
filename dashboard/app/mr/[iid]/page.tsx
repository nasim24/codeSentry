"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ExternalLink, GitBranch, User,
  Send, CheckCircle, ChevronDown, ChevronUp,
  RefreshCw, History, GitCommit, RotateCcw, X, FileText,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface Issue {
  file: string;
  line: number;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  rule_id?: string;
  message: string;
  suggestion: string | null;
}

interface EditableIssue extends Issue {
  _index:    number;
  _included: boolean;
}

interface Review {
  id: number;
  mr_iid: number;
  score: number;
  summary: string;
  issues_json: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  commit_sha: string;
  reviewed_at: string;
}

interface MR {
  mr_iid: number;
  title: string;
  author: string;
  source_branch: string;
  target_branch: string;
  status: string;
  mr_url: string;
  score: number | null;
  summary: string | null;
  critical_count: number | null;
  high_count: number | null;
  medium_count: number | null;
  low_count: number | null;
  reviewed_at: string | null;
}

// ── Toast Component ────────────────────────────────────────────

interface ToastProps {
  message: string;
  type: "success" | "error" | "info";
  onClose: () => void;
}

function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colors = {
    success: { bg: "rgba(0,208,132,0.12)",  border: "rgba(0,208,132,0.3)",  color: "#00d084" },
    error:   { bg: "rgba(255,59,48,0.12)",   border: "rgba(255,59,48,0.3)",   color: "#ff3b30" },
    info:    { bg: "rgba(124,108,252,0.12)", border: "rgba(124,108,252,0.3)", color: "#a07cf0" },
  }[type];

  return (
    <div style={{
      position:   "fixed",
      bottom:     24,
      right:      24,
      zIndex:     1000,
      display:    "flex",
      alignItems: "center",
      gap:        10,
      padding:    "12px 16px",
      background: colors.bg,
      border:     `1px solid ${colors.border}`,
      borderRadius: 10,
      fontSize:   13,
      color:      colors.color,
      boxShadow:  "0 4px 20px rgba(0,0,0,0.3)",
      animation:  "fadeUp 0.2s ease",
      maxWidth:   400,
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={onClose}
        style={{ background: "none", border: "none", cursor: "pointer", color: colors.color, padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: "#ff3b30", high: "#ff8c00", medium: "#f5a623", low: "#8888a8",
};
const SEV_BG: Record<string, string> = {
  critical: "rgba(255,59,48,0.1)", high: "rgba(255,140,0,0.1)",
  medium: "rgba(245,166,35,0.1)", low: "rgba(136,136,168,0.08)",
};
const SEV_EMOJI: Record<string, string> = {
  critical: "🔴", high: "🟠", medium: "🟡", low: "🔵",
};
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

function scoreColor(s: number | null) {
  if (!s) return "var(--text-muted)";
  if (s >= 90) return "#00d084";
  if (s >= 70) return "#f5a623";
  if (s >= 50) return "#ff8c00";
  return "#ff3b30";
}

function timeAgo(dateStr: string) {
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function shortSha(sha: string) {
  return sha ? sha.slice(0, 8) : "unknown";
}

function buildComment(mr: MR, issues: EditableIssue[], customMessage: string): string {
  const score    = mr.score ?? 0;
  const included = issues.filter((i) => i._included);
  const critical = included.filter((i) => i.severity === "critical").length;
  const high     = included.filter((i) => i.severity === "high").length;
  const medium   = included.filter((i) => i.severity === "medium").length;
  const low      = included.filter((i) => i.severity === "low").length;

  let c = `## Code Review — Score: ${score}/100\n\n`;

  if (customMessage.trim()) {
    c += `> **Reviewer note:** ${customMessage.trim()}\n\n`;
  }

  c += `${mr.summary}\n\n`;
  c += `| Severity | Count |\n|----------|-------|\n`;
  c += `| Critical | ${critical} |\n| High | ${high} |\n| Medium | ${medium} |\n| Low | ${low} |\n`;

  if (included.length > 0) {
    c += `\n### Issues\n\n`;
    for (const issue of included) {
      c += `**[${issue.severity.toUpperCase()}]** \`${issue.file}\` — line ${issue.line ?? "?"}\n\n`;
      c += `${issue.message}\n\n`;
      if (issue.suggestion?.trim()) {
        c += `**Suggested fix:**\n\`\`\`typescript\n${issue.suggestion.trim()}\n\`\`\`\n\n`;
      }
      c += `---\n\n`;
    }
  }

  return c.trim();
}

// ── Main Page ──────────────────────────────────────────────────

// How long to trust an optimistic "queued" state before the Flask
// /reviewing flag has to take over. Keeps the spinner honest.
const PENDING_BRIDGE_MS = 45000;

export default function MRDetailPage() {
  const params = useParams();
  const iid    = params?.iid as string;

  const [mr, setMr]               = useState<MR | null>(null);
  const [issues, setIssues]       = useState<EditableIssue[]>([]);
  const [history, setHistory]     = useState<Review[]>([]);
  const [activeTab, setActiveTab] = useState<"review" | "history">("review");
  const [loading, setLoading]     = useState(true);
  const [posting, setPosting]     = useState(false);
  const [posted, setPosted]       = useState(false);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<number[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<number[]>([]);
  const [rereviewing, setRereviewing]   = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [toast, setToast]               = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [countdown, setCountdown]       = useState(30);
  // Real "AI is working" signal from the Flask server, not inferred from
  // a missing score — a merged MR that was never reviewed also has no score.
  const [reviewing, setReviewing]       = useState(false);
  const [pendingSince, setPendingSince] = useState<number | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
  };

  const loadData = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setPosted(false);

    Promise.all([
      fetch(`/api/mrs/${iid}`).then((r) => r.json()),
      fetch(`/api/mrs/${iid}/history`).then((r) => r.json()),
    ]).then(([mrData, histData]) => {
      setMr(mrData.mr);
      const editable: EditableIssue[] = (mrData.issues || []).map(
        (issue: Issue, i: number) => ({ ...issue, _index: i, _included: true })
      );
      setIssues(editable);
      setHistory(Array.isArray(histData) ? histData : []);
      setReviewing(!!mrData.reviewing);
      setPendingSince((prev) => {
        // Flask confirmed a run — no need for the optimistic bridge.
        if (mrData.reviewing) return null;
        // Bridge expired (or the job died) — stop waiting so we never spin forever.
        if (prev !== null && Date.now() - prev > PENDING_BRIDGE_MS) return null;
        return prev;
      });
      setLoading(false);
      setCountdown(30);
    });
  }, [iid]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => loadData(true), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => c <= 1 ? 30 : c - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleExpand = (i: number) =>
    setExpanded((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i]);

  const toggleHistoryExpand = (i: number) =>
    setExpandedHistory((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i]);

  const changeSeverity = (idx: number, val: string) =>
    setIssues((p) => p.map((i) => i._index === idx ? { ...i, severity: val as Issue["severity"] } : i));

  const toggleInclude = (idx: number) =>
    setIssues((p) => p.map((i) => i._index === idx ? { ...i, _included: !i._included } : i));

  const postComment = async () => {
    if (!mr) return;
    setPosting(true);
    setError("");
    const comment = buildComment(mr, issues, customMessage);
    const res     = await fetch("/api/comment", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mr_iid: mr.mr_iid, comment }),
    });
    const data = await res.json();
    setPosting(false);
    if (data.success) {
      setPosted(true);
      setCustomMessage("");
      showToast("Comment posted to GitLab successfully!", "success");
    } else {
      setError(data.error || "Failed to post");
    }
  };

  const triggerRereview = async () => {
    setRereviewing(true);
    try {
      const res  = await fetch(`/api/mrs/${iid}/rereview`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("Re-review queued — this takes 2-3 minutes", "info");
        setPendingSince(Date.now());
        // Poll back soon so the real /reviewing flag replaces the bridge.
        setTimeout(() => loadData(true), 2000);
      } else {
        showToast("Failed to queue re-review", "error");
      }
    } catch {
      showToast("Could not reach webhook server", "error");
    }
    setRereviewing(false);
  };

  const syncHistory = async () => {
    setSyncing(true);
    try {
      const res  = await fetch(`/api/mrs/${iid}/backfill`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("Syncing commits in background — this takes a few minutes", "info");
        setPendingSince(Date.now());
        setTimeout(() => loadData(true), 2000);
      } else {
        showToast(data.error || "Failed to start sync", "error");
      }
    } catch {
      showToast("Could not reach webhook server", "error");
    }
    setSyncing(false);
  };

  // A review is "in progress" only if Flask says so, or we just queued one.
  const bridging      = pendingSince !== null &&
                        Date.now() - pendingSince < PENDING_BRIDGE_MS;
  const showReviewing = reviewing || bridging;

  if (loading) return (
    <div style={{ padding: "28px 32px" }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ height: 60, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
    </div>
  );

  if (!mr) return (
    <div style={{ padding: "28px 32px" }}>
      <Link href="/" style={{ color: "var(--accent)", fontSize: 12 }}>← Back</Link>
    </div>
  );

  const includedCount = issues.filter((i) => i._included).length;
  const excludedCount = issues.filter((i) => !i._included).length;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 860 }}>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Back + Action buttons */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>
          <ArrowLeft size={13} /> Back to Active MRs
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Countdown */}
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            auto-refresh in {countdown}s
          </span>

          {/* Re-review */}
          <button onClick={triggerRereview} disabled={rereviewing}
            title="Force a fresh AI review"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: rereviewing ? "var(--text-muted)" : "#f5a623", background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.25)", borderRadius: 6, padding: "5px 10px", cursor: rereviewing ? "not-allowed" : "pointer", fontFamily: "var(--font-mono)" }}>
            <RotateCcw size={11} style={{ animation: rereviewing ? "spin 1s linear infinite" : "none" }} />
            {rereviewing ? "Queuing..." : "Re-review"}
          </button>

          {/* Sync History */}
          <button onClick={syncHistory} disabled={syncing}
            title="Pull and review all missing commits"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: syncing ? "var(--text-muted)" : "#00d084", background: "rgba(0,208,132,0.08)", border: "1px solid rgba(0,208,132,0.25)", borderRadius: 6, padding: "5px 10px", cursor: syncing ? "not-allowed" : "pointer", fontFamily: "var(--font-mono)" }}>
            <GitCommit size={11} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
            {syncing ? "Syncing..." : "Sync History"}
          </button>

          {/* Refresh */}
          <button onClick={() => loadData(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontFamily: "var(--font-mono)" }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {/* Reviewing banner — only when a review is genuinely running */}
      {showReviewing && (
        <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.25)", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#f5a623" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f5a623", animation: "pulse 1.5s ease-in-out infinite", flexShrink: 0 }} />
          AI review in progress — auto-refreshes every 30 seconds
        </div>
      )}

      {/* MR Header */}
      <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>!{mr.mr_iid}</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--bg-tertiary)", padding: "2px 7px", borderRadius: 4, border: "1px solid var(--border)" }}>{mr.status}</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--bg-tertiary)", padding: "2px 7px", borderRadius: 4, border: "1px solid var(--border)" }}>
                {history.length} review{history.length !== 1 ? "s" : ""}
              </span>
            </div>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>{mr.title}</h1>
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--text-muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><User size={11} /> @{mr.author}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><GitBranch size={11} /> {mr.source_branch} → {mr.target_branch}</span>
              {mr.mr_url && (
                <a href={mr.mr_url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--accent)", textDecoration: "none" }}>
                  <ExternalLink size={11} /> View on GitLab
                </a>
              )}
            </div>
          </div>

          {/* Score circle */}
          <div style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid ${scoreColor(mr.score)}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: `${scoreColor(mr.score)}15`, flexShrink: 0 }}>
            {showReviewing ? (
              <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid #f5a623", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
            ) : mr.score === null ? (
              <>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-muted)" }}>—</span>
                <span style={{ fontSize: 8, color: "var(--text-muted)" }}>no review</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor(mr.score) }}>{mr.score}</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>/100</span>
              </>
            )}
          </div>
        </div>

        {mr.summary && (
          <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--bg-tertiary)", borderRadius: 8, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, borderLeft: "3px solid var(--accent-border)" }}>
            {mr.summary}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: 4 }}>
        {[
          { id: "review",  label: "Latest Review",           icon: <CheckCircle size={13} /> },
          { id: "history", label: `History (${history.length})`, icon: <History size={13} /> },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as "review" | "history")}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 14px", borderRadius: 6, border: "none", background: activeTab === tab.id ? "var(--accent-dim)" : "transparent", color: activeTab === tab.id ? "var(--accent)" : "var(--text-muted)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)", transition: "all 0.15s" }}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Latest Review ── */}
      {activeTab === "review" && (
        <>
          {/* Post comment section */}
          {mr.score !== null && (
            <div style={{ marginBottom: 16 }}>
              {posted ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "rgba(0,208,132,0.1)", border: "1px solid rgba(0,208,132,0.3)", borderRadius: 8, fontSize: 13, color: "#00d084" }}>
                  <CheckCircle size={15} /> Comment posted to GitLab!
                </div>
              ) : (
                <div>
                  {/* Custom message */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 6 }}>YOUR MESSAGE (optional)</div>
                    <textarea
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="Add your personal note to the developer... e.g. 'Please fix the critical issues before requesting re-review'"
                      style={{ width: "100%", minHeight: 80, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-mono)", outline: "none", resize: "vertical", lineHeight: 1.6 }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--accent-border)")}
                      onBlur={(e)  => (e.target.style.borderColor = "var(--border)")}
                    />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button onClick={postComment} disabled={posting || includedCount === 0}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", background: posting || includedCount === 0 ? "var(--bg-tertiary)" : "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: 8, color: posting || includedCount === 0 ? "var(--text-muted)" : "var(--accent)", fontSize: 13, cursor: posting || includedCount === 0 ? "not-allowed" : "pointer", fontFamily: "var(--font-mono)" }}>
                      <Send size={14} />
                      {posting ? "Posting..." : `Post Review to GitLab (${includedCount} issue${includedCount !== 1 ? "s" : ""})`}
                    </button>
                    {excludedCount > 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{excludedCount} excluded</span>}
                  </div>
                </div>
              )}
              {error && <div style={{ marginTop: 8, fontSize: 12, color: "#ff3b30", padding: "8px 12px", background: "rgba(255,59,48,0.08)", borderRadius: 6 }}>❌ {error}</div>}
            </div>
          )}

          {/* Issues */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em" }}>ISSUES FOUND ({issues.length})</span>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setIssues((p) => p.map((i) => ({ ...i, _included: true })))} style={{ fontSize: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)" }}>Include all</button>
                <span style={{ color: "var(--text-muted)", fontSize: 10 }}>·</span>
                <button onClick={() => setIssues((p) => p.map((i) => ({ ...i, _included: false })))} style={{ fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)" }}>Exclude all</button>
              </div>
            </div>

            {showReviewing ? (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "32px", textAlign: "center" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid #f5a623", borderTopColor: "transparent", animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>AI is reviewing this MR...</div>
              </div>
            ) : mr.score === null ? (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "32px", textAlign: "center" }}>
                <FileText size={22} color="var(--text-muted)" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 6 }}>
                  Not reviewed yet
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto 14px" }}>
                  {mr.status === "opened"
                    ? "No AI review has been saved for this MR yet. It will be picked up automatically on the next commit or poll — or review it now."
                    : `This MR was ${mr.status} before it was reviewed. Automatic polling only covers open MRs, so it will not be reviewed unless you ask for it.`}
                </div>
                <button onClick={triggerRereview} disabled={rereviewing}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: rereviewing ? "var(--text-muted)" : "#f5a623", background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.25)", borderRadius: 6, padding: "7px 14px", cursor: rereviewing ? "not-allowed" : "pointer", fontFamily: "var(--font-mono)" }}>
                  <RotateCcw size={11} style={{ animation: rereviewing ? "spin 1s linear infinite" : "none" }} />
                  {rereviewing ? "Queuing..." : "Review this MR now"}
                </button>
              </div>
            ) : issues.length === 0 ? (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "32px", textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
                No issues found — code looks good! 🟢
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {issues.map((issue) => (
                  <div key={issue._index} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", opacity: issue._included ? 1 : 0.4, transition: "opacity 0.15s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px" }}>
                      <input type="checkbox" checked={issue._included} onChange={() => toggleInclude(issue._index)} style={{ cursor: "pointer", flexShrink: 0, accentColor: "var(--accent)", width: 14, height: 14 }} />
                      <select value={issue.severity} onChange={(e) => changeSeverity(issue._index, e.target.value)} onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 10, fontWeight: 700, color: SEV_COLOR[issue.severity], background: SEV_BG[issue.severity], border: `1px solid ${SEV_COLOR[issue.severity]}50`, borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontFamily: "var(--font-mono)", flexShrink: 0, outline: "none" }}>
                        {SEVERITIES.map((sev) => (
                          <option key={sev} value={sev} style={{ background: "#1a1a2e", color: SEV_COLOR[sev] }}>{sev.toUpperCase()}</option>
                        ))}
                      </select>
                      <span style={{ fontSize: 11, color: "var(--accent)", fontFamily: "monospace", flexShrink: 0 }} title={issue.file}>
                        {issue.file.split("/").slice(-2).join("/")}:{issue.line ?? "?"}
                      </span>
                      <span onClick={() => toggleExpand(issue._index)} style={{ flex: 1, fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{issue.message}</span>
                      {issue.rule_id && <span style={{ fontSize: 9, color: "var(--text-muted)", background: "var(--bg-tertiary)", padding: "2px 6px", borderRadius: 3, border: "1px solid var(--border)", flexShrink: 0 }}>{issue.rule_id}</span>}
                      <div onClick={() => toggleExpand(issue._index)} style={{ cursor: "pointer", flexShrink: 0 }}>
                        {expanded.includes(issue._index) ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                      </div>
                    </div>
                    {expanded.includes(issue._index) && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "14px", background: "var(--bg-tertiary)" }}>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8, fontFamily: "monospace" }}>{issue.file}:{issue.line ?? "?"}</div>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: issue.suggestion ? 12 : 0, lineHeight: 1.6 }}>{issue.message}</p>
                        {issue.suggestion && (
                          <div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>SUGGESTION</div>
                            <pre style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", fontSize: 11, color: "#a8d8a8", overflowX: "auto", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)" }}>{issue.suggestion}</pre>
                          </div>
                        )}
                        <button onClick={() => toggleInclude(issue._index)} style={{ marginTop: 12, fontSize: 11, color: issue._included ? "#ff3b30" : "#00d084", background: issue._included ? "rgba(255,59,48,0.08)" : "rgba(0,208,132,0.08)", border: `1px solid ${issue._included ? "rgba(255,59,48,0.2)" : "rgba(0,208,132,0.2)"}`, borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                          {issue._included ? "Exclude from comment" : "Include in comment"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TAB: History ── */}
      {activeTab === "history" && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 12 }}>
            REVIEW HISTORY — {history.length} review{history.length !== 1 ? "s" : ""} (latest first)
          </div>

          {history.length === 0 ? (
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "32px", textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
              No review history yet — click "Sync History" to pull all commits
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map((rev, i) => {
                const revIssues: Issue[] = (() => { try { return JSON.parse(rev.issues_json || "[]"); } catch { return []; } })();
                const isLatest   = i === 0;
                const isExpanded = expandedHistory.includes(rev.id);

                return (
                  <div key={rev.id} style={{ background: "var(--bg-secondary)", border: `1px solid ${isLatest ? "var(--accent-border)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
                    <div onClick={() => toggleHistoryExpand(rev.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer" }}>
                      {isLatest && <span style={{ fontSize: 9, color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", padding: "2px 7px", borderRadius: 4, flexShrink: 0 }}>LATEST</span>}
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                        <GitCommit size={12} color="var(--text-muted)" />
                        <code style={{ fontSize: 11, color: "var(--text-secondary)", background: "var(--bg-tertiary)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>{shortSha(rev.commit_sha)}</code>
                      </div>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${scoreColor(rev.score)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: scoreColor(rev.score), background: `${scoreColor(rev.score)}15`, flexShrink: 0 }}>{rev.score}</div>
                      <span style={{ flex: 1, fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rev.summary}</span>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {rev.critical_count > 0 && <span style={{ fontSize: 10, color: "#ff3b30", background: "rgba(255,59,48,0.1)", padding: "1px 5px", borderRadius: 3 }}>{rev.critical_count}C</span>}
                        {rev.high_count > 0 && <span style={{ fontSize: 10, color: "#ff8c00", background: "rgba(255,140,0,0.1)", padding: "1px 5px", borderRadius: 3 }}>{rev.high_count}H</span>}
                        {rev.medium_count > 0 && <span style={{ fontSize: 10, color: "#f5a623", background: "rgba(245,166,35,0.1)", padding: "1px 5px", borderRadius: 3 }}>{rev.medium_count}M</span>}
                      </div>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>{timeAgo(rev.reviewed_at)}</span>
                      {isExpanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                    </div>

                    {isExpanded && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px", background: "var(--bg-tertiary)" }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
                          {new Date(rev.reviewed_at).toLocaleString()} · commit <code style={{ color: "var(--text-secondary)" }}>{shortSha(rev.commit_sha)}</code>
                        </div>
                        {revIssues.length === 0 ? (
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No issues in this review.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {revIssues.map((issue, j) => (
                              <div key={j} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: SEV_COLOR[issue.severity], background: SEV_BG[issue.severity], padding: "2px 7px", borderRadius: 4 }}>{issue.severity.toUpperCase()}</span>
                                  <code style={{ fontSize: 11, color: "var(--accent)" }}>{issue.file.split("/").slice(-2).join("/")}:{issue.line ?? "?"}</code>
                                </div>
                                <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{issue.message}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}