import os
import requests

from core import settings
from dotenv import load_dotenv

load_dotenv()

def chat_webhook() -> str:
    return settings.get("GOOGLE_CHAT_WEBHOOK")


def send_review_notification(mr_data: dict, result: dict) -> bool:
    """
    Send a Google Chat message when an MR review is complete.
    Returns True if sent successfully.
    """
    if not chat_webhook():
        print("  ⚠️  chat_webhook() not set — skipping notification")
        return False

    score    = result.get("score", 0)
    summary  = result.get("summary", "")
    comments = result.get("comments", [])

    critical = sum(1 for c in comments if c.get("severity") == "critical")
    high     = sum(1 for c in comments if c.get("severity") == "high")
    medium   = sum(1 for c in comments if c.get("severity") == "medium")
    low      = sum(1 for c in comments if c.get("severity") == "low")

    mr_iid   = mr_data.get("iid", "?")
    title    = mr_data.get("title", "Unknown")
    author   = mr_data.get("author", {})
    username = author.get("username", "unknown") if isinstance(author, dict) else str(author)
    mr_url   = mr_data.get("web_url", mr_data.get("mr_url", ""))

    # Score emoji
    if score >= 90:
        score_emoji = "🟢"
        status_text = "Looks good to merge"
    elif score >= 70:
        score_emoji = "🟡"
        status_text = "Minor issues to review"
    elif score >= 50:
        score_emoji = "🟠"
        status_text = "Needs attention before merging"
    else:
        score_emoji = "🔴"
        status_text = "Significant issues — review required"

    # Dashboard link
    dashboard_url = f"http://localhost:3000/mr/{mr_iid}"

    # Build Google Chat card message
    message = {
        "cards": [
            {
                "header": {
                    "title": f"{score_emoji} Code Review Complete — MR !{mr_iid}",
                    "subtitle": title,
                    "imageUrl": "https://fonts.gstatic.com/s/i/googlematerialicons/code/v6/24px.svg",
                    "imageStyle": "AVATAR",
                },
                "sections": [
                    {
                        "widgets": [
                            {
                                "keyValue": {
                                    "topLabel": "Author",
                                    "content": f"@{username}",
                                    "icon": "PERSON",
                                }
                            },
                            {
                                "keyValue": {
                                    "topLabel": "Score",
                                    "content": f"{score}/100 — {status_text}",
                                    "icon": "STAR",
                                }
                            },
                            {
                                "keyValue": {
                                    "topLabel": "Issues Found",
                                    "content": f"🔴 {critical} Critical  🟠 {high} High  🟡 {medium} Medium  🔵 {low} Low",
                                    "icon": "DESCRIPTION",
                                }
                            },
                        ]
                    },
                    {
                        "widgets": [
                            {
                                "textParagraph": {
                                    "text": f"<i>{summary}</i>"
                                }
                            }
                        ]
                    },
                    {
                        "widgets": [
                            {
                                "buttons": [
                                    {
                                        "textButton": {
                                            "text": "View Review Dashboard",
                                            "onClick": {
                                                "openLink": {
                                                    "url": dashboard_url
                                                }
                                            }
                                        }
                                    },
                                    *([{
                                        "textButton": {
                                            "text": "Open on GitLab",
                                            "onClick": {
                                                "openLink": {
                                                    "url": mr_url
                                                }
                                            }
                                        }
                                    }] if mr_url else [])
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    }

    try:
        response = requests.post(
            chat_webhook(),
            json=message,
            timeout=10,
        )

        if response.ok:
            print(f"  📨 Google Chat notification sent for MR !{mr_iid}")
            return True
        else:
            print(f"  ⚠️  Google Chat notification failed: {response.status_code} {response.text}")
            return False

    except Exception as e:
        print(f"  ⚠️  Google Chat notification error: {e}")
        return False


def send_simple_message(text: str) -> bool:
    """Send a plain text message to Google Chat."""
    if not chat_webhook():
        return False

    try:
        response = requests.post(
            chat_webhook(),
            json={"text": text},
            timeout=10,
        )
        return response.ok
    except Exception:
        return False


# ── Test ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🧪 Testing Google Chat notification...\n")

    # Test with fake MR data
    test_mr = {
        "iid":      999,
        "title":    "Test notification from CodeSentryAI",
        "author":   {"username": "example.user"},
        "web_url":  "https://gitlab.example.com/mr/999",
    }

    test_result = {
        "score":    78,
        "summary":  "No critical issues but 2 high severity issues need attention before merging.",
        "comments": [
            {"severity": "high",   "file": "src/components/Test.tsx", "message": "Test issue 1"},
            {"severity": "high",   "file": "src/hooks/useTest.ts",    "message": "Test issue 2"},
            {"severity": "medium", "file": "src/utils/helper.ts",     "message": "Test issue 3"},
        ],
    }

    success = send_review_notification(test_mr, test_result)

    if success:
        print("✅ Check your Google Chat space for the notification!")
    else:
        print("❌ Failed — check chat_webhook() in .env")