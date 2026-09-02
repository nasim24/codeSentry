import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const ROLES: Record<number, string> = {
  5: "Minimal", 10: "Guest", 20: "Reporter",
  30: "Developer", 40: "Maintainer", 50: "Owner",
};

/** Minimum role that can read MRs on a private project. */
const MIN_ROLE = 20;

interface TestResult {
  ok:      boolean;
  level:   "ok" | "warn" | "error";
  message: string;
}

async function withTimeout<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the GitLab URL, that the token authenticates, AND that its project
 * role is high enough to read MRs.
 *
 * The last check matters: an 'api'-scoped token held by a Guest on a private
 * project authenticates perfectly against /user, then 403s on every merge
 * request call. Testing only /user would report a false success.
 */
async function testGitlab(): Promise<TestResult> {
  const url       = getSetting("GITLAB_URL").replace(/\/+$/, "");
  const token     = getSetting("GITLAB_TOKEN");
  const projectId = getSetting("GITLAB_PROJECT_ID");

  if (!url)       return { ok: false, level: "error", message: "No GitLab URL set" };
  if (!token)     return { ok: false, level: "error", message: "No access token set" };
  if (!projectId) return { ok: false, level: "error", message: "No project ID set" };

  const headers = { "PRIVATE-TOKEN": token };

  // 1. Does the token authenticate at all?
  let user: { id?: number; username?: string } = {};
  try {
    const res = await withTimeout(6000, (signal) =>
      fetch(`${url}/api/v4/user`, { headers, signal, cache: "no-store" })
    );
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        level: "error",
        message: `Token rejected (HTTP ${res.status}) — expired or revoked. GitLab answered, so this is not a network problem.`,
      };
    }
    if (!res.ok) {
      return { ok: false, level: "error", message: `GitLab returned HTTP ${res.status}` };
    }
    user = await res.json();
  } catch {
    return {
      ok: false,
      level: "error",
      message: `Cannot reach ${url} — check the URL, your network, or VPN`,
    };
  }

  // 2. Can it actually read merge requests?
  try {
    const res = await withTimeout(6000, (signal) =>
      fetch(`${url}/api/v4/projects/${projectId}/merge_requests?per_page=1`, {
        headers, signal, cache: "no-store",
      })
    );

    if (res.status === 403) {
      let roleNote = " Check the token's role on this project.";
      if (user?.id) {
        try {
          const m = await withTimeout(5000, (signal) =>
            fetch(`${url}/api/v4/projects/${projectId}/members/all/${user.id}`, {
              headers, signal, cache: "no-store",
            })
          );
          if (m.ok) {
            const member = await m.json();
            const level  = member?.access_level as number | undefined;
            if (level !== undefined && level < MIN_ROLE) {
              roleNote = ` The token's role is ${ROLES[level] ?? level} — it needs Reporter or higher (Developer to post comments).`;
            }
          }
        } catch {
          // Role lookup is best-effort; the 403 is the real finding.
        }
      }
      return {
        ok: false,
        level: "error",
        message: `Token authenticates but cannot read merge requests (403).${roleNote}`,
      };
    }

    if (res.status === 404) {
      return {
        ok: false,
        level: "error",
        message: `Project ${projectId} not found, or this token cannot see it`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        level: "error",
        message: `Merge request check returned HTTP ${res.status}`,
      };
    }
  } catch {
    return { ok: false, level: "error", message: "Merge request check timed out" };
  }

  return {
    ok: true,
    level: "ok",
    message: `Connected as @${user?.username ?? "?"} — can read MRs on project ${projectId}`,
  };
}

/** Verify Ollama is up and the configured model is actually installed. */
async function testOllama(): Promise<TestResult> {
  const url   = getSetting("OLLAMA_URL").replace(/\/+$/, "");
  const model = getSetting("OLLAMA_MODEL");

  if (!url) return { ok: false, level: "error", message: "No Ollama URL set" };

  let models: string[] = [];
  try {
    const res = await withTimeout(5000, (signal) =>
      fetch(`${url}/api/tags`, { signal, cache: "no-store" })
    );
    if (!res.ok) {
      return { ok: false, level: "error", message: `Ollama returned HTTP ${res.status}` };
    }
    const data = await res.json();
    models = (data?.models ?? []).map((m: { name: string }) => m.name);
  } catch {
    return {
      ok: false,
      level: "error",
      message: `Cannot reach Ollama at ${url} — is "ollama serve" running?`,
    };
  }

  const installed = models.slice(0, 6).join(", ") || "none";

  if (!model) {
    return {
      ok: false,
      level: "warn",
      message: `Ollama is up but no model is selected. Installed: ${installed}`,
    };
  }

  if (!models.includes(model)) {
    return {
      ok: false,
      level: "warn",
      message: `Model "${model}" is not installed. Run "ollama pull ${model}", or pick one of: ${installed}`,
    };
  }

  return { ok: true, level: "ok", message: `Ollama up — model "${model}" is installed` };
}

/** Is the local Flask server running? */
async function testWebhookServer(): Promise<TestResult> {
  const port = getSetting("WEBHOOK_PORT") || "8001";
  try {
    const res = await withTimeout(2500, (signal) =>
      fetch(`http://localhost:${port}/`, { signal, cache: "no-store" })
    );
    if (!res.ok) {
      return {
        ok: false,
        level: "error",
        message: `Server on port ${port} returned HTTP ${res.status}`,
      };
    }
    return { ok: true, level: "ok", message: `Webhook server responding on port ${port}` };
  } catch {
    return {
      ok: false,
      level: "warn",
      message: `No server on port ${port} — start it with "python main.py"`,
    };
  }
}

export async function POST(req: Request) {
  try {
    const body   = await req.json().catch(() => ({}));
    const target = body?.target ?? "all";

    if (target === "gitlab") return NextResponse.json({ gitlab: await testGitlab() });
    if (target === "ollama") return NextResponse.json({ ollama: await testOllama() });
    if (target === "server") return NextResponse.json({ server: await testWebhookServer() });

    const [gitlab, ollama, server] = await Promise.all([
      testGitlab(),
      testOllama(),
      testWebhookServer(),
    ]);
    return NextResponse.json({ gitlab, ollama, server });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
