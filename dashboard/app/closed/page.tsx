"use client";

import { useEffect, useState } from "react";
import MRCard from "@/components/MRCard";
import { CheckCircle, ChevronLeft, ChevronRight, GitMerge, XCircle } from "lucide-react";
import type { MR } from "@/lib/db";

const PAGE_SIZE = 20;
type FilterType = "all" | "merged" | "closed";

export default function ClosedPage() {
  const [allMrs, setAllMrs]     = useState<MR[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<FilterType>("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/mrs/closed?page=${page}&limit=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((data) => {
        setAllMrs(data.mrs || []);
        setTotal(data.total || 0);
        setHasMore(data.hasMore || false);
        setLoading(false);
      });
  }, [page]);

  // Reset page when filter changes
  const handleFilter = (f: FilterType) => {
    setFilter(f);
    setPage(1);
  };

  const mergedCount = allMrs.filter((mr) => mr.status === "merged").length;
  const closedCount = allMrs.filter((mr) => mr.status === "closed").length;

  const filteredMrs = allMrs.filter((mr) => {
    if (filter === "merged") return mr.status === "merged";
    if (filter === "closed") return mr.status === "closed";
    return true;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ padding: "28px 32px", maxWidth: 900 }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", marginBottom: 6 }}>
          HISTORY
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 4 }}>
          Closed Merge Requests
        </h1>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {total} total · {mergedCount} merged · {closedCount} closed
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[
          {
            id:    "all",
            label: "All",
            count: allMrs.length,
            icon:  null,
            color: "var(--accent)",
            bg:    "var(--accent-dim)",
            border:"var(--accent-border)",
          },
          {
            id:    "merged",
            label: "Merged",
            count: mergedCount,
            icon:  <GitMerge size={11} />,
            color: "#00d084",
            bg:    "rgba(0,208,132,0.1)",
            border:"rgba(0,208,132,0.3)",
          },
          {
            id:    "closed",
            label: "Closed",
            count: closedCount,
            icon:  <XCircle size={11} />,
            color: "#8888a8",
            bg:    "rgba(136,136,168,0.1)",
            border:"rgba(136,136,168,0.3)",
          },
        ].map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleFilter(tab.id as FilterType)}
              style={{
                display:     "flex",
                alignItems:  "center",
                gap:         6,
                padding:     "7px 14px",
                borderRadius: 8,
                border:      `1px solid ${active ? tab.border : "var(--border)"}`,
                background:  active ? tab.bg : "var(--bg-secondary)",
                color:       active ? tab.color : "var(--text-muted)",
                fontSize:    12,
                cursor:      "pointer",
                fontFamily:  "var(--font-mono)",
                transition:  "all 0.15s ease",
              }}
            >
              {tab.icon}
              {tab.label}
              <span style={{
                fontSize:   10,
                color:      active ? tab.color : "var(--text-muted)",
                background: active ? `${tab.color}20` : "var(--bg-tertiary)",
                border:     `1px solid ${active ? tab.border : "var(--border)"}`,
                padding:    "1px 6px",
                borderRadius: 4,
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0" }}>
          Loading...
        </div>
      ) : filteredMrs.length === 0 ? (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "48px 24px", textAlign: "center" }}>
          <CheckCircle size={32} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            No {filter === "all" ? "closed" : filter} MRs yet
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {filter === "merged"
              ? "Merged MRs will appear here automatically"
              : filter === "closed"
              ? "MRs closed without merging will appear here"
              : "Closed and merged MRs will appear here"}
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 10 }}>
            {filter === "all"    ? "ALL CLOSED MRs" :
             filter === "merged" ? "MERGED MRs" :
             "CLOSED WITHOUT MERGE"} — {filteredMrs.length} shown
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} className="stagger">
            {filteredMrs.map((mr) => (
              <div key={mr.id} style={{ position: "relative" }}>
                {/* Status badge on card */}
                <div style={{
                  position:   "absolute",
                  top:        10,
                  right:      50,
                  zIndex:     1,
                  fontSize:   9,
                  fontWeight: 600,
                  color:      mr.status === "merged" ? "#00d084" : "#8888a8",
                  background: mr.status === "merged" ? "rgba(0,208,132,0.12)" : "rgba(136,136,168,0.12)",
                  border:     `1px solid ${mr.status === "merged" ? "rgba(0,208,132,0.3)" : "rgba(136,136,168,0.3)"}`,
                  padding:    "2px 7px",
                  borderRadius: 4,
                  pointerEvents: "none",
                }}>
                  {mr.status.toUpperCase()}
                </div>
                <MRCard mr={mr} />
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, padding: "12px 16px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10 }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: page === 1 ? "var(--text-muted)" : "var(--accent)", background: "none", border: "none", cursor: page === 1 ? "not-allowed" : "pointer", fontFamily: "var(--font-mono)" }}
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    style={{
                      width:      28,
                      height:     28,
                      borderRadius: 6,
                      border:     `1px solid ${p === page ? "var(--accent-border)" : "var(--border)"}`,
                      background: p === page ? "var(--accent-dim)" : "transparent",
                      color:      p === page ? "var(--accent)" : "var(--text-muted)",
                      fontSize:   12,
                      cursor:     "pointer",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: !hasMore ? "var(--text-muted)" : "var(--accent)", background: "none", border: "none", cursor: !hasMore ? "not-allowed" : "pointer", fontFamily: "var(--font-mono)" }}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}