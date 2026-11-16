import json
import os
import subprocess
import tempfile
import unittest

from sdlc.discovery import render_issue, validate_proposal
from sdlc.plan_guard import check_binding, check_pr, validate_plan_text

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GOOD_PLAN = """---
proposal: 7
status: proposed
title: Apply catalog discounts
---
# Plan
## 2. Acceptance criteria
| AC-1 | price | test |
## 5. Implementation steps
1. do it
## 7. Test plan
## 9. Out of scope
"""
PLAN_PATH = "docs/plans/proposal-7-apply-discounts.md"


class PlanGuardTests(unittest.TestCase):
    def test_valid_plan_only_pr(self):
        errors, _ = check_pr([{"filename": PLAN_PATH, "status": "added"}], {PLAN_PATH: GOOD_PLAN})
        self.assertEqual(errors, [])

    def test_plan_pr_touching_code_fails(self):
        errors, _ = check_pr([{"filename": PLAN_PATH, "status": "added"},
                              {"filename": "api/src/routes/order.ts", "status": "modified"}], {PLAN_PATH: GOOD_PLAN})
        self.assertTrue(any("plan-only" in e for e in errors))

    def test_non_plan_pr_passes(self):
        errors, info = check_pr([{"filename": "api/src/index.ts", "status": "modified"}], {})
        self.assertEqual(errors, [])
        self.assertIn("Not a plan PR", info)

    def test_front_matter_must_match_file_name(self):
        errors = validate_plan_text(PLAN_PATH, GOOD_PLAN.replace("proposal: 7", "proposal: 8"))
        self.assertTrue(any("'proposal' must be 7" in e for e in errors))
        self.assertTrue(validate_plan_text("docs/plans/random.md", GOOD_PLAN))
        self.assertTrue(any("Test plan" in e for e in validate_plan_text(PLAN_PATH, GOOD_PLAN.replace("Test plan", "Tests"))))

    def test_template_has_required_sections(self):
        with open(os.path.join(ROOT, "docs/plans/TEMPLATE.md"), encoding="utf-8") as f:
            text = f.read().replace("proposal: 0", "proposal: 7").replace('title: ""', "title: x")
        self.assertEqual(validate_plan_text(PLAN_PATH, text), [])


class BindingTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "user.name", "t")
        os.makedirs(os.path.join(self.dir, "docs/plans"))
        self.write(GOOD_PLAN)
        self.git("add", ".")
        self.git("commit", "-qm", "plan")
        self.sha = self.git("rev-parse", "HEAD").stdout.strip()

    def git(self, *args):
        return subprocess.run(["git", "-C", self.dir, *args], capture_output=True, text=True)

    def write(self, text):
        with open(os.path.join(self.dir, PLAN_PATH), "w") as f:
            f.write(text)

    def bind(self, body):
        return check_binding(body, "main", git=lambda *a: self.git(*a))

    def test_binding(self):
        self.assertEqual(self.bind("no refs")[0], [])
        self.assertTrue(self.bind("Proposal: #7")[0])
        body = f"Closes #9\nProposal: #7\nPlan: {PLAN_PATH}@{self.sha}\n"
        self.assertEqual(self.bind(body)[0], [])
        self.write(GOOD_PLAN + "\nedited after approval\n")
        self.git("commit", "-qam", "edit")
        self.assertTrue(any("changed on the base branch" in e for e in self.bind(body)[0]))


class DiscoveryTests(unittest.TestCase):
    def test_sample_output_is_valid_and_renders(self):
        with open(os.path.join(ROOT, "docs/agentic-sdlc/sample-run/01-discovery-output.json"), encoding="utf-8") as f:
            proposal = json.load(f)
        self.assertEqual(validate_proposal(proposal), [])
        md = render_issue(proposal, "Make order pricing trustworthy", 3)
        self.assertIn("**AC-4**", md)
        self.assertIn("`pm-approved`", md)
        self.assertIn("(#3)", md)

    def test_rejects_missing_acceptance_criteria(self):
        bad = {"title": "t", "problem": "p", "evidence": [{"source": "s", "detail": "d"}], "desired_outcome": "o",
               "acceptance_criteria": [], "out_of_scope": [], "risks": [], "open_questions": [], "confidence": "high"}
        self.assertTrue(validate_proposal(bad))


if __name__ == "__main__":
    unittest.main()
