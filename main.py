import os
import sys
import time
import threading
from dotenv import load_dotenv

load_dotenv()

# Add project root to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core              import settings
from core.database      import init_db, upsert_mr, is_already_reviewed, save_review, get_connection
from core.gitlab_client import get_open_mrs, get_mr_diff, get_mr_detail  # ← add get_mr_detail
from core.reviewer      import review_mr
from core.ngrok_manager import start_ngrok, stop_ngrok
from webhook.server     import start_server
from apscheduler.schedulers.background import BackgroundScheduler


# Read at use time, not import time — the Settings UI can change these.

def webhook_port() -> int:
    return settings.get_int("WEBHOOK_PORT", 8001)


def poll_interval() -> int:
    return settings.get_int("POLL_INTERVAL", 300)


# ── Banner ────────────────────────────────────────────────────

def print_banner():
    print("""
╔══════════════════════════════════════════╗
║        AI Code Reviewer v1.0             ║
║   Local tool for GitLab MR reviews       ║
╚══════════════════════════════════════════╝
    """)


# ── Startup checks ────────────────────────────────────────────

def check_env():
    """
    Verify required config is present from any tier (UI, .env, default).

    Missing config is not fatal: the dashboard Settings page can supply it,
    so we explain where to do that instead of exiting and leaving the user
    with no way in.
    """
    missing = settings.missing_required()

    if missing:
        print("⚠️  Required settings are not configured yet:")
        for key in missing:
            print(f"   · {key}")
        print("")
        print("   Set them in the dashboard: http://localhost:3000/settings")
        print("   (or add them to .env — the UI takes precedence)")
        return False

    sources = {key: settings.source_of(key) for key in
               ("GITLAB_URL", "GITLAB_TOKEN", "GITLAB_PROJECT_ID", "OLLAMA_MODEL")}
    from_ui = [k for k, v in sources.items() if v == "ui"]
    print("✅ Configuration loaded"
          + (f" ({len(from_ui)} value(s) from Settings UI)" if from_ui else ""))
    return True


def check_ollama():
    """Verify Ollama is running before we start."""
    import requests
    ollama_url = settings.get("OLLAMA_URL")
    model      = settings.get("OLLAMA_MODEL")

    try:
        res    = requests.get(f"{ollama_url}/api/tags", timeout=5)
        models = [m["name"] for m in res.json().get("models", [])]

        if model not in models:
            print(f"⚠️  Model '{model}' not found in Ollama")
            print(f"   Run: ollama pull {model}")
            print(f"   Or pick an installed model in Settings: {', '.join(models[:5]) or '(none)'}")
            return False

        print(f"✅ Ollama running — model: {model}")
        return True

    except Exception:
        print(f"❌ Ollama not reachable at {ollama_url}")
        print("   Run: ollama serve")
        return False


def check_gitlab():
    """
    Verify GitLab before we start.

    Nothing here exits. Config is read per call, so a token fixed in the
    Settings UI (or in .env) is picked up by the next poll without a
    restart — exiting would only strand the user.
    """
    state, message = check_gitlab_connection()

    if state == "ok":
        print(f"✅ GitLab reachable — {message}")
        return True

    print(f"{STATE_ICONS.get(state, '⚠️')}  {message}")

    if state == "bad_token":
        print("   Reviews will fail until this is fixed. No restart needed —")
        print("   update the token and the next poll will pick it up.")
    else:
        print("   Continuing — polling will retry automatically.")

    return False


# ── Initial sync ──────────────────────────────────────────────

def sync_open_mrs():
    """
    1. First sync status of all 'opened' MRs in DB
       (catches merges/closes that happened while offline)
    2. Then fetch all open MRs from GitLab and review new ones
    """
    print("\n🔄 Syncing MRs from GitLab...")

    # ── Part 1: Sync status of existing open MRs ──────────────
    try:
        conn     = get_connection()
        open_mrs_in_db = conn.execute(
            "SELECT mr_iid FROM mrs WHERE status = 'opened'"
        ).fetchall()
        conn.close()

        if open_mrs_in_db:
            print(f"   🔍 Checking status of {len(open_mrs_in_db)} open MR(s) in DB...")
            updated = 0

            for row in open_mrs_in_db:
                mr_iid = row[0]
                try:
                    mr_detail      = get_mr_detail(mr_iid)
                    gitlab_status  = mr_detail.get("state", "opened")

                    if gitlab_status != "opened":
                        conn = get_connection()
                        conn.execute(
                            "UPDATE mrs SET status = ?, updated_at = ? WHERE mr_iid = ?",
                            (gitlab_status, mr_detail.get("updated_at", ""), mr_iid)
                        )
                        conn.commit()
                        conn.close()
                        print(f"   ✅ MR !{mr_iid} → {gitlab_status}")
                        updated += 1

                except Exception as e:
                    print(f"   ⚠️  MR !{mr_iid} status check failed: {e}")

            if updated == 0:
                print("   All MRs still open — no status changes")
            else:
                print(f"   Updated {updated} MR status(es)")

    except Exception as e:
        print(f"   ⚠️  Status sync failed: {e}")

    # ── Part 2: Fetch open MRs and review new ones ─────────────
    try:
        mrs = get_open_mrs()

        if not mrs:
            print("   No open MRs found on GitLab")
            return

        print(f"\n   Found {len(mrs)} open MR(s) on GitLab")

        for mr in mrs:
            mr_iid     = mr["iid"]
            commit_sha = mr.get("sha", "")
            title      = mr["title"]

            # Save/update MR record in DB
            upsert_mr(mr)

            # Skip if already reviewed this exact commit
            if commit_sha and is_already_reviewed(mr_iid, commit_sha):
                print(f"   ⏭️  MR !{mr_iid} already reviewed — skipping")
                continue

            print(f"\n   🤖 Reviewing MR !{mr_iid} — {title}")
            print(f"      by @{mr['author']['username']}")

            try:
                diff_data  = get_mr_diff(mr_iid)
                result     = review_mr(mr, diff_data)
                commit_sha = mr.get("sha", "")
                save_review(mr_iid, result, commit_sha)

                # Send notification to Google Chat
                from core.notifier import send_review_notification
                send_review_notification(mr, result)

                score  = result.get("score", 0)
                issues = len(result.get("comments", []))
                emoji  = "🟢" if score >= 90 else "🟡" if score >= 70 else "🟠" if score >= 50 else "🔴"
                print(f"      {emoji} Score: {score}/100 | Issues: {issues}")

            except Exception as e:
                print(f"      ❌ Review failed: {e}")

    except Exception as e:
        print(f"   ❌ Sync failed: {e}")

# ── Polling loop ──────────────────────────────────────────────

def polling_loop():
    print(f"⏱️  Polling loop started — every {poll_interval()}s\n")
    while True:
        time.sleep(poll_interval())
        print(f"\n⏱️  Polling GitLab for new MRs...")

        state, message = check_gitlab_connection()
        if state != "ok":
            print(f"   {STATE_ICONS[state]}  {message}")
            print("   Skipping this cycle.")
            continue

        sync_open_mrs()

# ── Helpers ───────────────────────────────────────────────────

STATE_ICONS = {
    "ok":           "✅",
    "bad_token":    "🔑",
    "unreachable":  "⚠️",
    "error":        "⚠️",
    "unconfigured": "⚙️",
}

TOKENS_PATH = "/-/user_settings/personal_access_tokens"


def check_gitlab_connection() -> tuple[str, str]:
    """
    Probe GitLab and report precisely what is wrong.

    Returns (state, message) where state is one of:
      "ok"          — reachable and token accepted
      "bad_token"   — GitLab answered but rejected the token (expired/revoked)
      "unreachable" — could not reach GitLab at all (VPN / network / DNS)
      "error"       — GitLab answered with an unexpected status

    The distinction matters: a connection failure means check the VPN,
    while a 401 means the network is fine and the token needs renewing.
    """
    import requests

    gitlab_url = settings.get("GITLAB_URL").rstrip("/")
    token      = settings.get("GITLAB_TOKEN")

    if not gitlab_url:
        return "unconfigured", (
            "GitLab is not configured yet — open "
            "http://localhost:3000/settings to add your URL, token and project ID"
        )

    if not token:
        return "bad_token", (
            "No GitLab token configured — add one in Settings "
            "(http://localhost:3000/settings) or in .env"
        )

    try:
        response = requests.get(
            f"{gitlab_url}/api/v4/user",
            headers={"PRIVATE-TOKEN": token},
            timeout=5,
        )
    except requests.exceptions.RequestException as e:
        return "unreachable", (
            f"Cannot reach {gitlab_url} ({type(e).__name__}) — "
            f"check VPN / network"
        )

    if response.status_code in (401, 403):
        # GitLab answered us, so the network path is fine — the credential is not.
        return "bad_token", (
            f"""GitLab rejected GITLAB_TOKEN (HTTP {response.status_code}) — the token is expired or revoked.
      GitLab itself is reachable, so this is NOT a VPN problem.
      Create a new token with the 'api' scope at:
      {gitlab_url}{TOKENS_PATH}
      then update GITLAB_TOKEN in .env and restart."""
        )

    if not response.ok:
        return "error", (
            f"GitLab returned HTTP {response.status_code} for /api/v4/user"
        )

    try:
        username = response.json().get("username", "")
    except ValueError:
        username = ""

    detail = f"authenticated as @{username}" if username else "authenticated"
    return "ok", detail


def is_gitlab_reachable() -> bool:
    """True only when GitLab is reachable AND the token is accepted."""
    state, _ = check_gitlab_connection()
    return state == "ok"

# ── Schedule morning digest email ───────────────────────────────────────────
# 2. Add this function anywhere in main.py:

def start_digest_scheduler():
    from core.digest import send_morning_digest

    digest_time  = settings.get("DIGEST_TIME")
    hour, minute = map(int, digest_time.split(":"))
    
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        send_morning_digest,
        trigger="cron",
        hour=hour,
        minute=minute,
        id="morning_digest",
    )
    scheduler.start()
    print(f"⏰ Morning digest scheduled at {digest_time} daily")
    return scheduler

# ── Main ──────────────────────────────────────────────────────

def main():
    print_banner()

    # 1. Init local database FIRST — settings live in it, so the config
    #    checks below cannot read UI-set values until the table exists.
    print("── Step 1: Initializing database ──────────")
    init_db()
    # Generate a webhook secret on first run so the trigger routes are
    # never left unauthenticated (see core/settings.py for why).
    settings.ensure_webhook_secret()

    # 2. Check configuration
    print("\n── Step 2: Checking configuration ─────────")
    configured = check_env()
    if configured:
        check_ollama()
        check_gitlab()

    if not configured:
        print("")
        print("╔══════════════════════════════════════════════════════════╗")
        print("║  First run — CodeSentryAI needs configuring              ║")
        print("║                                                          ║")
        print("║  1. Start the dashboard:  cd dashboard && npm run dev    ║")
        print("║  2. Open http://localhost:3000/settings                  ║")
        print("║  3. Add your GitLab URL, token and project ID            ║")
        print("║                                                          ║")
        print("║  The webhook server starts anyway so the dashboard can   ║")
        print("║  reach it. Reviews begin once config is saved.           ║")
        print("╚══════════════════════════════════════════════════════════╝")
        print("")
        start_server(port=webhook_port(), debug=False)
        return

    # 3. Start ngrok tunnel
    print("\n── Step 3: Starting ngrok ──────────────────")
    public_url = "(ngrok not started)"
    try:
        public_url = start_ngrok(port=webhook_port())
    except Exception as e:
        print(f"⚠️  ngrok failed to start: {e}")
        print("   Check NGROK_AUTHTOKEN in Settings. Continuing without a")
        print("   tunnel — polling still works, but GitLab webhooks cannot")
        print("   reach this machine.")

    # 4. Initial sync — review all existing open MRs
    print("\n── Step 4: Initial MR sync ─────────────────")
    sync_open_mrs()

    # 5. Start polling in background thread
    print("\n── Step 5: Starting polling loop ───────────")
    poll_thread = threading.Thread(
        target=polling_loop,
        daemon=True,
        name="PollingThread",
    )
    poll_thread.start()

    print("\n── Step 6: Starting digest scheduler ───────")
    scheduler = start_digest_scheduler()

    #7 . Start Flask webhook server (blocking — runs forever)
    print("\n── Step 7: Starting webhook server ─────────")
    print(f"""
╔══════════════════════════════════════════════════════════╗
║  ✅ AI Code Reviewer is running!                         ║
║                                                          ║
║  ngrok URL:   {public_url:<40} ║
║  Webhook:     {public_url}/webhook                       
║  Dashboard:   http://localhost:3000                      ║
║  Poll every:  {poll_interval()}s                                        
║                                                          ║
║  New MRs will be reviewed automatically.                 ║
║  Open dashboard to approve and post comments.            ║
║                                                          ║
║  Press Ctrl+C to stop.                                   ║
╚══════════════════════════════════════════════════════════╝
    """)

    try:
        start_server(port=webhook_port(), debug=False)
    except KeyboardInterrupt:
        print("\n\n🛑 Shutting down...")
        stop_ngrok()
        print("✅ Stopped. Goodbye!")
        sys.exit(0)


if __name__ == "__main__":
    main()