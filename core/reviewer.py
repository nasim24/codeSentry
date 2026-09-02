import os
import json
import requests

from core import settings
from dotenv import load_dotenv
from core.rules_loader import (
    load_rules, should_skip_file,
    get_file_priority, build_custom_rules_prompt,
    ProjectRules,
)

load_dotenv()

# Resolved per call so a model changed in the UI applies immediately.
def ollama_url() -> str:
    return settings.get("OLLAMA_URL")


def ollama_model() -> str:
    return settings.get("OLLAMA_MODEL")

# Load project rules once at startup
RULES = load_rules()

# Pull settings from rules file
MAX_FILES     = RULES.settings.get("max_files_per_review", 50)
CHUNK_SIZE    = RULES.settings.get("chunk_size", 8)
CHUNK_TIMEOUT = RULES.settings.get("chunk_timeout", 300)
MAX_ISSUES    = RULES.settings.get("max_issues_per_file", 5)


# ── File filtering ────────────────────────────────────────────────

def filter_and_prioritize(diffs: list) -> list:
    """
    Filter files using rules from review-rules.yaml.
    Prioritize by: custom priority > file size > normal
    """
    filtered = []

    for diff in diffs:
        filepath = diff.get("new_path") or diff.get("old_path") or ""

        # Skip using rules file
        if should_skip_file(filepath, RULES):
            continue

        # Skip if no actual diff content
        if not diff.get("diff", "").strip():
            continue

        # Skip if only whitespace changed
        diff_lines = diff.get("diff", "").split("\n")
        added = [l for l in diff_lines if l.startswith("+") and l.strip() not in ["+", ""]]
        if not added:
            continue

        priority = get_file_priority(filepath, RULES)

        filtered.append({
            **diff,
            "_priority":  priority,
            "_filepath":  filepath,
            "_diff_size": len(diff.get("diff", "")),
        })

    # Sort: highest priority first, then largest diff first
    filtered.sort(key=lambda x: (-x["_priority"], -x["_diff_size"]))

    total    = len(filtered)
    filtered = filtered[:MAX_FILES]

    if total > MAX_FILES:
        print(f"  📋 {total} reviewable files — reviewing top {MAX_FILES} by priority")
    else:
        print(f"  📋 {total} reviewable files found")

    return filtered


# ── System prompt ─────────────────────────────────────────────────

def build_system_prompt() -> str:
    return f"""You are a senior software engineer performing a thorough code review.
You understand this codebase deeply and review pragmatically — only flagging real problems.

{build_custom_rules_prompt(RULES)}

## LAYER 2 — NextJS 16 / React 19 Best Practices
Check for genuine violations only:
- Missing 'use client' where hooks/events are actually used
- <img> tag instead of next/image for actual images
- useEffect with genuinely missing dependencies (not false positives)
- Missing error handling on async operations that can actually fail
- Missing loading states on user-facing async operations
- Metadata API violations

## LAYER 3 — General Code Quality
Only flag REAL problems:
- Security vulnerabilities (XSS, exposed secrets, SQL injection)
- Genuine logic errors that will cause bugs
- console.log statements left in production code
- Unhandled promise rejections that will silently fail

## RESPONSE FORMAT
You MUST respond with valid JSON only. No text before or after. No markdown fences.

{{
  "score": 85,
  "summary": "2-3 sentence honest assessment of this code change",
  "comments": [
    {{
      "file": "src/modules/orders/pages/OrderList.tsx",
      "line": 42,
      "severity": "critical",
      "category": "architecture",
      "rule_id": "use-axios-instance",
      "message": "Direct fetch() call violates API layer rules. Use @/lib/api.ts instead.",
      "suggestion": "import api from '@/lib/api';"
    }}
  ]
}}

## SCORING
- 90-100: Excellent — minor or no issues
- 70-89:  Good — some improvements needed
- 50-69:  Needs work — significant issues found
- 0-49:   Poor — critical issues must be fixed before merge

## STRICT RULES FOR YOU
- Max {MAX_ISSUES} issues per chunk — pick the most important ones
- Do NOT flag things in the ignore list
- Do NOT flag issues already handled by TypeScript/ESLint/Prettier
- Do NOT flag stylistic preferences
- DO flag actual violations of the project rules above
- Be specific — reference exact file and line number
- JSON only — no other text"""


# ── Prompt builder ────────────────────────────────────────────────

def build_chunk_prompt(
    files: list,
    context: dict,
    chunk_num: int,
    total_chunks: int,
) -> str:
    diffs_text = ""

    for f in files:
        filepath     = f.get("new_path", "unknown")
        diff_content = f.get("diff", "")

        if len(diff_content) > 6000:
            diff_content = diff_content[:6000] + "\n[... truncated ...]"

        diffs_text += f"\n### File: {filepath}\n```diff\n{diff_content}\n```\n"

    return f"""Review chunk {chunk_num}/{total_chunks} of this merge request.

MR Title: {context['title']}
Author: @{context['author']}
Branch: {context['source_branch']} → {context['target_branch']}

## Changed Files In This Chunk:
{diffs_text}

Apply all project rules from the system prompt.
Return JSON only."""


# ── Ollama call ───────────────────────────────────────────────────

def call_ollama(user_prompt: str, timeout: int = CHUNK_TIMEOUT) -> str:
    try:
        response = requests.post(
            f"{ollama_url()}/api/chat",
            json={
                "model":  ollama_model(),
                "stream": False,
                "messages": [
                    {"role": "system", "content": build_system_prompt()},
                    {"role": "user",   "content": user_prompt},
                ],
                "options": {
                    "temperature": 1.0,
                    "top_p":       0.95,
                    "top_k":       64,
                    "num_predict": 2048,
                },
            },
            timeout=timeout,
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    except requests.exceptions.ConnectionError:
        raise RuntimeError(f"❌ Cannot connect to Ollama at {ollama_url()}")
    except requests.exceptions.Timeout:
        raise RuntimeError(f"❌ Ollama timed out after {timeout}s")
    except KeyError:
        raise RuntimeError(f"❌ Unexpected response: {response.json()}")


# ── JSON parser ───────────────────────────────────────────────────

def parse_json(raw: str) -> dict | None:
    clean = raw.strip()

    # Remove thinking blocks
    if "<|channel>" in clean:
        parts = clean.split("<channel|>")
        clean = parts[-1].strip() if len(parts) > 1 else clean

    # Strip markdown fences
    if "```json" in clean:
        clean = clean.split("```json")[1].split("```")[0]
    elif "```" in clean:
        clean = clean.split("```")[1].split("```")[0]

    # Find JSON object
    start = clean.find("{")
    end   = clean.rfind("}") + 1
    if start == -1 or end <= start:
        return None

    try:
        result        = json.loads(clean[start:end].strip())
        result["score"] = max(0, min(100, int(result.get("score", 70))))
        return result
    except json.JSONDecodeError as e:
        print(f"    ⚠️  JSON parse error: {e}")
        return None


# ── Noise filter ──────────────────────────────────────────────────

def filter_noise(comments: list) -> list:
    """Remove false positives using ignore patterns from rules."""
    ignore = [p.lower() for p in RULES.ignore_patterns]
    clean  = []

    for comment in comments:
        message = comment.get("message", "").lower()
        flagged = any(pattern in message for pattern in ignore)
        if not flagged:
            clean.append(comment)

    removed = len(comments) - len(clean)
    if removed > 0:
        print(f"    🔇 Filtered {removed} noise issue(s)")

    return clean


# ── Chunk reviewer ────────────────────────────────────────────────

def review_chunk(
    files: list,
    context: dict,
    chunk_num: int,
    total_chunks: int,
) -> dict:
    prompt = build_chunk_prompt(files, context, chunk_num, total_chunks)
    raw    = call_ollama(prompt)
    result = parse_json(raw)

    if not result:
        print(f"    ⚠️  Chunk {chunk_num} — parse failed, skipping")
        return {"score": 70, "comments": []}

    # Filter noise
    comments = filter_noise(result.get("comments", []))

    return {
        "score":    result.get("score", 70),
        "comments": comments,
    }


# ── Merge results ─────────────────────────────────────────────────

def merge_results(chunks: list) -> dict:
    all_comments = []
    scores       = []

    for chunk in chunks:
        all_comments.extend(chunk.get("comments", []))
        if chunk.get("score"):
            scores.append(chunk["score"])

    final_score = int(sum(scores) / len(scores)) if scores else 70

    # Sort by severity
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    all_comments.sort(key=lambda x: order.get(x.get("severity", "low"), 3))

    # Build summary
    critical = sum(1 for c in all_comments if c.get("severity") == "critical")
    high     = sum(1 for c in all_comments if c.get("severity") == "high")

    if critical > 0:
        summary = f"Found {critical} critical violation(s) of project rules that must be fixed before merging."
    elif high > 0:
        summary = f"No critical issues but {high} high severity issue(s) need attention before merging."
    elif all_comments:
        summary = f"Code quality is acceptable with {len(all_comments)} minor issue(s) to consider."
    else:
        summary = "No significant issues found. Code follows project rules and looks good to merge."

    return {
        "summary":  summary,
        "score":    final_score,
        "comments": all_comments,
    }


# ── Main review function ──────────────────────────────────────────

def review_mr(mr_data: dict, diff_data: dict) -> dict:
    print(f"\n  🔍 Filtering files using project rules...")
    filtered = filter_and_prioritize(diff_data["diffs"])

    if not filtered:
        return {
            "summary":  "No reviewable files found after filtering.",
            "score":    100,
            "comments": [],
        }

    chunks       = [filtered[i:i + CHUNK_SIZE] for i in range(0, len(filtered), CHUNK_SIZE)]
    total_chunks = len(chunks)

    print(f"  🔀 {total_chunks} chunk(s) of up to {CHUNK_SIZE} files each\n")

    context = {
        "title":         mr_data["title"],
        "author":        mr_data["author"]["username"],
        "source_branch": mr_data["source_branch"],
        "target_branch": mr_data["target_branch"],
    }

    chunk_results = []

    for i, chunk in enumerate(chunks, 1):
        names = [f.get("new_path", "?") for f in chunk]
        print(f"  📦 Chunk {i}/{total_chunks}")
        for name in names:
            print(f"     · {name}")

        try:
            result = review_chunk(chunk, context, i, total_chunks)
            chunk_results.append(result)
            issues = len(result.get("comments", []))
            print(f"     ✅ score: {result['score']} | real issues: {issues}\n")
        except RuntimeError as e:
            print(f"     ❌ {e}\n")
            continue

    if not chunk_results:
        return {
            "summary":  "Review failed — all chunks timed out.",
            "score":    50,
            "comments": [],
        }

    return merge_results(chunk_results)


# ── Format GitLab comment ─────────────────────────────────────────

def format_comment(result: dict) -> str:
    score    = result["score"]
    emoji    = "🟢" if score >= 90 else "🟡" if score >= 70 else "🟠" if score >= 50 else "🔴"
    comments = result.get("comments", [])

    critical = sum(1 for c in comments if c.get("severity") == "critical")
    high     = sum(1 for c in comments if c.get("severity") == "high")
    medium   = sum(1 for c in comments if c.get("severity") == "medium")
    low      = sum(1 for c in comments if c.get("severity") == "low")

    lines = [
        f"## {emoji} Code Review — Score: {score}/100",
        "",
        result["summary"],
        "",
        "| Severity | Count |",
        "|----------|-------|",
        f"| 🔴 Critical | {critical} |",
        f"| 🟠 High     | {high} |",
        f"| 🟡 Medium   | {medium} |",
        f"| 🔵 Low      | {low} |",
    ]

    if comments:
        lines += ["", "### Issues Found", ""]
        for c in comments:
            sev_emoji = {
                "critical": "🔴", "high": "🟠",
                "medium":   "🟡", "low": "🔵",
            }.get(c.get("severity", "low"), "🔵")

            lines.append(
                f"**{sev_emoji} {c.get('severity','low').upper()}** — "
                f"`{c.get('file','?')}` line {c.get('line','?')}"
            )
            lines.append(f"> {c.get('message', '')}")
            if c.get("suggestion"):
                lines.append(f"```\n{c['suggestion']}\n```")
            lines.append("")

    return "\n".join(lines)


# ── Test ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from core.gitlab_client import get_open_mrs, get_mr_diff

    print(f"📋 Rules loaded: {RULES.project_name}")
    print(f"   {len(RULES.custom_rules)} custom rules")
    print(f"   {len(RULES.ignore_patterns)} noise filters\n")

    print(f"🔍 Checking Ollama...")
    try:
        res    = requests.get(f"{ollama_url()}/api/tags", timeout=5)
        models = [m["name"] for m in res.json().get("models", [])]
        print(f"✅ Ollama running. Models: {models}\n")
    except Exception:
        print("❌ Ollama not reachable. Run: ollama serve")
        exit()

    mrs = get_open_mrs()
    if not mrs:
        print("No open MRs found.")
        exit()

    mr = mrs[0]
    print(f"🤖 Reviewing MR !{mr['iid']} — {mr['title']}")
    print(f"   Author: @{mr['author']['username']}\n")

    diff_data = get_mr_diff(mr["iid"])
    result    = review_mr(mr, diff_data)

    print("\n── Final Result ─────────────────────────")
    print(f"Score:   {result['score']}/100")
    print(f"Summary: {result['summary']}")
    print(f"Issues:  {len(result.get('comments', []))}\n")

    for issue in result.get("comments", []):
        print(f"  [{issue.get('severity','?').upper()}] {issue.get('file','?')} line {issue.get('line','?')}")
        print(f"  Rule: {issue.get('rule_id', 'general')}")
        print(f"  → {issue.get('message','')}\n")

    print("\n── GitLab Comment Preview ───────────────")
    print(format_comment(result))