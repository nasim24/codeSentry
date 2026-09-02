import sqlite3
import json
import os
from datetime import datetime

DB_PATH = "reviewer.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # lets us access columns by name
    return conn


def init_db():
    """Create all tables if they don't exist yet."""
    conn = get_connection()
    cursor = conn.cursor()

    # ── MRs table ────────────────────────────────────────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS mrs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            mr_iid          INTEGER UNIQUE NOT NULL,
            title           TEXT NOT NULL,
            author          TEXT NOT NULL,
            source_branch   TEXT NOT NULL,
            target_branch   TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'opened',
            mr_url          TEXT,
            last_commit_sha TEXT,
            created_at      TEXT,
            updated_at      TEXT,
            synced_at       TEXT DEFAULT (datetime('now'))
        )
    """)

    # ── Reviews table ─────────────────────────────────────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reviews (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            mr_iid          INTEGER NOT NULL,
            score           INTEGER DEFAULT 0,
            summary         TEXT,
            issues_json     TEXT DEFAULT '[]',
            critical_count  INTEGER DEFAULT 0,
            high_count      INTEGER DEFAULT 0,
            medium_count    INTEGER DEFAULT 0,
            low_count       INTEGER DEFAULT 0,
            reviewed_at     TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (mr_iid) REFERENCES mrs (mr_iid)
        )
    """)

    # ── Settings table ────────────────────────────────────────
    # Written by the dashboard Settings page. Takes precedence over
    # .env so the tool can be configured without editing any file.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key             TEXT PRIMARY KEY,
            value           TEXT,
            updated_at      TEXT DEFAULT (datetime('now'))
        )
    """)

    # ── Comments posted table ─────────────────────────────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS comments_posted (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            mr_iid          INTEGER NOT NULL,
            comment_body    TEXT,
            gitlab_note_id  INTEGER,
            posted_at       TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (mr_iid) REFERENCES mrs (mr_iid)
        )
    """)

    conn.commit()
    conn.close()
    print("✅ Database ready — reviewer.db")


# ── MR queries ────────────────────────────────────────────────

def upsert_mr(mr_data: dict):
    """Insert a new MR or update if it already exists."""
    conn = get_connection()
    conn.execute("""
        INSERT INTO mrs (
            mr_iid, title, author, source_branch,
            target_branch, status, mr_url,
            last_commit_sha, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mr_iid) DO UPDATE SET
            title           = excluded.title,
            status          = excluded.status,
            last_commit_sha = excluded.last_commit_sha,
            updated_at      = excluded.updated_at,
            synced_at       = datetime('now')
    """, (
        mr_data["iid"],
        mr_data["title"],
        mr_data["author"]["username"],
        mr_data["source_branch"],
        mr_data["target_branch"],
        mr_data["state"],
        mr_data["web_url"],
        mr_data.get("sha"),
        mr_data["created_at"],
        mr_data["updated_at"],
    ))
    conn.commit()
    conn.close()


def get_all_mrs(status: str = None):
    """Fetch MRs with their latest review if available."""
    conn = get_connection()
    if status:
        rows = conn.execute("""
            SELECT m.*, r.score, r.summary, r.critical_count,
                   r.high_count, r.medium_count, r.low_count, r.reviewed_at
            FROM mrs m
            LEFT JOIN reviews r ON m.mr_iid = r.mr_iid
            WHERE m.status = ?
            ORDER BY m.updated_at DESC
        """, (status,)).fetchall()
    else:
        rows = conn.execute("""
            SELECT m.*, r.score, r.summary, r.critical_count,
                   r.high_count, r.medium_count, r.low_count, r.reviewed_at
            FROM mrs m
            LEFT JOIN reviews r ON m.mr_iid = r.mr_iid
            ORDER BY m.updated_at DESC
        """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_mr(mr_iid: int):
    """Get a single MR with its review."""
    conn = get_connection()
    row = conn.execute("""
        SELECT m.*, r.score, r.summary, r.issues_json,
               r.critical_count, r.high_count, r.medium_count,
               r.low_count, r.reviewed_at
        FROM mrs m
        LEFT JOIN reviews r ON m.mr_iid = r.mr_iid
        WHERE m.mr_iid = ?
    """, (mr_iid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def is_already_reviewed(mr_iid: int, commit_sha: str) -> bool:
    """Returns True if we already reviewed this exact commit SHA."""
    if not commit_sha or commit_sha.strip() == "":
        return False  # can't check without SHA

    conn = get_connection()
    row  = conn.execute("""
        SELECT id FROM reviews
        WHERE mr_iid = ?
        AND commit_sha = ?
        AND commit_sha != ''
        AND commit_sha IS NOT NULL
    """, (mr_iid, commit_sha)).fetchone()
    conn.close()

    exists = row is not None
    print(f"  🔍 is_already_reviewed MR !{mr_iid} sha:{commit_sha[:8]} → {exists}")
    return exists


# ── Review queries ────────────────────────────────────────────

# core/database.py — update save_review()

def save_review(mr_iid: int, result: dict, commit_sha: str = ""):
    """Always INSERT — preserves full review history per commit."""
    issues = result.get("comments", [])
    conn   = get_connection()

    conn.execute("""
        INSERT INTO reviews (
            mr_iid, score, summary, issues_json,
            critical_count, high_count, medium_count,
            low_count, commit_sha
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        mr_iid,
        result.get("score", 0),
        result.get("summary", ""),
        json.dumps(issues),
        sum(1 for i in issues if i.get("severity") == "critical"),
        sum(1 for i in issues if i.get("severity") == "high"),
        sum(1 for i in issues if i.get("severity") == "medium"),
        sum(1 for i in issues if i.get("severity") == "low"),
        commit_sha,
    ))

    conn.commit()
    conn.close()
    print(f"  ✅ Review history saved — MR !{mr_iid} sha:{commit_sha[:8]}")

def save_comment(mr_iid: int, body: str, gitlab_note_id: int = None):
    """Record that we posted a comment on a MR."""
    conn = get_connection()
    conn.execute("""
        INSERT INTO comments_posted (mr_iid, comment_body, gitlab_note_id)
        VALUES (?, ?, ?)
    """, (mr_iid, body, gitlab_note_id))
    conn.commit()
    conn.close()


# ── Stats for dashboard ───────────────────────────────────────

def get_stats():
    """Summary numbers for the dashboard header."""
    conn = get_connection()

    total_mrs    = conn.execute("SELECT COUNT(*) FROM mrs").fetchone()[0]
    open_mrs     = conn.execute("SELECT COUNT(*) FROM mrs WHERE status = 'opened'").fetchone()[0]
    reviewed     = conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
    critical     = conn.execute("SELECT SUM(critical_count) FROM reviews").fetchone()[0] or 0
    avg_score    = conn.execute("SELECT AVG(score) FROM reviews").fetchone()[0] or 0

    conn.close()
    return {
        "total_mrs":   total_mrs,
        "open_mrs":    open_mrs,
        "reviewed":    reviewed,
        "critical":    critical,
        "avg_score":   round(avg_score, 1),
    }


# ── Run directly to test ──────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("Stats:", get_stats())