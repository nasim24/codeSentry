import time
import requests
from pyngrok import ngrok, conf

from core import settings


# Config is resolved per call, not cached at import — see core/settings.py.

def headers() -> dict:
    return {"PRIVATE-TOKEN": settings.get("GITLAB_TOKEN")}


def base() -> str:
    return (
        f"{settings.get('GITLAB_URL').rstrip('/')}"
        f"/api/v4/projects/{settings.get('GITLAB_PROJECT_ID')}"
    )


# We store the webhook ID here so we can update it on restart
_webhook_id   = None
_public_url   = None
_ngrok_tunnel = None


# ── ngrok ─────────────────────────────────────────────────────

def start_ngrok(port: int = None) -> str:   
    """
    Start ngrok tunnel on given port.
    Returns the public HTTPS URL.
    """
    global _ngrok_tunnel, _public_url

    if port is None:
        port = settings.get_int("WEBHOOK_PORT", 8001)

    # Set auth token
    conf.get_default().auth_token = settings.get("NGROK_AUTHTOKEN")

    # Kill any existing tunnels first
    ngrok.kill()

    print("🚇 Starting ngrok tunnel...")
    _ngrok_tunnel = ngrok.connect(port, "http")
    _public_url   = _ngrok_tunnel.public_url

    # ngrok sometimes gives http — force https
    if _public_url.startswith("http://"):
        _public_url = _public_url.replace("http://", "https://")

    print(f"✅ ngrok tunnel: {_public_url}")
    return _public_url


def stop_ngrok():
    """Stop ngrok tunnel cleanly."""
    global _ngrok_tunnel
    if _ngrok_tunnel:
        ngrok.kill()
        print("🛑 ngrok stopped")


# ── GitLab webhook ────────────────────────────────────────────

def get_existing_webhooks() -> list:
    """Fetch all webhooks registered on the project."""
    response = requests.get(f"{base()}/hooks", headers=headers())
    if response.ok:
        return response.json()
    return []


def find_our_webhook(webhooks: list) -> dict | None:
    """
    Find our webhook by looking for the one with our secret
    or one that points to ngrok URL.
    """
    for hook in webhooks:
        url = hook.get("url", "")
        if "ngrok" in url:
            return hook
    return None


def create_webhook(public_url: str) -> dict:
    """Register a new webhook on GitLab project."""
    webhook_url = f"{public_url}/webhook"

    response = requests.post(
        f"{base()}/hooks",
        headers=headers(),
        json={
            "url":                      webhook_url,
            "merge_requests_events":    True,
            "push_events":              False,
            "enable_ssl_verification":  False,    # ngrok free tier
            "token":                    settings.get("WEBHOOK_SECRET"),
        },
    )

    if response.ok:
        hook = response.json()
        print(f"✅ Webhook created → {webhook_url}")
        return hook
    else:
        print(f"⚠️  Webhook create failed: {response.text}")
        return {}


def update_webhook(hook_id: int, public_url: str) -> dict:
    """Update existing webhook with new ngrok URL."""
    webhook_url = f"{public_url}/webhook"

    response = requests.put(
        f"{base()}/hooks/{hook_id}",
        headers=headers(),
        json={
            "url":                      webhook_url,
            "merge_requests_events":    True,
            "push_events":              False,
            "enable_ssl_verification":  False,
            "token":                    settings.get("WEBHOOK_SECRET"),
        },
    )

    if response.ok:
        print(f"✅ Webhook updated → {webhook_url}")
        return response.json()
    else:
        print(f"⚠️  Webhook update failed: {response.text}")
        return {}


def register_webhook(public_url: str) -> int | None:
    """
    Smart webhook registration:
    - If our webhook exists → update its URL
    - If not → create a new one
    Returns the webhook ID.
    """
    global _webhook_id

    print("🔗 Checking GitLab webhooks...")
    existing = get_existing_webhooks()
    our_hook = find_our_webhook(existing)

    if our_hook:
        hook_id = our_hook["id"]
        print(f"   Found existing webhook (id: {hook_id}) — updating URL...")
        update_webhook(hook_id, public_url)
        _webhook_id = hook_id
    else:
        print("   No existing webhook found — creating new one...")
        hook = create_webhook(public_url)
        _webhook_id = hook.get("id")

    return _webhook_id


# ── Main setup function ───────────────────────────────────────

def setup(port: int = 8000) -> str:
    """
    Full setup:
    1. Start ngrok
    2. Register/update GitLab webhook
    Returns the public URL.
    """
    public_url = start_ngrok(port)

    # Small wait to make sure ngrok is fully ready
    time.sleep(1)

    register_webhook(public_url)

    return public_url


def get_public_url() -> str | None:
    """Get current ngrok public URL."""
    return _public_url


# ── Test ──────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🧪 Testing ngrok manager...\n")

    try:
        public_url = setup(port=8000)

        print(f"\n── Summary ────────────────────────────────")
        print(f"✅ Public URL:    {public_url}")
        print(f"✅ Webhook URL:   {public_url}/webhook")
        print(f"✅ Webhook ID:    {_webhook_id}")
        print(f"\nGitLab will now send MR events to:")
        print(f"  {public_url}/webhook")
        print(f"\nPress Ctrl+C to stop...\n")

        # Keep running so you can verify in GitLab settings
        import time
        while True:
            time.sleep(5)

    except KeyboardInterrupt:
        print("\n🛑 Stopping...")
        stop_ngrok()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        stop_ngrok()