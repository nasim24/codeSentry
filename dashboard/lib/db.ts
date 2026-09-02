import Database from "better-sqlite3";
import path from "path";

// ── Connect to reviewer.db ─────────────────────────────────
const DB_PATH = path.join(process.cwd(), "..", "reviewer.db");

function getDb() {
  const db = new Database(DB_PATH, { readonly: true });
  return db;
}

// ── Types ──────────────────────────────────────────────────

export type MRStatus = "opened" | "closed" | "merged";

export interface MR {
  id: number;
  mr_iid: number;
  title: string;
  author: string;
  source_branch: string;
  target_branch: string;
  status: MRStatus;
  mr_url: string;
  last_commit_sha: string;
  created_at: string;
  updated_at: string;
  score: number | null;
  summary: string | null;
  critical_count: number | null;
  high_count: number | null;
  medium_count: number | null;
  low_count: number | null;
  reviewed_at: string | null;
}

export interface Issue {
  file: string;
  line: number;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  message: string;
  suggestion: string | null;
}

export interface Review {
  id: number;
  mr_iid: number;
  score: number;
  summary: string;
  issues_json: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  commit_sha: string;      // ← add this
  reviewed_at: string;
}

export interface Stats {
  total_mrs: number;
  open_mrs: number;
  reviewed: number;
  critical: number;
  avg_score: number;
}

export interface DeveloperStat {
  author: string;
  mr_count: number;
  avg_score: number;
  total_issues: number;
  critical_count: number;
}

// ── Queries ────────────────────────────────────────────────

export function getOpenMRs(): MR[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.*,
              r.score, r.summary,
              r.critical_count, r.high_count,
              r.medium_count, r.low_count, r.reviewed_at
       FROM mrs m
      LEFT JOIN reviews r ON r.id = (
          SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
      )
       WHERE m.status = 'opened'
       ORDER BY m.updated_at DESC`
    )
    .all() as MR[];
  db.close();
  return rows;
}

export function getClosedMRs(page: number = 1, limit: number = 20): {
  mrs: MR[];
  total: number;
  hasMore: boolean;
} {
  const db     = getDb();
  const offset = (page - 1) * limit;

  const total = (db.prepare(
    `SELECT COUNT(*) as count FROM mrs WHERE status IN ('closed', 'merged')`
  ).get() as { count: number }).count;

  const mrs = db.prepare(
    `SELECT m.*,
            r.score, r.summary,
            r.critical_count, r.high_count,
            r.medium_count, r.low_count, r.reviewed_at
     FROM mrs m
     LEFT JOIN reviews r ON r.id = (
         SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
     )
     WHERE m.status IN ('closed', 'merged')
     ORDER BY m.updated_at DESC
     LIMIT ? OFFSET ?`
  ).all(limit, offset) as MR[];

  db.close();
  return {
    mrs,
    total,
    hasMore: offset + mrs.length < total,
  };
}

export function getMRByIid(mr_iid: number): MR | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.*,
              r.score, r.summary,
              r.critical_count, r.high_count,
              r.medium_count, r.low_count, r.reviewed_at
       FROM mrs m
      LEFT JOIN reviews r ON r.id = (
    SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
)
       WHERE m.mr_iid = ?`
    )
    .get(mr_iid) as MR | null;
  db.close();
  return row;
}

// Update getReviewByIid to get LATEST only
export function getReviewByIid(mr_iid: number): Review | null {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT * FROM reviews
      WHERE mr_iid = ?
      ORDER BY reviewed_at DESC
      LIMIT 1
    `)
    .get(mr_iid) as Review | null;
  db.close();
  return row;
}

export function getIssuesByIid(mr_iid: number): Issue[] {
  const review = getReviewByIid(mr_iid);
  if (!review || !review.issues_json) return [];
  try {
    return JSON.parse(review.issues_json) as Issue[];
  } catch {
    return [];
  }
}

export function getStats(): Stats {
  const db = getDb();

  const total_mrs = (
    db.prepare(`SELECT COUNT(*) as count FROM mrs`).get() as { count: number }
  ).count;

  const open_mrs = (
    db
      .prepare(`SELECT COUNT(*) as count FROM mrs WHERE status = 'opened'`)
      .get() as { count: number }
  ).count;

  const reviewed = (
    db
      .prepare(`SELECT COUNT(*) as count FROM reviews`)
      .get() as { count: number }
  ).count;

  const critical = (
    db
      .prepare(
        `SELECT COALESCE(SUM(critical_count), 0) as total FROM reviews`
      )
      .get() as { total: number }
  ).total;

  const avg_score = (
    db
      .prepare(`SELECT COALESCE(AVG(score), 0) as avg FROM reviews`)
      .get() as { avg: number }
  ).avg;

  db.close();

  return {
    total_mrs,
    open_mrs,
    reviewed,
    critical,
    avg_score: Math.round(avg_score * 10) / 10,
  };
}


export function getDailyReport(date: string): {
  mrs: MR[];
  developer_stats: DeveloperStat[];
} {
  const db = getDb();

  const mrs = db
    .prepare(
      `SELECT m.*,
              r.score, r.summary,
              r.critical_count, r.high_count,
              r.medium_count, r.low_count, r.reviewed_at
       FROM mrs m
       LEFT JOIN reviews r ON r.id = (
           SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
       )
       WHERE r.reviewed_at IS NOT NULL
       AND (
           DATE(r.reviewed_at) = ?
           OR DATE(r.reviewed_at, '+5 hours', '+30 minutes') = ?
       )
       ORDER BY r.reviewed_at DESC`
    )
    .all(date, date) as MR[];

  const developer_stats = db
    .prepare(
      `SELECT
          m.author,
          COUNT(*) as mr_count,
          ROUND(AVG(r.score), 1) as avg_score,
          COALESCE(SUM(r.high_count + r.medium_count + r.low_count + r.critical_count), 0) as total_issues,
          COALESCE(SUM(r.critical_count), 0) as critical_count
       FROM mrs m
       JOIN reviews r ON r.id = (
           SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
       )
       WHERE DATE(r.reviewed_at) = ?
          OR DATE(r.reviewed_at, '+5 hours', '+30 minutes') = ?
       GROUP BY m.author
       ORDER BY total_issues DESC`
    )
    .all(date, date) as DeveloperStat[];

  db.close();
  return { mrs, developer_stats };
}

export function getAllMRs(): MR[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.*,
              r.score, r.summary,
              r.critical_count, r.high_count,
              r.medium_count, r.low_count, r.reviewed_at
       FROM mrs m
       LEFT JOIN reviews r ON r.id = (
        SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
      )
       ORDER BY m.updated_at DESC`
    )
    .all() as MR[];
  db.close();
  return rows;
}


// Get all reviews for one MR — for history tab
export function getMRReviewHistory(mr_iid: number): Review[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT * FROM reviews
      WHERE mr_iid = ?
      ORDER BY reviewed_at DESC
    `)
    .all(mr_iid) as Review[];
  db.close();
  return rows;
}

// Get date range report
export function getDateRangeReport(from: string, to: string): {
  mrs: MR[];
  developer_stats: DeveloperStat[];
} {
  const db = getDb();

  const mrs = db.prepare(`
    SELECT m.*,
           r.score, r.summary,
           r.critical_count, r.high_count,
           r.medium_count, r.low_count, r.reviewed_at
    FROM mrs m
    LEFT JOIN reviews r ON r.id = (
        SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
    )
    WHERE r.reviewed_at IS NOT NULL
    AND (
        DATE(r.reviewed_at) BETWEEN ? AND ?
        OR DATE(r.reviewed_at, '+5 hours', '+30 minutes') BETWEEN ? AND ?
    )
    ORDER BY r.reviewed_at DESC
  `).all(from, to, from, to) as MR[];

  const developer_stats = db.prepare(`
    SELECT
        m.author,
        COUNT(*) as mr_count,
        ROUND(AVG(r.score), 1) as avg_score,
        COALESCE(SUM(r.critical_count + r.high_count + r.medium_count + r.low_count), 0) as total_issues,
        COALESCE(SUM(r.critical_count), 0) as critical_count
    FROM mrs m
    JOIN reviews r ON r.id = (
        SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
    )
    WHERE DATE(r.reviewed_at) BETWEEN ? AND ?
       OR DATE(r.reviewed_at, '+5 hours', '+30 minutes') BETWEEN ? AND ?
    GROUP BY m.author
    ORDER BY total_issues DESC
  `).all(from, to, from, to) as DeveloperStat[];

  db.close();
  return { mrs, developer_stats };
}