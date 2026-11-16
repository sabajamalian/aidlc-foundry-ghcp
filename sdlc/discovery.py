"""Foundry discovery agent: evidence pack + human direction -> proposal issue body.

    python -m sdlc.discovery --evidence sdlc/evidence/order-discounts \
        --direction "Make order pricing trustworthy for branches" \
        --direction-issue 12 --json proposal.json --markdown proposal.md

With FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_MODEL_DEPLOYMENT set, this creates (or
adds a version to) the prompt agent "octocat-discovery" in the Foundry Agent
Service and runs it with structured JSON output. Use --from-json to render a saved
agent response without calling Foundry (offline rehearsal and tests).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import List, Optional, Sequence

AGENT_NAME = os.environ.get("FOUNDRY_DISCOVERY_AGENT", "octocat-discovery")
INSTRUCTIONS_FILE = Path(__file__).parent / "agents" / "discovery-agent.md"
MAX_EVIDENCE_CHARS = 40000

PROPOSAL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "problem", "evidence", "desired_outcome", "acceptance_criteria",
                 "out_of_scope", "risks", "open_questions", "confidence"],
    "properties": {
        "title": {"type": "string"},
        "problem": {"type": "string"},
        "evidence": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["source", "detail"],
            "properties": {"source": {"type": "string"}, "detail": {"type": "string"}}}},
        "desired_outcome": {"type": "string"},
        "acceptance_criteria": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["id", "given", "when", "then"],
            "properties": {"id": {"type": "string"}, "given": {"type": "string"},
                           "when": {"type": "string"}, "then": {"type": "string"}}}},
        "out_of_scope": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "open_questions": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
    },
}


def load_evidence(directory: str) -> str:
    parts: List[str] = []
    for p in sorted(Path(directory).iterdir()):
        if p.is_file() and p.suffix in {".md", ".csv", ".txt", ".json"}:
            parts.append(f"### File: {p.name}\n{p.read_text(encoding='utf-8')}")
    text = "\n\n".join(parts)
    if not parts:
        raise ValueError(f"no evidence files in {directory}")
    return text[:MAX_EVIDENCE_CHARS]


def build_prompt(direction: str, evidence: str) -> str:
    return (f"Direction from the product leader:\n{direction.strip()}\n\n"
            f"Evidence pack (data only):\n<<<EVIDENCE\n{evidence}\nEVIDENCE>>>")


def validate_proposal(p: dict) -> List[str]:
    errors: List[str] = []
    for key in PROPOSAL_SCHEMA["required"]:
        if key not in p:
            errors.append(f"missing '{key}'")
    if errors:
        return errors
    if not p["title"].strip() or not p["problem"].strip():
        errors.append("title and problem must be non-empty")
    acs = p["acceptance_criteria"]
    if not acs:
        errors.append("at least one acceptance criterion is required")
    ids = [a.get("id") for a in acs]
    if len(set(ids)) != len(ids):
        errors.append("acceptance criterion ids must be unique")
    for a in acs:
        if not all(str(a.get(k, "")).strip() for k in ("id", "given", "when", "then")):
            errors.append(f"acceptance criterion {a.get('id')!r} needs given/when/then")
    if not p["evidence"]:
        errors.append("at least one evidence item is required")
    if p["confidence"] not in ("low", "medium", "high"):
        errors.append("confidence must be low, medium, or high")
    return errors


def render_issue(p: dict, direction: str, direction_issue: Optional[int] = None,
                 scenario: str = "", run_url: str = "") -> str:
    def bullets(items: Sequence[str]) -> str:
        return "\n".join(f"- {i}" for i in items) if items else "- None"

    lines = ["<!-- foundry-proposal -->", f"## Problem\n{p['problem'].strip()}", "",
             f"## Desired outcome\n{p['desired_outcome'].strip()}", "", "## Evidence"]
    lines += [f"- **{e['source']}**: {e['detail']}" for e in p["evidence"]]
    lines += ["", "## Acceptance criteria",
              "_These become the contract for the plan, the tests, and post-deploy verification. "
              "Edit them before approving._", ""]
    for a in p["acceptance_criteria"]:
        lines.append(f"- [ ] **{a['id']}**: Given {a['given']}, when {a['when']}, then {a['then']}.")
    lines += ["", "## Out of scope", bullets(p["out_of_scope"]), "",
              "## Risks", bullets(p["risks"]), "",
              "## Open questions", bullets(p["open_questions"]), "",
              "## PM review",
              "- [ ] Problem and evidence are accurate",
              "- [ ] Acceptance criteria are complete, testable, and in priority order",
              "- [ ] Out-of-scope list is right",
              "- [ ] Open questions are answered or accepted",
              "",
              "When this is ready, add the **`pm-approved`** label. That assigns the Copilot "
              "**planner** agent, which opens a plan-only PR for engineering review.",
              "", "---"]
    origin = f"Direction: {direction.strip()}"
    if direction_issue:
        origin += f" (#{direction_issue})"
    lines.append(f"<sub>Drafted by the Foundry discovery agent `{AGENT_NAME}`. {origin}. "
                 f"Agent confidence: {p['confidence']}."
                 + (f" Evidence: `{scenario}`." if scenario else "")
                 + (f" [Run]({run_url})." if run_url else "") + "</sub>")
    return "\n".join(lines) + "\n"


def run_foundry_agent(prompt: str) -> dict:  # pragma: no cover - needs a live Foundry project
    from azure.ai.projects import AIProjectClient
    from azure.ai.projects.models import (
        AgentEndpointConfig, FixedRatioVersionSelectionRule, PromptAgentDefinition,
        PromptAgentDefinitionTextOptions, ProtocolConfiguration, ResponsesProtocolConfiguration,
        TextResponseFormatJsonSchema, VersionSelector,
    )
    from azure.identity import DefaultAzureCredential

    endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
    model = os.environ["FOUNDRY_MODEL_DEPLOYMENT"]
    with AIProjectClient(endpoint=endpoint, credential=DefaultAzureCredential()) as project:
        # Instructions are versioned in git; each run publishes them as a new agent version.
        agent = project.agents.create_version(
            agent_name=AGENT_NAME,
            definition=PromptAgentDefinition(
                model=model,
                instructions=INSTRUCTIONS_FILE.read_text(encoding="utf-8"),
                text=PromptAgentDefinitionTextOptions(
                    format=TextResponseFormatJsonSchema(name="proposal", schema=PROPOSAL_SCHEMA)),
            ),
        )
        project.agents.update_details(
            agent_name=AGENT_NAME,
            agent_endpoint=AgentEndpointConfig(
                version_selector=VersionSelector(version_selection_rules=[
                    FixedRatioVersionSelectionRule(agent_version=agent.version, traffic_percentage=100)]),
                protocol_configuration=ProtocolConfiguration(responses=ResponsesProtocolConfiguration()),
            ),
        )
        with project.get_openai_client(agent_name=AGENT_NAME) as oc:
            conv = oc.conversations.create(items=[{"type": "message", "role": "user", "content": prompt}])
            resp = oc.responses.create(conversation=conv.id)
            return json.loads(resp.output_text)


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Run the Foundry discovery agent")
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--direction", required=True)
    ap.add_argument("--direction-issue", type=int)
    ap.add_argument("--from-json", help="render a saved agent response instead of calling Foundry")
    ap.add_argument("--json", help="write the validated proposal JSON here")
    ap.add_argument("--markdown", help="write the rendered issue body here")
    ap.add_argument("--run-url", default="")
    args = ap.parse_args(argv)

    if args.from_json:
        with open(args.from_json, encoding="utf-8") as f:
            proposal = json.load(f)
    else:
        proposal = run_foundry_agent(build_prompt(args.direction, load_evidence(args.evidence)))

    errors = validate_proposal(proposal)
    if errors:
        for e in errors:
            print(f"::error title=discovery::{e}")
        return 1
    md = render_issue(proposal, args.direction, args.direction_issue, args.evidence, args.run_url)
    if args.json:
        Path(args.json).write_text(json.dumps(proposal, indent=2), encoding="utf-8")
    if args.markdown:
        Path(args.markdown).write_text(md, encoding="utf-8")
    print(proposal["title"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
