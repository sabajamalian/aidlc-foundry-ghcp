import json
import os
import unittest

from sdlc.decision_client import DecisionClient, DecisionUnavailable, parse_answer
from sdlc.policy_check import (
    annotations, evaluate, glob_to_regex, line_ranges, load_policy, parse_diff, render_markdown,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DIFF = """\
diff --git a/api/src/routes/orderDetail.ts b/api/src/routes/orderDetail.ts
index 1111111..2222222 100644
--- a/api/src/routes/orderDetail.ts
+++ b/api/src/routes/orderDetail.ts
@@ -10,3 +10,6 @@ router.post('/', async (req, res, next) => {
   const repo = await getOrderDetailsRepository();
+  console.log(req.body);
+  const price = product.price * (1 - product.discount);
+  const rows = await db.all(`SELECT * FROM products WHERE id = ${req.body.productId}`);
   res.json(x);
diff --git a/api/src/routes/orderDetail.test.ts b/api/src/routes/orderDetail.test.ts
new file mode 100644
--- /dev/null
+++ b/api/src/routes/orderDetail.test.ts
@@ -0,0 +1,2 @@
+console.log('fine in tests');
+const x: any = 1;
diff --git a/api/database/migrations/001_init.sql b/api/database/migrations/001_init.sql
index 3333333..4444444 100644
--- a/api/database/migrations/001_init.sql
+++ b/api/database/migrations/001_init.sql
@@ -1,1 +1,2 @@
 CREATE TABLE x (id INT);
+ALTER TABLE x ADD y INT;
diff --git a/api/database/migrations/003_add_discount.sql b/api/database/migrations/003_add_discount.sql
new file mode 100644
--- /dev/null
+++ b/api/database/migrations/003_add_discount.sql
@@ -0,0 +1 @@
+ALTER TABLE order_details ADD discount REAL;
"""


def fake_transport(answers_by_call):
    calls = []

    def t(url, headers, body, timeout):
        calls.append(json.loads(body))
        status, payload = answers_by_call[min(len(calls) - 1, len(answers_by_call) - 1)]
        return status, json.dumps(payload) if not isinstance(payload, str) else payload

    t.calls = calls
    return t


def client(transport, **kw):
    return DecisionClient("https://x.services.ai.azure.com/", "decision", token="t", transport=transport,
                          sleep=lambda s: None, **kw)


class GlobAndDiffTests(unittest.TestCase):
    def test_globstar(self):
        self.assertTrue(glob_to_regex("api/src/**/*.ts").match("api/src/routes/order.ts"))
        self.assertTrue(glob_to_regex("api/src/**/*.ts").match("api/src/index.ts"))
        self.assertFalse(glob_to_regex("api/src/**/*.ts").match("frontend/src/a.ts"))
        self.assertTrue(glob_to_regex("**/*.test.ts").match("api/src/routes/a.test.ts"))

    def test_parse_diff_line_numbers_and_status(self):
        files = {f.path: f for f in parse_diff(DIFF)}
        od = files["api/src/routes/orderDetail.ts"]
        self.assertEqual([n for n, _ in od.added], [11, 12, 13])
        self.assertEqual(od.status, "modified")
        self.assertEqual(files["api/src/routes/orderDetail.test.ts"].status, "added")
        self.assertEqual(files["api/database/migrations/003_add_discount.sql"].status, "added")

    def test_line_ranges(self):
        self.assertEqual(line_ranges([5, 3, 4, 9]), "L3-L5, L9")


class PolicyEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.policy = load_policy(os.path.join(ROOT, ".github/policies/team-standards.yml"))
        self.files = parse_diff(DIFF)

    def test_unavailable_is_not_pass(self):
        report = evaluate(self.policy, self.files, None, "not configured")
        # deterministic blocking rules still fail the check without the model
        self.assertEqual(report.status, "fail")
        ids = {(f.rule_id, f.path) for f in report.findings if f.outcome == "violation"}
        self.assertIn(("LOG-001", "api/src/routes/orderDetail.ts"), ids)
        self.assertNotIn(("LOG-001", "api/src/routes/orderDetail.test.ts"), ids)
        self.assertIn(("DB-001", "api/database/migrations/001_init.sql"), ids)
        self.assertNotIn(("DB-001", "api/database/migrations/003_add_discount.sql"), ids)
        self.assertTrue(any(f.outcome == "unavailable" for f in report.findings))

        clean = parse_diff(DIFF.split("diff --git a/api/src/routes/orderDetail.test.ts")[0].replace(
            "+  console.log(req.body);\n", ""))
        report = evaluate(self.policy, clean, None, "not configured")
        self.assertEqual(report.status, "unavailable")
        self.assertEqual(report.exit_code, 2)
        self.assertIn("UNAVAILABLE", render_markdown(report))

    def test_decision_batches_rules_per_file_and_uses_diff_evidence(self):
        answers = {"answers": {
            "sec_001": {"choice": "violation", "probabilities": {"violation": 0.93, "compliant": 0.07}},
            "money_001": {"choice": "violation", "probabilities": {"violation": 0.88}},
            "api_002": {"choice": "not_applicable"},
            "api_003": {"choice": "cannot_tell"},
        }}
        t = fake_transport([(200, answers)])
        report = evaluate(self.policy, self.files, client(t))
        self.assertEqual(len(t.calls), 1)  # one file has decision-rule matches
        req = t.calls[0]
        self.assertEqual(set(req["questions"]), {"sec_001", "money_001", "api_002", "api_003"})
        self.assertEqual(req["questions"]["sec_001"]["type"], "choice")
        self.assertIn("cannot_tell", req["questions"]["sec_001"]["criteria"])
        self.assertIn("ADDED_CODE", req["state"])
        sec = [f for f in report.findings if f.rule_id == "SEC-001"][0]
        self.assertEqual((sec.outcome, sec.lines, sec.first_line), ("violation", "L11-L13", 11))
        self.assertFalse(sec.blocking)  # advisory in the shipped policy
        self.assertAlmostEqual(sec.probability, 0.93)

    def test_blocking_decision_respects_threshold(self):
        for r in self.policy["rules"]:
            if r["id"] == "SEC-001":
                r["enforcement"] = "blocking"
        only_code = [f for f in self.files if f.path == "api/src/routes/orderDetail.ts"]
        for c in only_code:
            c.added = [a for a in c.added if "console.log" not in a[1]]
        rest = {k: {"choice": "compliant"} for k in ("money_001", "api_002", "api_003")}
        low = {"answers": dict(rest, sec_001={"choice": "violation", "probabilities": {"violation": 0.6}})}
        self.assertEqual(evaluate(self.policy, only_code, client(fake_transport([(200, low)]))).status, "pass")
        high = {"answers": dict(rest, sec_001={"choice": "violation", "probabilities": {"violation": 0.95}})}
        report = evaluate(self.policy, only_code, client(fake_transport([(200, high)])))
        self.assertEqual(report.status, "fail")
        self.assertTrue(any(a.startswith("::error file=api/src/routes/orderDetail.ts,line=12")
                            for a in annotations(report)))

    def test_auth_failure_marks_unavailable_and_stops_calling(self):
        t = fake_transport([(401, "unauthorized")])
        files = parse_diff(DIFF) + parse_diff(DIFF.replace("orderDetail.ts", "order.ts"))
        report = evaluate(self.policy, files, client(t))
        self.assertEqual(len(t.calls), 1)
        self.assertTrue(any("HTTP 401" in n for n in report.notes))

    def test_call_cap(self):
        self.policy["decision"]["max_calls"] = 0
        report = evaluate(self.policy, self.files, client(fake_transport([(200, {"answers": {}})])))
        self.assertTrue(any(f.outcome == "not_evaluated" for f in report.findings))


class DecisionClientTests(unittest.TestCase):
    def test_retries_429_then_succeeds(self):
        t = fake_transport([(429, "slow down"), (200, {"answers": {"q": {"choice": "compliant"}}})])
        self.assertEqual(client(t).ask("s", {"q": {}}), {"q": {"choice": "compliant"}})
        self.assertEqual(len(t.calls), 2)

    def test_requires_credentials(self):
        with self.assertRaises(DecisionUnavailable):
            DecisionClient("https://x", "d")

    def test_parse_answer_list_probabilities(self):
        a = parse_answer({"choice": "violation", "probabilities": [
            {"choice": "violation", "probability": 0.7}, {"choice": "compliant", "probability": 0.3}]})
        self.assertEqual((a.choice, a.violation_probability), ("violation", 0.7))
        self.assertIsNone(parse_answer({"choice": "compliant"}).probability)


if __name__ == "__main__":
    unittest.main()
