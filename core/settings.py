"""
Runtime configuration with a three-tier lookup.

    settings table (reviewer.db)  →  .env  →  built-in default

The DB tier is what the dashboard Settings page writes, so a user can
configure CodeSentryAI entirely from the UI without editing any file.
The .env tier stays supported so existing installs keep working and so
Docker/CI deployments can inject config as environment variables.

Nothing here ever writes to .env — the file you hand-edited stays yours.

Values are read on every call rather than cached at import time. That is
deliberate: caching config in module-level constants means a token you
change in the UI (or in .env) is ignored until the process restarts.
"""

import os
from dotenv import load_dotenv

from core.database import get_connection

load_dotenv()


# ── Schema ────────────────────────────────────────────────────────
# Every configurable value, with its type, default, and whether it is
# a secret (secrets are never sent back to the browser once stored).

SECRET  = True
VISIBLE = False

SETTINGS_SCHEMA = {
    # key                    (default,                    secret,  group,      label)
    "GITLAB_URL":            ("",                          VISIBLE, "gitlab",  "GitLab URL"),
    "GITLAB_TOKEN":          ("",                          SECRET,  "gitlab",  "Access token"),
    "GITLAB_PROJECT_ID":     ("",                          VISIBLE, "gitlab",  "Project ID"),

    "OLLAMA_URL":            ("http://localhost:11434",    VISIBLE, "ai",      "Ollama URL"),
    "OLLAMA_MODEL":          ("",                          VISIBLE, "ai",      "Model"),

    "WEBHOOK_PORT":          ("8001",                      VISIBLE, "webhook", "Webhook port"),
    "WEBHOOK_SECRET":        ("",                          SECRET,  "webhook", "Webhook secret"),
    "NGROK_AUTHTOKEN":       ("",                          SECRET,  "webhook", "ngrok auth token"),
    "POLL_INTERVAL":         ("300",                       VISIBLE, "webhook", "Poll interval (s)"),

    "GOOGLE_CHAT_WEBHOOK":   ("",                          SECRET,  "notify",  "Google Chat webhook"),

    "GMAIL_FROM":            ("",                          VISIBLE, "digest",  "Gmail from"),
    "GMAIL_APP_PASSWORD":    ("",                          SECRET,  "digest",  "Gmail app password"),
    "GMAIL_TO":              ("",                          VISIBLE, "digest",  "Digest recipient"),
    "DIGEST_TIME":           ("09:00",                     VISIBLE, "digest",  "Digest time (HH:MM)"),
}


def is_secret(key: str) -> bool:
    entry = SETTINGS_SCHEMA.get(key)
    return bool(entry and entry[1])


# ── Read ──────────────────────────────────────────────────────────

def get(key: str, default: str = None) -> str:
    """
    Resolve one setting: DB → .env → schema default → `default`.

    An empty stored value is treated as "not set" so clearing a field in
    the UI falls back to .env rather than silently disabling the feature.
    """
    try:
        conn = get_connection()
        row  = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        conn.close()
        if row and row[0] not in (None, ""):
            return row[0]
    except Exception:
        # DB not initialised yet (first run) — fall through to .env.
        pass

    env_value = os.getenv(key)
    if env_value not in (None, ""):
        return env_value

    schema_default = SETTINGS_SCHEMA.get(key, (None,))[0]
    if schema_default not in (None, ""):
        return schema_default

    return default if default is not None else ""


def get_int(key: str, default: int = 0) -> int:
    try:
        return int(str(get(key)).strip())
    except (TypeError, ValueError):
        return default


def source_of(key: str) -> str:
    """Where the effective value came from — shown in the Settings UI."""
    try:
        conn = get_connection()
        row  = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        conn.close()
        if row and row[0] not in (None, ""):
            return "ui"
    except Exception:
        pass

    if os.getenv(key) not in (None, ""):
        return "env"

    if SETTINGS_SCHEMA.get(key, (None,))[0] not in (None, ""):
        return "default"

    return "unset"


# ── Write ─────────────────────────────────────────────────────────

def set_value(key: str, value: str) -> None:
    """Store one setting. Unknown keys are rejected, not silently kept."""
    if key not in SETTINGS_SCHEMA:
        raise KeyError(f"Unknown setting: {key}")

    conn = get_connection()
    conn.execute(
        """
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value      = excluded.value,
            updated_at = excluded.updated_at
        """,
        (key, value),
    )
    conn.commit()
    conn.close()


def set_many(values: dict) -> list:
    """Store several settings. Returns the keys actually written."""
    written = []
    for key, value in (values or {}).items():
        if key not in SETTINGS_SCHEMA:
            continue
        # An empty string for a secret means "leave the stored value alone",
        # so the UI can render a masked field without resubmitting it.
        if is_secret(key) and value == "":
            continue
        set_value(key, str(value))
        written.append(key)
    return written


def clear(key: str) -> None:
    """Remove a UI override so the .env value (if any) takes over again."""
    conn = get_connection()
    conn.execute("DELETE FROM settings WHERE key = ?", (key,))
    conn.commit()
    conn.close()


# ── Describe (for the Settings UI) ────────────────────────────────

def describe() -> list:
    """
    Every setting with its effective state, safe to send to the browser.

    Secrets report only whether a value exists and a short hint — never
    the value itself.
    """
    out = []
    for key, (default, secret, group, label) in SETTINGS_SCHEMA.items():
        value  = get(key)
        source = source_of(key)

        entry = {
            "key":    key,
            "label":  label,
            "group":  group,
            "secret": bool(secret),
            "source": source,
            "isSet":  value != "",
        }

        if secret:
            entry["value"] = ""
            entry["hint"]  = _mask(value)
        else:
            entry["value"] = value
            entry["hint"]  = ""

        out.append(entry)
    return out


def _mask(value: str) -> str:
    """`glpat-abcd…wxyz` — enough to recognise, not enough to reuse."""
    if not value:
        return ""
    if len(value) <= 10:
        return "•" * len(value)
    return f"{value[:6]}…{value[-4:]}"


def ensure_webhook_secret() -> str:
    """
    Guarantee a webhook secret exists, generating one on first run.

    The mutating Flask routes require this secret. ngrok forwards traffic to
    localhost, so `request.remote_addr` is 127.0.0.1 even for requests coming
    from the public internet — a "localhost only" check would protect nothing.
    A shared secret does, and auto-generating it means no user ever runs
    unprotected because they skipped a config step.
    """
    existing = get("WEBHOOK_SECRET")
    if existing:
        return existing

    import secrets as _secrets
    generated = _secrets.token_hex(32)
    set_value("WEBHOOK_SECRET", generated)
    return generated


def missing_required() -> list:
    """Required settings with no value from any tier."""
    required = ["GITLAB_URL", "GITLAB_TOKEN", "GITLAB_PROJECT_ID", "OLLAMA_MODEL"]
    return [key for key in required if get(key) == ""]
