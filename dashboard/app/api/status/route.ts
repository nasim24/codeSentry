import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

type GitlabState = "ok" | "bad_token" | "unreachable" | "error";

const TOKENS_PATH = "/-/user_settings/personal_access_tokens";

async function checkGitlab(): Promise<{ state: GitlabState; detail: string }> {
  const gitlabUrl = getSetting("GITLAB_URL").replace(/\/+$/, "");
  const token     = getSetting("GITLAB_TOKEN");

  if (!token) {
    return { state: "bad_token", detail: "GITLAB_TOKEN is not set in .env" };
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 3000);
    try {
      res = await fetch(`${gitlabUrl}/api/v4/user`, {
        headers: { "PRIVATE-TOKEN": token },
        signal:  controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Never got a reply — network path is the problem.
    return {
      state:  "unreachable",
      detail: `Cannot reach ${gitlabUrl} — check VPN / network`,
    };
  }

  // GitLab answered, so the network is fine — only the credential is not.
  if (res.status === 401 || res.status === 403) {
    return {
      state:  "bad_token",
      detail: `GitLab rejected GITLAB_TOKEN (HTTP ${res.status}) — the token is expired or revoked`,
    };
  }

  if (!res.ok) {
    return {
      state:  "error",
      detail: `GitLab returned HTTP ${res.status}`,
    };
  }

  return { state: "ok", detail: "" };
}

export async function GET() {
  const port      = getSetting("WEBHOOK_PORT") || "8001";
  const gitlabUrl = getSetting("GITLAB_URL").replace(/\/+$/, "");

  // Check 1 — Flask server
  let flaskOk = false;
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`http://localhost:${port}/`, {
        signal: controller.signal,
      });
      flaskOk = res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    flaskOk = false;
  }

  // Check 2 — GitLab: reachable, and does it accept our token?
  const gitlab = await checkGitlab();

  if (!flaskOk) {
    return NextResponse.json({
      status:  "offline",
      message: "Webhook server not running",
      flask:   false,
      gitlab:  false,
    });
  }

  if (gitlab.state === "bad_token") {
    return NextResponse.json({
      status:   "bad_token",
      message:  `Server running — ${gitlab.detail}`,
      flask:    true,
      gitlab:   false,
      tokenUrl: gitlabUrl ? `${gitlabUrl}${TOKENS_PATH}` : "",
    });
  }

  if (gitlab.state === "unreachable") {
    return NextResponse.json({
      status:  "no_gitlab",
      message: `Server running — ${gitlab.detail}`,
      flask:   true,
      gitlab:  false,
    });
  }

  if (gitlab.state === "error") {
    return NextResponse.json({
      status:  "gitlab_error",
      message: `Server running — ${gitlab.detail}`,
      flask:   true,
      gitlab:  false,
    });
  }

  return NextResponse.json({
    status:  "connected",
    message: "All systems operational",
    flask:   true,
    gitlab:  true,
  });
}
