"use client";

import { useEffect, useState, useCallback } from "react";
import { GitMerge, RefreshCw } from "lucide-react";
import StatsBar from "@/components/StatsBar";
import MRCard from "@/components/MRCard";
import type { MR } from "@/lib/db";

const REFRESH_INTERVAL = 60000; // 60 seconds

export default function HomePage() {
  const [mrs, setMrs]           = useState<MR[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown]    = useState(60);
  // MRs the AI is actually working on — a missing score alone does not
  // mean a review is running (it may simply never have been reviewed).
  const [reviewing, setReviewing]    = useState<number[]>([]);

  const fetchMRs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const [res, revRes] = await Promise.all([
        fetch("/api/mrs"),
        fetch("/api/reviewing"),
      ]);
      const data   = await res.json();
      const revData = await revRes.json().catch(() => ({ reviewing: [] }));
      setMrs(Array.isArray(data) ? data : []);
      setReviewing(Array.isArray(revData.reviewing) ? revData.reviewing : []);
      setLastUpdated(new Date());
      setCountdown(60);
    } catch (e) {
      console.error("Failed to fetch MRs", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchMRs();
  }, [fetchMRs]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchMRs(true), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchMRs]);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 60 : c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  const pendingMRs   = mrs.filter((mr) => mr.score === null);
  const reviewedMRs  = mrs.filter((mr) => mr.score !== null);

  return (
    <div style={{ padding: "28px 32px", maxWidth: 900 }}>

      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", marginBottom: 6 }}>
            DASHBOARD
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Active Merge Requests
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {mrs.length} open MR{mrs.length !== 1 ? "s" : ""}
            {pendingMRs.length > 0 && (
              <span style={{ color: "#f5a623", marginLeft: 8 }}>
                · {pendingMRs.length} pending review
              </span>
            )}
          </p>
        </div>

        {/* Refresh button + countdown */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastUpdated && (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              refreshes in {countdown}s
            </span>
          )}
          <button
            onClick={() => fetchMRs(true)}
            disabled={refreshing}
            style={{
              display:    "flex",
              alignItems: "center",
              gap:        6,
              fontSize:   11,
              color:      refreshing ? "var(--text-muted)" : "var(--accent)",
              background: "var(--bg-secondary)",
              border:     "1px solid var(--border)",
              borderRadius: 6,
              padding:    "6px 12px",
              cursor:     refreshing ? "not-allowed" : "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            <RefreshCw
              size={11}
              style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsBar />

      {/* Pending review banner */}
      {pendingMRs.length > 0 && (
        <div style={{
          marginBottom: 16,
          padding:      "10px 14px",
          background:   "rgba(245,166,35,0.08)",
          border:       "1px solid rgba(245,166,35,0.25)",
          borderRadius: 8,
          display:      "flex",
          alignItems:   "center",
          gap:          8,
          fontSize:     12,
          color:        "#f5a623",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f5a623", animation: "pulse 1.5s ease-in-out infinite", flexShrink: 0 }} />
          {pendingMRs.length === 1
            ? `1 MR is queued for AI review — check back shortly`
            : `${pendingMRs.length} MRs are queued for AI review — check back shortly`
          }
        </div>
      )}

      {/* MR List */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em" }}>
            OPEN MRs
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {mrs.length} total
          </span>
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{
                background:   "var(--bg-secondary)",
                border:       "1px solid var(--border)",
                borderRadius: 10,
                padding:      "14px 16px",
                height:       68,
                animation:    "pulse 1.5s ease-in-out infinite",
              }} />
            ))}
          </div>
        ) : mrs.length === 0 ? (
          <div style={{
            background:   "var(--bg-secondary)",
            border:       "1px solid var(--border)",
            borderRadius: 10,
            padding:      "48px 24px",
            textAlign:    "center",
          }}>
            <GitMerge size={32} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              No open MRs right now
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              New MRs appear automatically · refreshes every 60s
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} className="stagger">
            {mrs.map((mr) => (
              <div key={mr.id} style={{ position: "relative" }}>
                {/* Reviewing indicator — only while a review is truly running */}
                {reviewing.includes(mr.mr_iid) && (
                  <div style={{
                    position:   "absolute",
                    top:        "50%",
                    right:      50,
                    transform:  "translateY(-50%)",
                    zIndex:     1,
                    display:    "flex",
                    alignItems: "center",
                    gap:        5,
                    fontSize:   10,
                    color:      "#f5a623",
                    background: "rgba(245,166,35,0.1)",
                    border:     "1px solid rgba(245,166,35,0.25)",
                    padding:    "2px 8px",
                    borderRadius: 4,
                    pointerEvents: "none",
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#f5a623", animation: "pulse 1.5s ease-in-out infinite" }} />
                    reviewing...
                  </div>
                )}
                <MRCard mr={mr} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}