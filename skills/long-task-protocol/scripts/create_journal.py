#!/usr/bin/env python3
import re
import sys
from datetime import datetime
from pathlib import Path

def slugify(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "task"

def main():
    if len(sys.argv) < 2:
        print("usage: create_journal.py <slug>")
        sys.exit(2)

    slug = slugify(sys.argv[1])
    now = datetime.now().astimezone()
    ts = now.strftime("%Y%m%d-%H%M")
    created = now.strftime("%Y-%m-%d %H:%M %Z")
    tasks_dir = Path("tasks")
    tasks_dir.mkdir(parents=True, exist_ok=True)

    task_path = tasks_dir / f"TASK-{ts}-{slug}.md"

    # Load template (preferred). Fallback to embedded template.
    tmpl_path = Path(__file__).resolve().parent.parent / "TEMPLATE.md"
    if tmpl_path.exists():
        template = tmpl_path.read_text(encoding="utf-8")
    else:
        template = "# TASK TEMPLATE\n\n(Template missing)\n"

    content = (
        template
        .replace("{{timestamp}}", ts)
        .replace("{{slug}}", slug)
        .replace("{{date}}", created)
    )
    if not content.startswith("# TASK-"):
        content = f"# TASK-{ts}-{slug}\n\n{content.lstrip()}"

    task_path.write_text(content, encoding="utf-8")
    print(str(task_path))

if __name__ == "__main__":
    main()
