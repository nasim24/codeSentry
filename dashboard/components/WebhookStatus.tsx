"use client";

import { useEffect, useState } from "react";
import { Circle, WifiOff, AlertTriangle, KeyRound } from "lucide-react";

type Status =
  | "checking"
  | "connected"
  | "no_gitlab"
  | "bad_token"
  | "gitlab_error"
  | "offline";

interface StatusData {
  status:    Status;
  message:   string;
  flask:     boolean;
  gitlab:    boolean;
  tokenUrl?: string;
}

export default function WebhookStatus() {
  const [data, setData]     = useState<StatusData | null>(null);
  const [status, setStatus] = useState<Status>("checking");

  const check = () => {
    setStatus("checking");
    fetch("/api/status")
      .then((r) => r.json())
      .then((d: StatusData) => {
        setData(d);
        setStatus(d.status);
      })
      .catch(() => setStatus("offline"));
  };

  useEffect(() => {
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const config = {
    checking: {
      color: "#f5a623",
      label: "checking...",
      icon:  <Circle size={6} fill="#f5a623" color="#f5a623" />,
      bg:    "transparent",
    },
    connected: {
      color: "#00d084",
      label: "webhook active",
      icon:  <Circle size={6} fill="#00d084" color="#00d084"
               style={{ animation: "pulse 2.5s ease-in-out infinite" }} />,
      bg:    "transparent",
    },
    no_gitlab: {
      color: "#f5a623",
      label: "GitLab unreachable",
      icon:  <AlertTriangle size={11} color="#f5a623" />,
      bg:    "rgba(245,166,35,0.06)",
    },
    bad_token: {
      color: "#ff9500",
      label: "GitLab token expired",
      icon:  <KeyRound size={11} color="#ff9500" />,
      bg:    "rgba(255,149,0,0.08)",
    },
    gitlab_error: {
      color: "#f5a623",
      label: "GitLab error",
      icon:  <AlertTriangle size={11} color="#f5a623" />,
      bg:    "rgba(245,166,35,0.06)",
    },
    offline: {
      color: "#ff3b30",
      label: "server offline",
      icon:  <WifiOff size={11} color="#ff3b30" />,
      bg:    "rgba(255,59,48,0.06)",
    },
  }[status] ?? {
    color: "#f5a623",
    label: "unknown status",
    icon:  <AlertTriangle size={11} color="#f5a623" />,
    bg:    "rgba(245,166,35,0.06)",
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div
        onClick={check}
        title={data?.message || "Click to check status"}
        style={{
          padding:    "8px 16px",
          display:    "flex",
          alignItems: "center",
          gap:        6,
          fontSize:   11,
          color:      config.color,
          cursor:     "pointer",
          background: config.bg,
          transition: "all 0.15s",
        }}
      >
        {config.icon}
        {config.label}
      </div>

      {/* GitLab genuinely not reachable — network/VPN */}
      {status === "no_gitlab" && (
        <div style={{
          padding:    "6px 16px 8px",
          fontSize:   10,
          color:      "var(--text-muted)",
          lineHeight: 1.5,
          background: "rgba(245,166,35,0.06)",
        }}>
          Connect to office VPN to enable live syncing
        </div>
      )}

      {/* GitLab reachable but rejected the token — not a VPN issue */}
      {status === "bad_token" && (
        <div style={{
          padding:    "6px 16px 8px",
          fontSize:   10,
          color:      "var(--text-muted)",
          lineHeight: 1.5,
          background: "rgba(255,149,0,0.08)",
        }}>
          GitLab is reachable — it rejected GITLAB_TOKEN (401).
          Generate a new token with the <code>api</code> scope, then update
          <code> GITLAB_TOKEN</code> in .env and restart.
          {data?.tokenUrl && (
            <>
              {" "}
              <a
                href={data.tokenUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#ff9500", textDecoration: "underline" }}
              >
                Open token settings
              </a>
            </>
          )}
        </div>
      )}

      {/* Unexpected GitLab response */}
      {status === "gitlab_error" && (
        <div style={{
          padding:    "6px 16px 8px",
          fontSize:   10,
          color:      "var(--text-muted)",
          lineHeight: 1.5,
          background: "rgba(245,166,35,0.06)",
        }}>
          {data?.message || "GitLab returned an unexpected response"}
        </div>
      )}
    </div>
  );
}
