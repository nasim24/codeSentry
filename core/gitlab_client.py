import requests

from core import settings


# Config is resolved per call, never cached at import time.
# Caching it here is what made a token changed in the UI (or in .env)
# get ignored until the whole process was restarted.

def gitlab_url() -> str:
    return settings.get("GITLAB_URL").rstrip("/")


def project_id() -> str:
    return settings.get("GITLAB_PROJECT_ID")


def headers() -> dict:
    return {
        "PRIVATE-TOKEN": settings.get("GITLAB_TOKEN"),
        "Content-Type":  "application/json",
    }


def base() -> str:
    return f"{gitlab_url()}/api/v4/projects/{project_id()}"


# ── MRs ───────────────────────────────────────────────────────

def get_open_mrs() -> list:
    """Fetch all currently open merge requests."""
    response = requests.get(
        f"{base()}/merge_requests",
        headers=headers(),
        params={"state": "opened", "per_page": 50},
    )
    response.raise_for_status()
    return response.json()


def get_all_mrs(state: str = "all") -> list:
    """Fetch MRs by state: opened / closed / merged / all."""
    response = requests.get(
        f"{base()}/merge_requests",
        headers=headers(),
        params={"state": state, "per_page": 50},
    )
    response.raise_for_status()
    return response.json()


def get_mr_detail(mr_iid: int) -> dict:
    """Get full detail of a single MR."""
    response = requests.get(
        f"{base()}/merge_requests/{mr_iid}",
        headers=headers(),
    )
    response.raise_for_status()
    return response.json()


# ── Diffs ─────────────────────────────────────────────────────

def get_mr_diff(mr_iid: int) -> dict:
    """
    Fetch the full diff for a MR.
    Returns diff_refs (shas) + list of file diffs.
    """
    # Get diff refs (base, head, start sha) from MR detail
    mr = get_mr_detail(mr_iid)
    diff_refs = mr.get("diff_refs", {})

    # Get the actual file diffs
    response = requests.get(
        f"{base()}/merge_requests/{mr_iid}/diffs",
        headers=headers(),
        params={"per_page": 100},
    )
    response.raise_for_status()

    return {
        "diff_refs": diff_refs,
        "description": mr.get("description", ""),
        "diffs": response.json(),
    }


# ── Comments ──────────────────────────────────────────────────

def post_comment(mr_iid: int, body: str) -> dict:
    """Post a general comment on a MR."""
    response = requests.post(
        f"{base()}/merge_requests/{mr_iid}/notes",
        headers=headers(),
        json={"body": body},
    )
    response.raise_for_status()
    return response.json()


# ── Webhooks ──────────────────────────────────────────────────

def get_webhooks() -> list:
    """List all webhooks registered on this project."""
    response = requests.get(
        f"{base()}/hooks",
        headers=headers(),
    )
    response.raise_for_status()
    return response.json()


def create_webhook(url: str, secret: str) -> dict:
    """Register a new webhook for MR events."""
    response = requests.post(
        f"{base()}/hooks",
        headers=headers(),
        json={
            "url": url,
            "merge_requests_events": True,
            "push_events": False,
            "enable_ssl_verification": False,
            "token": secret,
        },
    )
    response.raise_for_status()
    return response.json()


def update_webhook(hook_id: int, url: str, secret: str) -> dict:
    """Update an existing webhook URL (needed when ngrok restarts)."""
    response = requests.put(
        f"{base()}/hooks/{hook_id}",
        headers=headers(),
        json={
            "url": url,
            "merge_requests_events": True,
            "push_events": False,
            "enable_ssl_verification": False,
            "token": secret,
        },
    )
    response.raise_for_status()
    return response.json()


def delete_webhook(hook_id: int):
    """Remove a webhook."""
    requests.delete(
        f"{base()}/hooks/{hook_id}",
        headers=headers(),
    )


# get all commits for active MR
def get_mr_commits(mr_iid: int) -> list:
    """Fetch all commits for a Merge Request."""
    response = requests.get(
        f"{base()}/merge_requests/{mr_iid}/commits",
        headers=headers(),
        params={"per_page": 100},
    )
    response.raise_for_status()
    return response.json()

# ── Test ──────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🔍 Fetching open MRs from GitLab...\n")

    mrs = get_open_mrs()

    if not mrs:
        print("No open MRs found right now.")
    else:
        print(f"Found {len(mrs)} open MR(s):\n")
        for mr in mrs:
            print(f"  MR !{mr['iid']}  |  {mr['title']}")
            print(f"         by @{mr['author']['username']}")
            print(f"         {mr['source_branch']} → {mr['target_branch']}")
            print(f"         {mr['web_url']}\n")