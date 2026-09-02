# CodeSentryAI

**AI code review for GitLab merge requests, running entirely on your own machine.**

Every merge request gets reviewed by a local LLM. Findings land in a dashboard
where you edit severities, drop the false positives, add a note, and post a
single clean comment to GitLab — or don't post at all.

No code leaves your network. No API keys to a model vendor. Works with
self-hosted GitLab behind a VPN.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

---

## Why this exists

Most AI review tools assume GitHub and a cloud model API. If your code lives on
self-hosted GitLab and legally cannot be sent to a third party, none of them
work. CodeSentryAI runs the model locally through [Ollama](https://ollama.com)
and talks to GitLab over your own network.

It is also deliberately **review-assist, not auto-comment**. The AI proposes;
you decide what gets posted. An AI that comments directly on every MR trains
your team to ignore it.

---

## How it works

```
GitLab MR pushed
      │
      ├── webhook ──────▶  Flask server  ──┐
      │                                     ├──▶  Ollama (local LLM)  ──▶  SQLite
      └── polling (5 min) ─────────────────┘                                  │
                                                                              ▼
                                                            Next.js dashboard (localhost:3000)
                                                                              │
                                                          you edit + approve  ▼
                                                                    one comment ──▶ GitLab
```

Reviews are stored per commit, so an MR accumulates a full review history
rather than one overwritten verdict.

---

## Requirements

| | |
|---|---|
| Python | 3.11+ (3.13 tested) |
| Node | 20+ |
| [Ollama](https://ollama.com) | running locally with a code-capable model |
| GitLab | self-hosted or gitlab.com |
| GitLab token | `api` scope **and** at least the **Developer** role on the project |

> **The token role trips everyone up.** Scope and role are separate permission
> axes in GitLab. A token with full `api` scope held by a *Guest* authenticates
> perfectly against `/api/v4/user`, then returns `403` on every merge request
> call. If reviews fail with 403, check the role, not the scope.

---

## Setup

```bash
git clone https://github.com/<you>/codesentryai.git
cd codesentryai

# 1. Python side
pip install -r requirements.txt

# 2. Pull a model (any code-capable model works)
ollama pull qwen2.5-coder:14b

# 3. Dashboard
cd dashboard && npm install && cd ..

# 4. Start both
python main.py                     # terminal 1
cd dashboard && npm run dev        # terminal 2
```

Then open **<http://localhost:3000/settings>** and fill in your GitLab URL,
token, project ID and model. Hit **Test connections** — it verifies the token
authenticates *and* that its role can actually read merge requests.

That's it. No file editing required.

<details>
<summary>Prefer configuring by file?</summary>

Copy `.env.example` to `.env` and fill it in. Values saved in the UI take
precedence over `.env`; `.env` takes precedence over built-in defaults.
Nothing ever writes back to your `.env`.

</details>

### Optional: real-time webhooks

Polling every 5 minutes needs no setup. For instant reviews, GitLab must be
able to reach your machine:

1. Add an [ngrok](https://ngrok.com) auth token in Settings → Webhook
2. Restart `python main.py` and copy the printed tunnel URL
3. In GitLab: Project → Settings → Webhooks
   - URL: `<tunnel-url>/webhook`
   - Secret token: copy from Settings → Webhook secret
   - Trigger: **Merge request events**

On the ngrok free tier the URL changes on every restart, so this step repeats.

---

## Project-specific rules

Generic AI review produces generic advice. The value comes from teaching it
*your* conventions.

```bash
cp review-rules.example.yaml review-rules.yaml
```

Then edit it. Rules are checked before any general analysis, so violations of
your architecture rank above style opinions:

```yaml
custom_rules:
  - id: "use-http-client"
    severity: "high"
    description: "Use the shared HTTP client instead of raw fetch()"
    detect: ["fetch('", 'fetch("']
    exception: "lib/http.ts"
    message: >
      Raw fetch() bypasses shared auth headers and error normalisation.
      Use the client in lib/http.ts instead.
```

`review-rules.yaml` is gitignored — your conventions stay out of the repo.

The `ignore:` list matters as much as the rules. Anything Prettier or ESLint
already enforces belongs there; a review that nitpicks semicolons gets ignored,
and the real findings get ignored with it.

---

## Security

**The dashboard has no authentication.** It holds your GitLab token and, if you
enable digests, an email password. Both servers bind to `127.0.0.1` only.

- Do not expose port 3000 or 8001 to a network or the internet
- Do not put the dashboard behind a plain reverse proxy without adding auth
- Only the `/webhook` endpoint is meant to be publicly reachable, via the ngrok
  tunnel, and it verifies GitLab's secret token
- The `/review` and `/backfill` trigger routes require a shared secret. This is
  not paranoia: ngrok forwards to `localhost`, so `remote_addr` is `127.0.0.1`
  even for public traffic — a loopback check would protect nothing

A webhook secret is generated automatically on first run, so no install is ever
left unprotected because a config step was skipped.

---

## Configuration reference

Every value is settable in the UI or via `.env`.

| Key | Default | Purpose |
|---|---|---|
| `GITLAB_URL` | — | Your GitLab base URL |
| `GITLAB_TOKEN` | — | `api` scope + Developer role |
| `GITLAB_PROJECT_ID` | — | Numeric project ID |
| `OLLAMA_URL` | `http://localhost:11434` | Where Ollama listens |
| `OLLAMA_MODEL` | — | Must be installed (`ollama list`) |
| `WEBHOOK_PORT` | `8001` | Local Flask port |
| `WEBHOOK_SECRET` | auto-generated | Shared with GitLab's webhook config |
| `NGROK_AUTHTOKEN` | — | Optional, for public webhooks |
| `POLL_INTERVAL` | `300` | Seconds between GitLab polls |
| `GOOGLE_CHAT_WEBHOOK` | — | Optional chat notifications |
| `GMAIL_FROM` / `GMAIL_APP_PASSWORD` / `GMAIL_TO` | — | Optional morning digest |
| `DIGEST_TIME` | `09:00` | When to send the digest |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `403 Forbidden` on merge requests | Token role too low. Needs Reporter to read, Developer to comment. Scope is not the problem. |
| `401 Unauthorized` | Token expired or revoked. Settings → Test connections tells you which. |
| Dashboard shows "GitLab unreachable" | Genuine network/VPN failure. A rejected token reports separately as "token expired". |
| Reviews stop after changing a token | They shouldn't — config is read per call. If it persists, open an issue. |
| `ERR_NGROK_334` | A previous tunnel is still alive: `taskkill /F /IM ngrok.exe` (Windows) or `pkill ngrok`. |
| Model not found | `ollama pull <model>`, or pick an installed one in Settings. |

---

## Project layout

```
core/
  settings.py        three-tier config: DB → .env → default
  database.py        SQLite schema and queries
  gitlab_client.py   GitLab API calls
  reviewer.py        chunking, filtering, Ollama calls
  rules_loader.py    parses review-rules.yaml into prompts
  notifier.py        Google Chat notifications
  digest.py          morning email digest
  ngrok_manager.py   tunnel lifecycle
webhook/server.py    Flask: /webhook /review /backfill /reviewing
dashboard/           Next.js app (reads reviewer.db directly)
main.py              entry point — starts everything
```

---

## Contributing

Issues and pull requests welcome. Before submitting:

```bash
python -m compileall -q core webhook main.py
cd dashboard && npx tsc --noEmit
```

Install the pre-commit hook so a secret can never reach a commit:

```bash
pip install pre-commit && pre-commit install
```

---

## License

[AGPL-3.0](LICENSE). You may run, modify and self-host this freely. If you
offer it to others as a hosted service, you must publish your modifications.
