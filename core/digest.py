import os
import smtplib

from core import settings
import sqlite3
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv

load_dotenv()

def gmail_from() -> str:
    return settings.get("GMAIL_FROM")


def gmail_password() -> str:
    return settings.get("GMAIL_APP_PASSWORD")


def gmail_to() -> str:
    return settings.get("GMAIL_TO")
DB_PATH         = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "reviewer.db"
)


# ── Data fetching ─────────────────────────────────────────────────

def get_yesterday_data() -> dict:
    """Fetch all review data from yesterday."""
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    today     = datetime.now().strftime("%Y-%m-%d")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # MRs reviewed yesterday
    mrs = conn.execute("""
        SELECT m.mr_iid, m.title, m.author, m.status, m.mr_url,
               r.score, r.summary, r.critical_count, r.high_count,
               r.medium_count, r.low_count, r.reviewed_at
        FROM mrs m
        JOIN reviews r ON r.id = (
            SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
        )
        WHERE DATE(r.reviewed_at) = ?
           OR DATE(r.reviewed_at, '+5 hours', '+30 minutes') = ?
        ORDER BY r.score ASC
    """, (yesterday, yesterday)).fetchall()

    # Developer stats
    dev_stats = conn.execute("""
        SELECT m.author,
               COUNT(*) as mr_count,
               ROUND(AVG(r.score), 1) as avg_score,
               SUM(r.critical_count) as critical,
               SUM(r.high_count) as high,
               SUM(r.medium_count) as medium
        FROM mrs m
        JOIN reviews r ON r.id = (
            SELECT MAX(id) FROM reviews WHERE mr_iid = m.mr_iid
        )
        WHERE DATE(r.reviewed_at) = ?
           OR DATE(r.reviewed_at, '+5 hours', '+30 minutes') = ?
        GROUP BY m.author
        ORDER BY critical DESC, high DESC
    """, (yesterday, yesterday)).fetchall()

    # Still open MRs (not yet reviewed)
    open_mrs = conn.execute("""
        SELECT m.mr_iid, m.title, m.author, m.updated_at
        FROM mrs m
        WHERE m.status = 'opened'
        AND m.mr_iid NOT IN (SELECT mr_iid FROM reviews)
    """).fetchall()

    # Total stats
    total_reviews = conn.execute(
        "SELECT COUNT(*) as cnt FROM reviews"
    ).fetchone()["cnt"]

    avg_score = conn.execute(
        "SELECT ROUND(AVG(score), 1) as avg FROM reviews"
    ).fetchone()["avg"] or 0

    conn.close()

    return {
        "date":          yesterday,
        "mrs":           [dict(m) for m in mrs],
        "dev_stats":     [dict(d) for d in dev_stats],
        "open_mrs":      [dict(m) for m in open_mrs],
        "total_reviews": total_reviews,
        "avg_score":     avg_score,
    }


# ── Email HTML builder ────────────────────────────────────────────

def build_email_html(data: dict) -> str:
    """Build a clean HTML email for the morning digest."""
    date      = data["date"]
    mrs       = data["mrs"]
    dev_stats = data["dev_stats"]
    open_mrs  = data["open_mrs"]

    # Overall score color
    def score_color(score):
        if not score:    return "#888"
        if score >= 90:  return "#00c471"
        if score >= 70:  return "#f5a623"
        if score >= 50:  return "#ff8c00"
        return "#ff3b30"

    def score_emoji(score):
        if not score:    return "⬜"
        if score >= 90:  return "🟢"
        if score >= 70:  return "🟡"
        if score >= 50:  return "🟠"
        return "🔴"

    # Summary numbers
    total_mrs  = len(mrs)
    avg_score  = round(sum(m["score"] or 0 for m in mrs) / total_mrs, 1) if total_mrs else 0
    critical   = sum(m["critical_count"] or 0 for m in mrs)
    high       = sum(m["high_count"] or 0 for m in mrs)

    # Status message
    if critical > 0:
        status_msg   = f"⚠️ {critical} critical issue(s) need immediate attention"
        status_color = "#ff3b30"
    elif high > 0:
        status_msg   = f"👀 {high} high severity issue(s) need review before merging"
        status_color = "#ff8c00"
    elif total_mrs == 0:
        status_msg   = "😴 No MRs were reviewed yesterday"
        status_color = "#888888"
    else:
        status_msg   = "✅ All reviews look good!"
        status_color = "#00c471"

    # MR rows HTML
    mr_rows = ""
    for mr in mrs:
        score    = mr.get("score", 0) or 0
        sc_emoji = score_emoji(score)
        sc_color = score_color(score)
        critical_badge = f'<span style="color:#ff3b30;font-weight:700">{mr["critical_count"]}C</span> ' if mr["critical_count"] else ""
        high_badge     = f'<span style="color:#ff8c00;font-weight:700">{mr["high_count"]}H</span> '     if mr["high_count"]     else ""
        medium_badge   = f'<span style="color:#f5a623">{mr["medium_count"]}M</span> '                   if mr["medium_count"]   else ""

        mr_rows += f"""
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:12px 8px;font-size:13px;color:#6c3cfc;font-weight:600">!{mr["mr_iid"]}</td>
          <td style="padding:12px 8px;font-size:13px;color:#1a1a2e;max-width:300px">
            <div style="font-weight:500">{mr["title"]}</div>
            <div style="font-size:11px;color:#888;margin-top:2px">@{mr["author"]}</div>
          </td>
          <td style="padding:12px 8px;font-size:13px;text-align:center">
            <span style="font-size:18px;font-weight:700;color:{sc_color}">{score}</span>
            <span style="font-size:10px;color:#888">/100</span>
          </td>
          <td style="padding:12px 8px;font-size:12px">
            {critical_badge}{high_badge}{medium_badge}
          </td>
        </tr>"""

    # Developer rows HTML
    dev_rows = ""
    for dev in dev_stats:
        avg   = dev.get("avg_score", 0) or 0
        color = score_color(avg)
        alert = "⚠️ " if (dev.get("critical") or 0) > 0 else ""
        dev_rows += f"""
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 8px;font-size:13px">
            <div style="display:inline-block;width:28px;height:28px;border-radius:50%;background:#ede9fe;color:#6c3cfc;font-weight:700;font-size:11px;text-align:center;line-height:28px;margin-right:8px">{dev["author"][0].upper()}</div>
            {alert}@{dev["author"]}
          </td>
          <td style="padding:10px 8px;font-size:13px;text-align:center">{dev["mr_count"]}</td>
          <td style="padding:10px 8px;font-size:13px;text-align:center;color:{color};font-weight:700">{avg}</td>
          <td style="padding:10px 8px;font-size:12px">
            {"🔴 " + str(dev["critical"]) + " critical " if dev.get("critical") else ""}
            {"🟠 " + str(dev["high"]) + " high" if dev.get("high") else "✅ No high issues"}
          </td>
        </tr>"""

    # Open/pending MRs
    pending_section = ""
    if open_mrs:
        pending_rows = "".join([f"""
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 8px;font-size:13px;color:#6c3cfc">!{mr["mr_iid"]}</td>
          <td style="padding:10px 8px;font-size:13px">{mr["title"]}</td>
          <td style="padding:10px 8px;font-size:12px;color:#888">@{mr["author"]}</td>
        </tr>""" for mr in open_mrs])

        pending_section = f"""
        <div style="margin-top:24px">
          <h3 style="font-size:14px;color:#1a1a2e;margin-bottom:12px">⏳ Pending Review ({len(open_mrs)} MRs)</h3>
          <table style="width:100%;border-collapse:collapse;background:#fffbeb;border-radius:8px;overflow:hidden">
            <tr style="background:#fef3c7">
              <th style="padding:8px;font-size:11px;color:#888;text-align:left">MR</th>
              <th style="padding:8px;font-size:11px;color:#888;text-align:left">TITLE</th>
              <th style="padding:8px;font-size:11px;color:#888;text-align:left">AUTHOR</th>
            </tr>
            {pending_rows}
          </table>
        </div>"""

    html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6c3cfc,#a78bfa);padding:24px 28px">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:0.1em;margin-bottom:4px">MORNING DIGEST</div>
      <h1 style="color:#fff;font-size:20px;margin:0 0 4px">CodeSentryAI Daily Report</h1>
      <div style="color:rgba(255,255,255,0.8);font-size:13px">{date}</div>
    </div>

    <div style="padding:24px 28px">

      <!-- Status banner -->
      <div style="background:#f8f8ff;border-left:4px solid {status_color};padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:24px;font-size:13px;color:{status_color};font-weight:500">
        {status_msg}
      </div>

      <!-- Summary stats -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
        <div style="background:#f8f8ff;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#6c3cfc">{total_mrs}</div>
          <div style="font-size:11px;color:#888;margin-top:2px">MRs REVIEWED</div>
        </div>
        <div style="background:#f8f8ff;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:{score_color(avg_score)}">{avg_score}</div>
          <div style="font-size:11px;color:#888;margin-top:2px">AVG SCORE</div>
        </div>
        <div style="background:#f8f8ff;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:{'#ff3b30' if critical > 0 else '#00c471'}">{critical}</div>
          <div style="font-size:11px;color:#888;margin-top:2px">CRITICAL ISSUES</div>
        </div>
      </div>

      {'<!-- No MRs --><div style="text-align:center;padding:32px;color:#888;font-size:14px">No MRs were reviewed yesterday.<br><span style="font-size:12px">The team had a quiet day!</span></div>' if not mrs else f"""
      <!-- MR table -->
      <h3 style="font-size:14px;color:#1a1a2e;margin-bottom:12px">📋 MRs Reviewed Yesterday</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#f8f8ff">
          <th style="padding:8px;font-size:11px;color:#888;text-align:left">MR</th>
          <th style="padding:8px;font-size:11px;color:#888;text-align:left">TITLE</th>
          <th style="padding:8px;font-size:11px;color:#888;text-align:center">SCORE</th>
          <th style="padding:8px;font-size:11px;color:#888;text-align:left">ISSUES</th>
        </tr>
        {mr_rows}
      </table>"""}

      {'<!-- No devs -->' if not dev_stats else f"""
      <!-- Developer breakdown -->
      <h3 style="font-size:14px;color:#1a1a2e;margin:24px 0 12px">👥 Developer Breakdown</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#f8f8ff">
          <th style="padding:8px;font-size:11px;color:#888;text-align:left">DEVELOPER</th>
          <th style="padding:8px;font-size:11px;color:#888;text-align:center">MRs</th>
          <th style="padding:8px;font-size:11px;color:#888;text-align:center">AVG SCORE</th>
          <th style="padding:8px;font-size:11px;color:#888;text-align:left">ISSUES</th>
        </tr>
        {dev_rows}
      </table>"""}

      {pending_section}

      <!-- Footer -->
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #f0f0f0;text-align:center">
        <a href="http://localhost:3000" style="display:inline-block;background:#6c3cfc;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:500">
          Open Dashboard →
        </a>
        <div style="margin-top:12px;font-size:11px;color:#aaa">
          CodeSentryAI AI Code Reviewer · {data["total_reviews"]} total reviews · {data["avg_score"]} overall avg score
        </div>
      </div>

    </div>
  </div>
</body>
</html>"""

    return html


# ── Send email ────────────────────────────────────────────────────

def send_digest_email(data: dict) -> bool:
    """Send the morning digest email via Gmail."""
    if not gmail_from() or not gmail_password() or not gmail_to():
        print("  ⚠️  Gmail not configured — check gmail_from(), GMAIL_APP_PASSWORD, gmail_to() in .env")
        return False

    date      = data["date"]
    total_mrs = len(data["mrs"])
    avg_score = round(sum(m["score"] or 0 for m in data["mrs"]) / total_mrs, 1) if total_mrs else 0
    critical  = sum(m["critical_count"] or 0 for m in data["mrs"])

    # Subject line
    if critical > 0:
        subject = f"🔴 CodeSentryAI: {critical} critical issue(s) found — {date}"
    elif total_mrs == 0:
        subject = f"😴 CodeSentryAI: No reviews yesterday — {date}"
    else:
        subject = f"🟡 CodeSentryAI: {total_mrs} MR(s) reviewed, avg {avg_score}/100 — {date}"

    # Build email
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"CodeSentryAI <{gmail_from()}>"
    msg["To"]      = gmail_to()

    html_content = build_email_html(data)
    msg.attach(MIMEText(html_content, "html"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(gmail_from(), gmail_password())
            smtp.sendmail(gmail_from(), gmail_to(), msg.as_string())

        print(f"  📧 Morning digest sent to {gmail_to()}")
        return True

    except smtplib.SMTPAuthenticationError:
        print("  ❌ Gmail auth failed — check GMAIL_APP_PASSWORD in .env")
        print("     Make sure you're using App Password, not your regular password")
        return False
    except Exception as e:
        print(f"  ❌ Email send failed: {e}")
        return False


def send_morning_digest() -> bool:
    """Main function — fetch data and send digest."""
    print("\n📧 Preparing morning digest...")
    data    = get_yesterday_data()
    success = send_digest_email(data)
    return success


# ── Test ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🧪 Testing morning digest email...\n")

    data = get_yesterday_data()
    print(f"📊 Yesterday ({data['date']}):")
    print(f"   MRs reviewed: {len(data['mrs'])}")
    print(f"   Developers:   {len(data['dev_stats'])}")
    print(f"   Open MRs:     {len(data['open_mrs'])}")
    print()

    success = send_morning_digest()
    if success:
        print("✅ Check your inbox!")
    else:
        print("❌ Check your .env settings")