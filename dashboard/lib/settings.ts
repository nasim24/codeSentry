import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * Settings access for the dashboard, mirroring core/settings.py.
 *
 * Lookup order is identical so both processes always agree:
 *     settings table (reviewer.db)  →  process env  →  built-in default
 *
 * The Python side reads these values per call, so a change saved here
 * takes effect on the next poll without restarting anything.
 */

const DB_PATH  = path.join(process.cwd(), "..", "reviewer.db");
const ENV_PATH = path.join(process.cwd(), "..", ".env");

/**
 * Parse the project-root .env.
 *
 * Next only auto-loads dashboard/.env*, but the Python side loads the root
 * .env — so without this the Settings page reports "unset" for values that
 * are configured and working. Both processes must see the same config or the
 * page lies to the user.
 *
 * Mirrors python-dotenv's behaviour closely enough for our keys, including
 * stripping trailing inline comments from unquoted values.
 */
function rootEnv(): Record<string, string> {
  let text: string;
  try {
    text = fs.readFileSync(ENV_PATH, "utf-8");
  } catch {
    return {};
  }

  const out: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || key.startsWith("#")) continue;

    let value = line.slice(eq + 1).trim();

    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1);

    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // Unquoted: a " #" starts a trailing comment, as python-dotenv treats it.
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    if (value !== "") out[key] = value;
  }

  return out;
}

let envCache: Record<string, string> | null = null;

function fileEnv(key: string): string | undefined {
  if (envCache === null) envCache = rootEnv();
  return envCache[key];
}

export type SettingGroup = "gitlab" | "ai" | "webhook" | "notify" | "digest";

export interface SettingDef {
  key:      string;
  label:    string;
  group:    SettingGroup;
  secret:   boolean;
  hintText: string;
  default:  string;
}

/** Keep in sync with SETTINGS_SCHEMA in core/settings.py. */
export const SETTINGS_SCHEMA: SettingDef[] = [
  { key: "GITLAB_URL",          label: "GitLab URL",          group: "gitlab",  secret: false, default: "",                       hintText: "e.g. https://gitlab.example.com  (include the port if non-standard)" },
  { key: "GITLAB_TOKEN",        label: "Access token",        group: "gitlab",  secret: true,  default: "",                       hintText: "Needs the 'api' scope AND at least the Developer role on the project" },
  { key: "GITLAB_PROJECT_ID",   label: "Project ID",          group: "gitlab",  secret: false, default: "",                       hintText: "Numeric ID from your project's home page" },

  { key: "OLLAMA_URL",          label: "Ollama URL",          group: "ai",      secret: false, default: "http://localhost:11434", hintText: "Where Ollama is listening" },
  { key: "OLLAMA_MODEL",        label: "Model",               group: "ai",      secret: false, default: "",                       hintText: "Must be installed — check with `ollama list`" },

  { key: "WEBHOOK_PORT",        label: "Webhook port",        group: "webhook", secret: false, default: "8001",                   hintText: "Port for the local Flask server" },
  { key: "WEBHOOK_SECRET",      label: "Webhook secret",      group: "webhook", secret: true,  default: "",                       hintText: "Generated automatically. Paste the same value into GitLab's webhook settings" },
  { key: "NGROK_AUTHTOKEN",     label: "ngrok auth token",    group: "webhook", secret: true,  default: "",                       hintText: "Optional — only needed for the public webhook tunnel" },
  { key: "POLL_INTERVAL",       label: "Poll interval (s)",   group: "webhook", secret: false, default: "300",                    hintText: "How often to check GitLab for new MRs" },

  { key: "GOOGLE_CHAT_WEBHOOK", label: "Google Chat webhook", group: "notify",  secret: true,  default: "",                       hintText: "Optional — leave empty to disable chat notifications" },

  { key: "GMAIL_FROM",          label: "Gmail from",          group: "digest",  secret: false, default: "",                       hintText: "Optional — sender address for the daily digest" },
  { key: "GMAIL_APP_PASSWORD",  label: "Gmail app password",  group: "digest",  secret: true,  default: "",                       hintText: "A Google App Password, not your account password" },
  { key: "GMAIL_TO",            label: "Digest recipient",    group: "digest",  secret: false, default: "",                       hintText: "Who receives the morning digest" },
  { key: "DIGEST_TIME",         label: "Digest time",         group: "digest",  secret: false, default: "09:00",                  hintText: "24-hour HH:MM, local time" },
];

const BY_KEY = new Map(SETTINGS_SCHEMA.map((s) => [s.key, s]));

export const GROUP_LABELS: Record<SettingGroup, string> = {
  gitlab:  "GitLab connection",
  ai:      "AI model",
  webhook: "Webhook & polling",
  notify:  "Notifications",
  digest:  "Email digest",
};

/**
 * Create the settings table if it is missing.
 *
 * The Python side creates it in init_db(), but nothing guarantees the user
 * ran `python main.py` before opening the dashboard — and the natural first
 * move is to open Settings and start typing. Without this, that user's first
 * Save fails with "no such table: settings".
 *
 * Must stay identical to the schema in core/database.py.
 */
function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  TEXT DEFAULT (datetime('now'))
    )
  `);
}

function readDb<T>(fn: (db: Database.Database) => T, fallback: T): T {
  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });
    return fn(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

function storedValues(): Record<string, string> {
  return readDb((db) => {
    const rows = db
      .prepare("SELECT key, value FROM settings")
      .all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (row.value !== null && row.value !== "") out[row.key] = row.value;
    }
    return out;
  }, {});
}

/** Resolve one setting the same way core/settings.py does. */
export function getSetting(key: string): string {
  const stored = storedValues()[key];
  if (stored) return stored;

  const env = process.env[key];
  if (env) return env;

  const fromFile = fileEnv(key);
  if (fromFile) return fromFile;

  return BY_KEY.get(key)?.default ?? "";
}

export type SettingSource = "ui" | "env" | "default" | "unset";

export interface SettingState {
  key:      string;
  label:    string;
  group:    SettingGroup;
  secret:   boolean;
  hintText: string;
  source:   SettingSource;
  isSet:    boolean;
  /** Present for non-secrets only. Secrets always come back as "". */
  value:    string;
  /** Masked preview for secrets, e.g. `glpat-…wxyz`. */
  masked:   string;
}

/** Everything the Settings page needs. Secret values never leave the server. */
export function describeSettings(): SettingState[] {
  const stored = storedValues();

  return SETTINGS_SCHEMA.map((def) => {
    let source: SettingSource = "unset";
    let value = "";

    if (stored[def.key]) {
      source = "ui";
      value  = stored[def.key];
    } else if (process.env[def.key]) {
      source = "env";
      value  = process.env[def.key] as string;
    } else if (fileEnv(def.key)) {
      source = "env";
      value  = fileEnv(def.key) as string;
    } else if (def.default) {
      source = "default";
      value  = def.default;
    }

    return {
      key:      def.key,
      label:    def.label,
      group:    def.group,
      secret:   def.secret,
      hintText: def.hintText,
      source,
      isSet:    value !== "",
      value:    def.secret ? "" : value,
      masked:   def.secret ? mask(value) : "",
    };
  });
}

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 10) return "•".repeat(value.length);
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Persist settings. Returns the keys actually written.
 *
 * An empty string for a secret means "keep what is stored" — that is how the
 * UI can show a masked field without ever round-tripping the real value.
 * Unknown keys are ignored rather than written, so a crafted request cannot
 * stuff arbitrary rows into the table.
 */
export function saveSettings(values: Record<string, string>): string[] {
  const writable = Object.entries(values ?? {}).filter(([key, value]) => {
    const def = BY_KEY.get(key);
    if (!def) return false;
    if (def.secret && value === "") return false;
    return true;
  });

  if (writable.length === 0) return [];

  const db = new Database(DB_PATH);
  try {
    ensureSchema(db);
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value      = excluded.value,
        updated_at = excluded.updated_at
    `);
    const tx = db.transaction((entries: [string, string][]) => {
      for (const [key, value] of entries) stmt.run(key, String(value));
    });
    tx(writable as [string, string][]);
    return writable.map(([key]) => key);
  } finally {
    db.close();
  }
}

/** Drop a UI override so the .env value (if any) applies again. */
export function clearSetting(key: string): boolean {
  if (!BY_KEY.has(key)) return false;
  const db = new Database(DB_PATH);
  try {
    ensureSchema(db);
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return true;
  } finally {
    db.close();
  }
}
