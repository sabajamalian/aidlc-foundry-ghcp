"""Plan guard: enforce the plan approval gate.

check-pr       A PR that adds or edits docs/plans/proposal-*.md must change only that one
               file, and the plan must have valid front matter and the required sections.
               Any other PR must not touch approved plans.
check-binding  An implementation PR ("Proposal: #N" in its body) must name the approved
               plan as "Plan: <path>@<sha>", that commit must contain the plan, and the plan
               must not have changed on the base branch since it was approved.

Inputs are data fetched by the workflow (PR file list, plan text, PR body). Nothing
from the PR is executed.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from typing import List, Optional, Sequence

import yaml

PLAN_PATH = re.compile(r"^docs/plans/proposal-(\d+)-[a-z0-9][a-z0-9-]*\.md$")
REQUIRED_SECTIONS = ["Acceptance criteria", "Implementation steps", "Test plan", "Out of scope"]
VALID_STATUS = {"proposed", "approved"}


def validate_plan_text(path: str, text: str) -> List[str]:
    errors: List[str] = []
    m = PLAN_PATH.match(path)
    if not m:
        return [f"{path}: plan files must be named docs/plans/proposal-<issue>-<slug>.md"]
    fm = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not fm:
        return [f"{path}: missing YAML front matter"]
    try:
        meta = yaml.safe_load(fm.group(1)) or {}
    except yaml.YAMLError as e:
        return [f"{path}: front matter is not valid YAML ({e})"]
    if meta.get("proposal") != int(m.group(1)):
        errors.append(f"{path}: front matter 'proposal' must be {m.group(1)} to match the file name")
    if meta.get("status") not in VALID_STATUS:
        errors.append(f"{path}: front matter 'status' must be one of {sorted(VALID_STATUS)}")
    if not str(meta.get("title") or "").strip():
        errors.append(f"{path}: front matter 'title' is empty")
    headings = [h.strip().lower() for h in re.findall(r"^#{2,3}\s+(?:\d+\.\s*)?(.+)$", text, re.M)]
    for s in REQUIRED_SECTIONS:
        if not any(h.startswith(s.lower()) for h in headings):
            errors.append(f"{path}: missing section '{s}'")
    if not re.search(r"\bAC-\d+\b", text):
        errors.append(f"{path}: no acceptance criteria (AC-n) mapped in the plan")
    return errors


def check_pr(changed: Sequence[dict], plan_texts: dict) -> tuple:
    """changed: [{'filename','status'}]. plan_texts: {path: text} for plan files in the PR."""
    names = [c["filename"] for c in changed]
    plan_files = [n for n in names if n.startswith("docs/plans/proposal-")]
    if not plan_files:
        return [], "Not a plan PR. No approved plans touched."
    others = [n for n in names if n not in plan_files]
    errors: List[str] = []
    if others:
        errors.append(
            "Plan files can only change in a plan-only PR. Remove these files or move them to a separate PR: "
            + ", ".join(others[:20])
        )
    if len(plan_files) > 1:
        errors.append("A plan PR must change exactly one plan file: " + ", ".join(plan_files))
    for c in changed:
        if c["filename"] in plan_files and c.get("status") == "removed":
            errors.append(f"{c['filename']}: approved plans can't be deleted in a PR")
    for p in plan_files:
        if p in plan_texts:
            errors.extend(validate_plan_text(p, plan_texts[p]))
    return errors, f"Plan PR for {', '.join(plan_files)}."


BINDING = re.compile(r"^\s*Plan:\s*`?(docs/plans/[^\s@`]+\.md)@([0-9a-f]{7,40})`?", re.M | re.I)
PROPOSAL_REF = re.compile(r"^\s*Proposal:\s*#(\d+)", re.M | re.I)


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def check_binding(body: str, base_ref: str, git=_git) -> tuple:
    if not PROPOSAL_REF.search(body or ""):
        return [], "Not an implementation PR (no 'Proposal: #N' line). Binding not required."
    m = BINDING.search(body or "")
    if not m:
        return ["Implementation PR must include 'Plan: docs/plans/<file>.md@<sha>' naming the approved plan."], ""
    path, sha = m.group(1), m.group(2)
    if git("cat-file", "-e", f"{sha}:{path}").returncode != 0:
        return [f"{path} does not exist at {sha}. Use the plan merge commit from the implementation issue."], ""
    if git("merge-base", "--is-ancestor", sha, base_ref).returncode != 0:
        return [f"{sha} is not on the base branch, so it isn't an approved plan revision."], ""
    if git("diff", "--quiet", sha, base_ref, "--", path).returncode != 0:
        return [f"{path} changed on the base branch after {sha[:12]}. Re-bind to the latest approved plan."], ""
    return [], f"Bound to approved plan {path}@{sha[:12]}."


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Plan approval gate")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("check-pr")
    a.add_argument("--changed", required=True, help="JSON from GET /pulls/N/files")
    a.add_argument("--plan", action="append", default=[], help="path=local_file with the plan text at the PR head")
    b = sub.add_parser("check-binding")
    b.add_argument("--body", required=True, help="file with the PR body")
    b.add_argument("--base-ref", required=True)
    args = ap.parse_args(argv)

    if args.cmd == "check-pr":
        with open(args.changed, encoding="utf-8") as f:
            changed = json.load(f)
        texts = {}
        for item in args.plan:
            path, local = item.split("=", 1)
            with open(local, encoding="utf-8") as f:
                texts[path] = f.read()
        errors, info = check_pr(changed, texts)
    else:
        with open(args.body, encoding="utf-8") as f:
            errors, info = check_binding(f.read(), args.base_ref)

    for e in errors:
        print(f"::error title=plan-guard::{e}")
    if info:
        print(info)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
