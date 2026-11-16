"""Minimal client for Microsoft-Decision on Microsoft Foundry.

API reference:
https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision

    POST {FOUNDRY_RESOURCE_ENDPOINT}/providers/microsoft/v1/systemone
    {"model": "<deployment>", "state": "...",
     "questions": {"<name>": {"type": "choice", "instructions": "...",
                              "criteria": {"<option>": "<description>", ...}}}}

The documented response carries answers[<name>].choice. The docs say per-option
probabilities are returned but don't pin down the field name, so
`_extract_probability` accepts the shapes we have seen and returns None when it
can't find one. Validate this against your deployment before promoting any rule
to blocking.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Dict, Mapping, Optional, Tuple

# transport(url, headers, body_bytes, timeout) -> (status_code, response_text)
Transport = Callable[[str, Dict[str, str], bytes, float], Tuple[int, str]]

RETRYABLE = {429, 500, 502, 503, 504}


class DecisionUnavailable(Exception):
    """The Decision service could not produce an answer (config, auth, quota, network)."""


@dataclass
class Answer:
    choice: Optional[str]
    probability: Optional[float]  # probability of the chosen option, if returned
    violation_probability: Optional[float]  # probability of "violation", if returned
    raw: dict


def urllib_transport(url: str, headers: Dict[str, str], body: bytes, timeout: float) -> Tuple[int, str]:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise DecisionUnavailable(f"network error: {e}") from e


def _extract_probabilities(answer: Mapping) -> Dict[str, float]:
    for key in ("probabilities", "distribution", "scores", "options"):
        val = answer.get(key)
        if isinstance(val, dict):
            return {str(k): float(v) for k, v in val.items() if isinstance(v, (int, float))}
        if isinstance(val, list):
            out: Dict[str, float] = {}
            for item in val:
                if not isinstance(item, dict):
                    continue
                name = item.get("choice") or item.get("name") or item.get("label") or item.get("option")
                p = item.get("probability", item.get("p", item.get("score")))
                if name is not None and isinstance(p, (int, float)):
                    out[str(name)] = float(p)
            if out:
                return out
    return {}


def parse_answer(answer: Mapping, violation_option: str = "violation") -> Answer:
    choice = answer.get("choice")
    if choice is None and isinstance(answer.get("answer"), str):
        choice = answer["answer"]
    probs = _extract_probabilities(answer)
    chosen_p = probs.get(choice) if choice else None
    if chosen_p is None and isinstance(answer.get("probability"), (int, float)):
        chosen_p = float(answer["probability"])
    violation_p = probs.get(violation_option)
    if violation_p is None and choice == violation_option:
        violation_p = chosen_p
    return Answer(choice=choice, probability=chosen_p, violation_probability=violation_p, raw=dict(answer))


class DecisionClient:
    def __init__(
        self,
        endpoint: str,
        deployment: str,
        token: Optional[str] = None,
        api_key: Optional[str] = None,
        transport: Transport = urllib_transport,
        max_retries: int = 3,
        timeout: float = 60.0,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if not endpoint or not deployment:
            raise DecisionUnavailable("FOUNDRY_RESOURCE_ENDPOINT and FOUNDRY_DECISION_DEPLOYMENT must be set")
        if not token and not api_key:
            raise DecisionUnavailable("no credential: set FOUNDRY_DECISION_TOKEN (Entra ID) or FOUNDRY_DECISION_API_KEY")
        self.url = endpoint.rstrip("/") + "/providers/microsoft/v1/systemone"
        self.deployment = deployment
        self.headers = {"Content-Type": "application/json"}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        else:
            self.headers["api-key"] = api_key  # type: ignore[assignment]
        self.transport = transport
        self.max_retries = max_retries
        self.timeout = timeout
        self.sleep = sleep
        self.calls = 0

    def ask(self, state: str, questions: Dict[str, dict]) -> Dict[str, dict]:
        """Send one request with several questions about the same state. Returns raw answers by name."""
        body = json.dumps({"model": self.deployment, "state": state, "questions": questions}).encode("utf-8")
        last = ""
        for attempt in range(self.max_retries + 1):
            self.calls += 1
            status, text = self.transport(self.url, self.headers, body, self.timeout)
            if status == 200:
                try:
                    data = json.loads(text)
                except ValueError as e:
                    raise DecisionUnavailable(f"invalid JSON from Decision API: {e}") from e
                answers = data.get("answers")
                if not isinstance(answers, dict):
                    raise DecisionUnavailable("Decision API response has no 'answers' object")
                return answers
            last = f"HTTP {status}: {text[:300]}"
            if status not in RETRYABLE or attempt == self.max_retries:
                break
            self.sleep(min(2 ** attempt, 20))
        raise DecisionUnavailable(last)
