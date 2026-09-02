"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Save, CheckCircle, AlertTriangle, XCircle, Loader2,
  Eye, EyeOff, RotateCcw, Plug,
} from "lucide-react";

type SettingSource = "ui" | "env" | "default" | "unset";
type Group = "gitlab" | "ai" | "webhook" | "notify" | "digest";

interface SettingState {
  key:      string;
  label:    string;
  group:    Group;
  secret:   boolean;
  hintText: string;
  source:   SettingSource;
  isSet:    boolean;
  value:    string;
  masked:   string;
}

interface TestResult {
  ok:      boolean;
  level:   "ok" | "warn" | "error";
  message: string;
}

interface TestResults {
  gitlab?: TestResult;
  ollama?: TestResult;
  server?: TestResult;
}

const GROUP_ORDER: Group[] = ["gitlab", "ai", "webhook", "notify", "digest"];

const GROUP_META: Record<Group, { title: string; blurb: string }> = {
  gitlab: {
    title: "GitLab connection",
    blurb: "The token needs the 'api' scope and at least the Developer role on the project — scope alone is not enough on a private repo.",
  },
  ai: {
    title: "AI model",
    blurb: "Reviews run through Ollama on your own machine. No code leaves your network.",
  },
  webhook: {
    title: "Webhook & polling",
    blurb: "The secret is generated for you. Paste the same value into your GitLab project's webhook settings.",
  },
  notify: {
    title: "Notifications",
    blurb: "Optional. Leave empty to disable.",
  },
  digest: {
    title: "Email digest",
    blurb: "Optional. Sends a summary of yesterday's reviews each morning.",
  },
};

const SOURCE_LABEL: Record<SettingSource, string> = {
  ui:      "saved here",
  env:     "from .env",
  default: "default",
  unset:   "not set",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingState[]>([]);
  const [drafts, setDrafts]     = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [results, setResults]   = useState<TestResults>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [toast, setToast]       = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data.settings ?? []);
      setDrafts({});
    } catch {
      setToast({ msg: "Could not load settings", kind: "err" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const dirty = Object.keys(drafts).length > 0;

  const setDraft = (key: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const res  = await fetch("/api/settings", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ values: drafts }),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings ?? []);
        setDrafts({});
        setRevealed([]);
        setToast({
          msg: `Saved ${data.written?.length ?? 0} setting(s) — applied on the next poll, no restart needed`,
          kind: "ok",
        });
        runTests();
      } else {
        setToast({ msg: data.error || "Save failed", kind: "err" });
      }
    } catch {
      setToast({ msg: "Save failed", kind: "err" });
    }
    setSaving(false);
  };

  const resetToEnv = async (key: string) => {
    try {
      const res  = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings ?? []);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setToast({ msg: `${key} reset — falls back to .env or default`, kind: "ok" });
      }
    } catch {
      setToast({ msg: "Reset failed", kind: "err" });
    }
  };

  const runTests = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/test", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ target: "all" }),
      });
      setResults(await res.json());
    } catch {
      setToast({ msg: "Could not run connection tests", kind: "err" });
    }
    setTesting(false);
  };

  if (loading) {
    return (
      <div style={{ padding: "28px 32px" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ height: 80, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 10, animation: "pulse 1.5s ease-in-out infinite" }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 860 }}>

      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, marginBottom: 6 }}>Settings</h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 520 }}>
            Configure CodeSentryAI without editing files. Values saved here take
            precedence over <code>.env</code>, and apply on the next poll — no restart.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={runTests} disabled={testing}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 12px", cursor: testing ? "wait" : "pointer", fontFamily: "var(--font-mono)" }}>
            {testing ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Plug size={12} />}
            {testing ? "Testing..." : "Test connections"}
          </button>
          <button onClick={save} disabled={!dirty || saving}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: dirty ? "var(--accent)" : "var(--text-muted)", background: dirty ? "var(--accent-dim)" : "var(--bg-secondary)", border: `1px solid ${dirty ? "var(--accent-border)" : "var(--border)"}`, borderRadius: 6, padding: "7px 14px", cursor: dirty && !saving ? "pointer" : "not-allowed", fontFamily: "var(--font-mono)" }}>
            <Save size={12} />
            {saving ? "Saving..." : dirty ? `Save (${Object.keys(drafts).length})` : "Saved"}
          </button>
        </div>
      </div>

      {/* Security notice — the dashboard has no auth */}
      <div style={{ marginBottom: 20, padding: "10px 14px", background: "rgba(245,166,35,0.07)", border: "1px solid rgba(245,166,35,0.22)", borderRadius: 8, fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6, display: "flex", gap: 8 }}>
        <AlertTriangle size={13} color="#f5a623" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          This dashboard has <strong>no login</strong>. It holds your GitLab token and
          email password, so keep it bound to <code>localhost</code> and never expose
          port 3000 to a network or the internet.
        </span>
      </div>

      {/* Connection test results */}
      {(results.gitlab || results.ollama || results.server) && (
        <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {([["GitLab", results.gitlab], ["Ollama", results.ollama], ["Webhook server", results.server]] as const)
            .filter(([, r]) => r)
            .map(([name, r]) => {
              const res   = r as TestResult;
              const color = res.level === "ok" ? "#00d084" : res.level === "warn" ? "#f5a623" : "#ff3b30";
              const Icon  = res.level === "ok" ? CheckCircle : res.level === "warn" ? AlertTriangle : XCircle;
              return (
                <div key={name} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 12px", background: "var(--bg-secondary)", border: `1px solid ${color}30`, borderRadius: 8, fontSize: 11, lineHeight: 1.6 }}>
                  <Icon size={13} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <span style={{ color, fontWeight: 600 }}>{name}</span>
                    <span style={{ color: "var(--text-muted)" }}> — {res.message}</span>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Groups */}
      {GROUP_ORDER.map((group) => {
        const items = settings.filter((s) => s.group === group);
        if (items.length === 0) return null;
        const meta = GROUP_META[group];

        return (
          <div key={group} style={{ marginBottom: 22 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 4 }}>
                {meta.title.toUpperCase()}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 620 }}>
                {meta.blurb}
              </div>
            </div>

            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {items.map((s, idx) => {
                const draft    = drafts[s.key];
                const isDirty  = draft !== undefined;
                const show     = revealed.includes(s.key);
                const inputVal = isDirty ? draft : s.secret ? "" : s.value;

                return (
                  <div key={s.key} style={{ padding: "12px 14px", borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <label style={{ fontSize: 12, color: "var(--text-primary)" }}>{s.label}</label>
                      <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{s.key}</span>
                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: s.source === "ui" ? "var(--accent-dim)" : "var(--bg-tertiary)", color: s.source === "ui" ? "var(--accent)" : "var(--text-muted)" }}>
                        {SOURCE_LABEL[s.source]}
                      </span>
                      {isDirty && (
                        <span style={{ fontSize: 9, color: "#f5a623" }}>· unsaved</span>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type={s.secret && !show ? "password" : "text"}
                        value={inputVal}
                        onChange={(e) => setDraft(s.key, e.target.value)}
                        placeholder={s.secret && s.isSet ? `stored: ${s.masked} — type to replace` : s.secret ? "not set" : ""}
                        style={{ flex: 1, background: "var(--bg-tertiary)", border: `1px solid ${isDirty ? "var(--accent-border)" : "var(--border)"}`, borderRadius: 6, padding: "7px 10px", color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-mono)", outline: "none" }}
                      />

                      {s.secret && (
                        <button
                          onClick={() => setRevealed((p) => p.includes(s.key) ? p.filter((k) => k !== s.key) : [...p, s.key])}
                          title={show ? "Hide" : "Show what you are typing"}
                          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 8px", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                          {show ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      )}

                      {s.source === "ui" && (
                        <button
                          onClick={() => resetToEnv(s.key)}
                          title="Remove this override and fall back to .env or the default"
                          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 8px", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>

                    {s.hintText && (
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.5 }}>
                        {s.hintText}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, padding: "11px 16px", borderRadius: 8, fontSize: 12, maxWidth: 380, lineHeight: 1.5, background: toast.kind === "ok" ? "rgba(0,208,132,0.12)" : "rgba(255,59,48,0.12)", border: `1px solid ${toast.kind === "ok" ? "rgba(0,208,132,0.35)" : "rgba(255,59,48,0.35)"}`, color: toast.kind === "ok" ? "#00d084" : "#ff3b30", zIndex: 50 }}>
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
