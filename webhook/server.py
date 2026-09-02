import os
import sys
import threading
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

# Add parent directory so we can import core modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.database      import init_db, upsert_mr, save_review, is_already_reviewed
from core.gitlab_client import get_mr_diff, get_mr_detail
from core.reviewer      import review_mr
from core                import settings

app = Flask(__name__)


def webhook_port() -> int:
    return settings.get_int("WEBHOOK_PORT", 8001)


def webhook_secret() -> str:
    return settings.get("WEBHOOK_SECRET")


# ── Helpers ───────────────────────────────────────────────────────

def verify_secret(req) -> bool:
    """GitLab sends the shared secret as X-Gitlab-Token."""
    return req.headers.get("X-Gitlab-Token", "") == webhook_secret()


def verify_local_caller(req) -> bool:
    """
    Guard the routes the dashboard triggers (/review, /backfill).

    These start AI work, so leaving them open lets anyone who learns the
    ngrok URL burn unlimited compute. A "localhost only" check does NOT
    work here: ngrok's agent forwards to 127.0.0.1, so remote_addr is
    always local even for public traffic. A shared secret is the only
    thing that actually distinguishes the dashboard from the internet.
    """
    secret = webhook_secret()
    if not secret:
        # Should not happen — main.py generates one on first run.
        print("⚠️  No WEBHOOK_SECRET set — refusing unauthenticated trigger")
        return False
    return req.headers.get("X-CodeSentry-Token", "") == secret


# ── In-flight review tracking ─────────────────────────────────────
# The dashboard needs to tell "AI is reviewing right now" apart from
# "this MR has no review and won't get one unless someone asks".
# Without this, an MR with no review looks identical to one mid-review.

_in_flight      = set()
_in_flight_lock = threading.Lock()


def currently_reviewing() -> list:
    """MR iids with a review running in this process right now."""
    with _in_flight_lock:
        return sorted(_in_flight)


def run_tracked(mr_iid: int, fn, *args):
    """Run a review job, marking the MR as in-flight for its duration."""
    with _in_flight_lock:
        _in_flight.add(int(mr_iid))
    try:
        fn(*args)
    finally:
        with _in_flight_lock:
            _in_flight.discard(int(mr_iid))


# ── Background Review ─────────────────────────────────────────────

def process_review_in_background(mr_data: dict):
    """
    Run AI review for ALL unreviewed commits on this MR.
    Ensures full review history is captured.
    """
    mr_iid = mr_data["iid"]
    print(f"\n🔄 Background review starting for MR !{mr_iid}...")

    try:
        from core.gitlab_client import get_mr_commits

        # Fetch all commits for this MR
        try:
            commits = get_mr_commits(mr_iid)
            print(f"  📋 Found {len(commits)} commit(s) on MR !{mr_iid}")
        except Exception as e:
            print(f"  ⚠️  Could not fetch commits: {e}")
            commits = [{
                "id":    mr_data.get("sha") or mr_data.get("last_commit", {}).get("id", ""),
                "title": "latest commit",
            }]

        # Filter to only unreviewed commits
        unreviewed = [
            c for c in commits
            if c.get("id") and not is_already_reviewed(mr_iid, c["id"])
        ]

        if not unreviewed:
            print(f"  ⏭️  All commits already reviewed — skipping")
            return

        print(f"  🔍 {len(unreviewed)} unreviewed commit(s) to process")

        result = None

        # Review each unreviewed commit — oldest first
        for i, commit in enumerate(reversed(unreviewed), 1):
            commit_sha   = commit["id"]
            commit_title = commit.get("title", "")[:50]
            print(f"\n  📦 Reviewing commit {i}/{len(unreviewed)}: {commit_sha[:8]} — {commit_title}")

            try:
                # Double-check before saving (race condition guard)
                if is_already_reviewed(mr_iid, commit_sha):
                    print(f"     ⏭️  Already in DB — skipping {commit_sha[:8]}")
                    continue

                diff_data = get_mr_diff(mr_iid)

                if not diff_data.get("diffs"):
                    print(f"     ⚠️  No diff found — skipping")
                    continue

                print(f"     🤖 Running AI review...")
                result = review_mr(mr_data, diff_data)
                save_review(mr_iid, result, commit_sha)

                score  = result.get("score", 0)
                issues = len(result.get("comments", []))
                emoji  = "🟢" if score >= 90 else "🟡" if score >= 70 else "🟠" if score >= 50 else "🔴"
                print(f"     {emoji} Commit {commit_sha[:8]} — score: {score} | issues: {issues}")

            except Exception as e:
                print(f"     ❌ Failed reviewing commit {commit_sha[:8]}: {e}")
                continue

        # Send ONE notification for the latest review
        if result is not None:
            from core.notifier import send_review_notification
            try:
                full_mr_data = get_mr_detail(mr_iid)
                send_review_notification(full_mr_data, result)
            except Exception as e:
                print(f"  ⚠️  Notification failed: {e}")

            score   = result.get("score", 0)
            issues  = len(result.get("comments", []))
            summary = result.get("summary", "")
            emoji   = "🟢" if score >= 90 else "🟡" if score >= 70 else "🟠" if score >= 50 else "🔴"

            print(f"\n  {emoji} MR !{mr_iid} review complete")
            print(f"     Score:   {score}/100")
            print(f"     Issues:  {issues}")
            print(f"     Summary: {summary}")

        print(f"\n  💡 Open dashboard → http://localhost:3000\n")

    except Exception as e:
        print(f"❌ Review failed for MR !{mr_iid}: {e}")
        import traceback
        traceback.print_exc()


# ── Routes ────────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def health():
    return jsonify({
        "status":  "running",
        "service": "CodeSentryAI",
        "version": "1.0.0",
    })


@app.route("/reviewing", methods=["GET"])
def reviewing():
    """Which MRs are being reviewed right now — polled by the dashboard."""
    return jsonify({"reviewing": currently_reviewing()})


@app.route("/webhook", methods=["POST"])
def webhook():
    # 1. Verify secret
    if webhook_secret() and not verify_secret(request):
        print("⚠️  Webhook received with invalid secret — ignoring")
        return jsonify({"error": "Unauthorized"}), 401

    # 2. Check event type
    event = request.headers.get("X-Gitlab-Event", "")
    if event != "Merge Request Hook":
        return jsonify({"message": f"Event '{event}' ignored"}), 200

    # 3. Parse payload
    try:
        payload = request.get_json()
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    if not payload:
        return jsonify({"error": "Empty payload"}), 400

    # 4. Get action
    mr_data = payload.get("object_attributes", {})
    action  = mr_data.get("action", "")

    print(f"\n📨 GitLab webhook: MR !{mr_data.get('iid')} — action: {action}")

    # Handle merge/close — update status only
    if action in ["merge", "close"]:
        new_status = "merged" if action == "merge" else "closed"
        try:
            from core.database import get_connection
            conn = get_connection()
            conn.execute(
                "UPDATE mrs SET status = ? WHERE mr_iid = ?",
                (new_status, mr_data.get("iid"))
            )
            conn.commit()
            conn.close()
            print(f"   ✅ MR !{mr_data.get('iid')} marked as {new_status}")
        except Exception as e:
            print(f"   ⚠️  Status update failed: {e}")
        return jsonify({"message": f"MR marked as {new_status}"}), 200

    # Ignore other actions
    if action not in ["open", "update", "reopen"]:
        print(f"   Action '{action}' ignored")
        return jsonify({"message": f"Action '{action}' ignored"}), 200

    # 5. Save MR to DB immediately
    try:
        full_mr = {
            "iid":           mr_data.get("iid"),
            "title":         mr_data.get("title"),
            "author":        {"username": payload.get("user", {}).get("username", "unknown")},
            "source_branch": mr_data.get("source_branch"),
            "target_branch": mr_data.get("target_branch"),
            "state":         mr_data.get("state", "opened"),
            "web_url":       mr_data.get("url"),
            "sha":           mr_data.get("last_commit", {}).get("id"),
            "created_at":    mr_data.get("created_at"),
            "updated_at":    mr_data.get("updated_at"),
        }
        upsert_mr(full_mr)
        print(f"   ✅ MR saved to database")
    except Exception as e:
        print(f"   ⚠️  DB save failed: {e}")
        return jsonify({"error": "DB error"}), 500

    # 6. Start background review
    thread = threading.Thread(
        target=run_tracked,
        args=(mr_data.get("iid"), process_review_in_background, full_mr),
        daemon=True,
    )
    thread.start()
    print(f"   ✅ Review queued in background")

    return jsonify({"message": "Review queued", "mr_iid": mr_data.get("iid")}), 202


@app.route("/webhook/test", methods=["GET"])
def webhook_test():
    return jsonify({
        "message": "Webhook server is reachable! ✅",
        "tip":     "GitLab should POST to /webhook",
    })


@app.route("/review/<int:mr_iid>", methods=["POST"])
def trigger_review(mr_iid: int):
    """Manually trigger a re-review of an MR from the dashboard."""
    print(f"\n🔄 Manual re-review triggered for MR !{mr_iid}")

    if not verify_local_caller(request):
        return jsonify({"error": "Unauthorized"}), 401

    try:
        mr_detail = get_mr_detail(mr_iid)
        if not mr_detail:
            return jsonify({"error": "MR not found"}), 404

        mr_data = {
            "iid":           mr_detail["iid"],
            "title":         mr_detail["title"],
            "author":        {"username": mr_detail["author"]["username"]},
            "source_branch": mr_detail["source_branch"],
            "target_branch": mr_detail["target_branch"],
            "state":         mr_detail["state"],
            "web_url":       mr_detail["web_url"],
            "sha":           mr_detail.get("sha", ""),
            "created_at":    mr_detail["created_at"],
            "updated_at":    mr_detail["updated_at"],
        }
        upsert_mr(mr_data)

        def run_review():
            try:
                commit_sha = mr_detail.get("sha", "")
                diff_data  = get_mr_diff(mr_iid)
                result     = review_mr(mr_data, diff_data)
                save_review(mr_iid, result, commit_sha)

                score  = result.get("score", 0)
                issues = len(result.get("comments", []))
                print(f"✅ Re-review complete MR !{mr_iid} — score: {score} | issues: {issues}")

                from core.notifier import send_review_notification
                try:
                    send_review_notification(mr_detail, result)
                except Exception as e:
                    print(f"⚠️  Notification failed: {e}")

            except Exception as e:
                print(f"❌ Re-review failed MR !{mr_iid}: {e}")

        thread = threading.Thread(
            target=run_tracked, args=(mr_iid, run_review), daemon=True
        )
        thread.start()

        return jsonify({
            "success": True,
            "message": f"Re-review queued for MR !{mr_iid}",
        }), 202

    except Exception as e:
        print(f"❌ Re-review error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/backfill/<int:mr_iid>", methods=["POST"])
def backfill_commits(mr_iid: int):
    """Pull and review all unreviewed commits for a specific MR."""
    print(f"\n🔁 Backfill requested for MR !{mr_iid}")

    if not verify_local_caller(request):
        return jsonify({"error": "Unauthorized"}), 401

    def run_backfill():
        try:
            from core.gitlab_client import get_mr_commits

            mr = get_mr_detail(mr_iid)
            upsert_mr(mr)

            commits = get_mr_commits(mr_iid)
            print(f"  📋 {len(commits)} commit(s) found on MR !{mr_iid}")

            # Filter unreviewed
            unreviewed = [
                c for c in commits
                if c.get("id") and not is_already_reviewed(mr_iid, c["id"])
            ]

            if not unreviewed:
                print(f"  ✅ All commits already reviewed")
                return

            print(f"  🔍 {len(unreviewed)} unreviewed commit(s)")

            # Review oldest first
            for i, commit in enumerate(reversed(unreviewed), 1):
                commit_sha   = commit["id"]
                commit_title = commit.get("title", "")[:50]
                print(f"\n  📦 {i}/{len(unreviewed)}: {commit_sha[:8]} — {commit_title}")

                try:
                    # Double-check before saving
                    if is_already_reviewed(mr_iid, commit_sha):
                        print(f"     ⏭️  Already in DB — skipping {commit_sha[:8]}")
                        continue

                    diff_data = get_mr_diff(mr_iid)
                    if not diff_data.get("diffs"):
                        print(f"     ⚠️  No diff — skipping")
                        continue

                    result = review_mr(mr, diff_data)
                    save_review(mr_iid, result, commit_sha)

                    score  = result.get("score", 0)
                    issues = len(result.get("comments", []))
                    emoji  = "🟢" if score >= 90 else "🟡" if score >= 70 else "🟠" if score >= 50 else "🔴"
                    print(f"     {emoji} score: {score} | issues: {issues}")

                except Exception as e:
                    print(f"     ❌ Failed: {e}")
                    continue

            print(f"\n  ✅ Backfill complete for MR !{mr_iid}")

        except Exception as e:
            print(f"  ❌ Backfill failed: {e}")
            import traceback
            traceback.print_exc()

    thread = threading.Thread(
        target=run_tracked, args=(mr_iid, run_backfill), daemon=True
    )
    thread.start()

    return jsonify({
        "success": True,
        "message": f"Backfill started for MR !{mr_iid}. Check terminal for progress.",
    }), 202


# ── Start server ──────────────────────────────────────────────────

def start_server(port: int = None, debug: bool = False, host: str = "127.0.0.1"):
    """
    Start the Flask server. Called from main.py.

    Binds to loopback by default. External access is meant to arrive via the
    ngrok tunnel, which connects to localhost — so 0.0.0.0 buys nothing and
    would expose the server to everyone on the local network.
    """
    if port is None:
        port = webhook_port()
    init_db()
    print(f"🌐 Webhook server starting on {host}:{port}...")
    app.run(
        host=host,
        port=port,
        debug=debug,
        use_reloader=False,
    )


if __name__ == "__main__":
    print("🧪 Starting webhook server for testing...\n")
    print(f"  Health:  http://localhost:{webhook_port()}/")
    print(f"  Webhook: http://localhost:{webhook_port()}/webhook")
    print(f"  Test:    http://localhost:{webhook_port()}/webhook/test\n")
    start_server(port=webhook_port(), debug=True)