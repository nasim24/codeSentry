import os
import yaml
from dataclasses import dataclass, field
from typing import Optional

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Your own rules live in review-rules.yaml, which is gitignored so project
# conventions never leak into the repo. review-rules.example.yaml ships as a
# starting point and is used automatically until you create your own.
RULES_PATH         = os.path.join(_ROOT, "review-rules.yaml")
EXAMPLE_RULES_PATH = os.path.join(_ROOT, "review-rules.example.yaml")


def _rules_file() -> str:
    """Prefer the user's own rules; fall back to the shipped example."""
    if os.path.exists(RULES_PATH):
        return RULES_PATH
    return EXAMPLE_RULES_PATH


@dataclass
class CustomRule:
    id: str
    severity: str
    category: str
    description: str
    message: str
    detect: list[str] = field(default_factory=list)
    detect_path: Optional[str] = None
    exception: list[str] = field(default_factory=list)
    suggestion: Optional[str] = None


@dataclass
class ProjectRules:
    project_name: str
    project_type: str
    custom_rules: list[CustomRule]
    skip_files: list[str]
    priority_files: list[str]
    normal_files: list[str]
    ignore_patterns: list[str]
    nextjs_rules: dict
    quality_rules: dict
    settings: dict


def load_rules() -> ProjectRules:
    """Load and parse review-rules.yaml"""
    path = _rules_file()

    if not os.path.exists(path):
        print(f"⚠️  No review-rules.yaml found at {RULES_PATH}")
        print("   Using built-in defaults. Copy review-rules.example.yaml")
        print("   to review-rules.yaml to add your own project rules.")
        return _default_rules()

    if path == EXAMPLE_RULES_PATH:
        print("ℹ️  Using review-rules.example.yaml (no review-rules.yaml yet)")

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    # Parse custom rules
    custom_rules = []
    for rule in data.get("custom_rules", []):
        # Normalize exception to list
        exception = rule.get("exception", [])
        if isinstance(exception, str):
            exception = [exception]

        detect = rule.get("detect", [])
        if isinstance(detect, str):
            detect = [detect]

        custom_rules.append(CustomRule(
            id          = rule["id"],
            severity    = rule.get("severity", "medium"),
            category    = rule.get("category", "general"),
            description = rule.get("description", ""),
            message     = rule.get("message", "").strip(),
            detect      = detect,
            detect_path = rule.get("detect_path"),
            exception   = exception,
            suggestion  = rule.get("suggestion", "").strip() if rule.get("suggestion") else None,
        ))

    files    = data.get("files", {})
    settings = data.get("settings", {})

    return ProjectRules(
        project_name   = data.get("project", {}).get("name", "Unknown"),
        project_type   = data.get("project", {}).get("type", "nextjs"),
        custom_rules   = custom_rules,
        skip_files     = files.get("skip", []),
        priority_files = files.get("priority", []),
        normal_files   = files.get("normal", []),
        ignore_patterns = data.get("ignore", []),
        nextjs_rules   = data.get("nextjs_rules", {}),
        quality_rules  = data.get("quality_rules", {}),
        settings       = settings,
    )


def should_skip_file(filepath: str, rules: ProjectRules) -> bool:
    """Check if file should be skipped based on rules."""
    import fnmatch
    for pattern in rules.skip_files:
        # Remove ** prefix for simple matching
        clean = pattern.replace("**/", "").replace("**", "")
        if clean and (clean in filepath or fnmatch.fnmatch(filepath, pattern)):
            return True
    return False


def get_file_priority(filepath: str, rules: ProjectRules) -> int:
    """
    Returns priority score:
    3 = highest priority (review first)
    2 = normal priority
    1 = low priority
    """
    import fnmatch

    for pattern in rules.priority_files:
        clean = pattern.replace("**/", "").replace("**", "").replace("*", "")
        if clean and clean in filepath:
            return 3

    for pattern in rules.normal_files:
        clean = pattern.replace("**/", "").replace("**", "").replace("*", "")
        if clean and clean in filepath:
            return 2

    return 1


def build_custom_rules_prompt(rules: ProjectRules) -> str:
    """
    Build the custom rules section of the AI prompt.
    Groups rules by category for clarity.
    """
    if not rules.custom_rules:
        return ""

    # Group by category
    categories: dict[str, list[CustomRule]] = {}
    for rule in rules.custom_rules:
        cat = rule.category
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(rule)

    lines = [
        f"## Project: {rules.project_name}",
        "## CRITICAL — Project-Specific Rules (check these first)\n",
        "These rules are MANDATORY for this codebase.",
        "Violations must be flagged regardless of severity.\n",
    ]

    category_labels = {
        "architecture":       "🏗️  Architecture Rules",
        "ui-consistency":     "🎨  UI Consistency Rules",
        "i18n":               "🌍  Internationalization Rules",
        "forbidden-library":  "🚫  Forbidden Libraries",
        "styling":            "💅  Styling Rules",
        "typescript":         "📘  TypeScript Rules",
        "api":                "🔌  API Layer Rules",
        "forms":              "📝  Forms Rules",
        "nextjs":             "⚡  NextJS Rules",
    }

    for category, category_rules in categories.items():
        label = category_labels.get(category, f"📋  {category.title()} Rules")
        lines.append(f"\n### {label}")

        for rule in category_rules:
            severity_badge = {
                "critical": "🔴 CRITICAL",
                "high":     "🟠 HIGH",
                "medium":   "🟡 MEDIUM",
                "low":      "🔵 LOW",
            }.get(rule.severity, "🟡 MEDIUM")

            lines.append(f"\n**{severity_badge}** [{rule.id}]")
            lines.append(f"Rule: {rule.description}")
            lines.append(f"If violated, say: \"{rule.message}\"")

            if rule.detect:
                lines.append(f"Detect if code contains: {', '.join(repr(d) for d in rule.detect[:3])}")

            if rule.exception:
                lines.append(f"Exception — ignore in: {', '.join(rule.exception)}")

            if rule.suggestion:
                lines.append(f"Suggest this fix:\n```\n{rule.suggestion}\n```")

    # Add ignore patterns
    if rules.ignore_patterns:
        lines.append("\n## DO NOT FLAG — These are handled by other tools:")
        for pattern in rules.ignore_patterns:
            lines.append(f"  - {pattern}")

    return "\n".join(lines)


def _default_rules() -> ProjectRules:
    """Fallback rules if no yaml file found."""
    return ProjectRules(
        project_name    = "NextJS Project",
        project_type    = "nextjs",
        custom_rules    = [],
        skip_files      = [
            "*.lock", "node_modules/", "dist/",
            ".next/", "public/", "*.min.js",
        ],
        priority_files  = ["src/"],
        normal_files    = [],
        ignore_patterns = [
            "missing semicolon", "trailing whitespace",
            "import order", "line too long",
        ],
        nextjs_rules    = {},
        quality_rules   = {},
        settings        = {
            "max_files_per_review": 50,
            "max_issues_per_file":  5,
            "chunk_size":           8,
            "chunk_timeout":        300,
        },
    )


# ── Test ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    rules = load_rules()

    print(f"✅ Rules loaded for: {rules.project_name}")
    print(f"   Custom rules:  {len(rules.custom_rules)}")
    print(f"   Skip patterns: {len(rules.skip_files)}")
    print(f"   Ignore noise:  {len(rules.ignore_patterns)}")
    print()

    print("── Custom Rules ───────────────────────────")
    for rule in rules.custom_rules:
        print(f"  [{rule.severity.upper()}] {rule.id}")
        print(f"         {rule.description}")
    print()

    print("── Prompt Preview (first 50 lines) ────────")
    prompt = build_custom_rules_prompt(rules)
    lines  = prompt.split("\n")
    for line in lines[:50]:
        print(line)