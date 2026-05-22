"""
rule_learner.py — Adaptive Rule Suggestion System
=================================================
When the Stage 3 output guard blocks an LLM response, this module fires a
targeted Llama 3 call to extract any numeric thresholds or policy constraints
that should become permanent business rules.  Candidates above a confidence
threshold of 0.6 are persisted to the `suggested_rules` table for admin review.
"""

import re
import json
import logging

from app.core.guards import call_llm_judge
from app.db.database import save_suggested_rule

logger = logging.getLogger("avanguard.rule_learner")

# ---------------------------------------------------------------------------
# System prompt sent to Llama 3 for rule extraction
# ---------------------------------------------------------------------------
_EXTRACTION_SYSTEM_PROMPT = """You are a business rule extraction system. Given a blocked LLM response and the reason it was blocked, extract any numeric thresholds or policy constraints that should become permanent rules.

Output ONLY a JSON array (empty array if no rules found). Each rule object must have:
{"target_field": str, "operator": "<="|">="|"<"|">"|"==", "suggested_value": float, "description": str, "confidence": float between 0 and 1}

Examples of extractable rules:
- Response mentioned "$120 refund" when limit is $50 → {"target_field": "proposed_refund_amount", "operator": "<=", "suggested_value": 50.0, "description": "Max automatic refund limit", "confidence": 0.9}
- Response offered "30% discount" → {"target_field": "discount_percentage", "operator": "<=", "suggested_value": 30.0, "description": "Max promotional discount percentage", "confidence": 0.85}

Only extract rules with confidence > 0.6. Return [] if nothing is clearly extractable."""


async def extract_rule_candidates(
    blocked_prompt: str,
    blocked_response: str,
    violation_reason: str,
) -> list[dict]:
    """
    Calls Llama 3 to extract numeric/policy rule candidates from a blocked response.

    Returns a list of candidate dicts (already filtered to confidence > 0.6).
    Returns an empty list on any parsing failure.
    """
    user_content = (
        f"ORIGINAL PROMPT:\n{blocked_prompt}\n\n"
        f"BLOCKED LLM RESPONSE:\n{blocked_response}\n\n"
        f"BLOCK REASON:\n{violation_reason}"
    )

    # call_llm_judge expects a JSON object, but here we need an array.
    # We wrap via a light async httpx call that reuses the same Ollama endpoint,
    # delegating JSON extraction to call_llm_judge but then re-parsing the raw
    # text so we can handle an array rather than an object.
    import httpx

    OLLAMA_API_URL = "http://localhost:11434/v1/chat/completions"
    payload = {
        "model": "llama3",
        "format": "json",
        "messages": [
            {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.0,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(OLLAMA_API_URL, json=payload)
            response.raise_for_status()
            raw_text = response.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("[RuleLearner] LLM call failed: %s", exc)
        return []

    # Try to find a JSON array in the response (model may wrap it in prose)
    start_idx = raw_text.find("[")
    end_idx = raw_text.rfind("]")
    if start_idx == -1 or end_idx == -1:
        logger.warning("[RuleLearner] No JSON array found in LLM output: %s", raw_text[:200])
        return []

    try:
        candidates: list = json.loads(raw_text[start_idx : end_idx + 1])
    except json.JSONDecodeError as exc:
        logger.warning("[RuleLearner] JSON parse error: %s — raw: %s", exc, raw_text[:200])
        return []

    # Validate shape and filter by confidence
    validated: list[dict] = []
    required_keys = {"target_field", "operator", "suggested_value", "description", "confidence"}
    for item in candidates:
        if not isinstance(item, dict):
            continue
        if not required_keys.issubset(item.keys()):
            continue
        try:
            confidence = float(item["confidence"])
        except (TypeError, ValueError):
            continue
        if confidence > 0.6:
            item["confidence"] = confidence
            item["suggested_value"] = float(item["suggested_value"])
            validated.append(item)

    return validated


async def process_blocked_event(
    log_id: int,
    prompt: str,
    response: str,
    reason: str,
) -> None:
    """
    Fire-and-forget coroutine: extracts rule candidates from a blocked event
    and persists each one to `suggested_rules` for admin review.

    Arguments:
        log_id   – the `audit_logs.id` of the blocked request
        prompt   – the sanitised user prompt that produced the blocked output
        response – the full LLM output that was blocked
        reason   – the human-readable block reason from the output guard
    """
    logger.info("[RuleLearner] Analysing blocked event (log_id=%s)…", log_id)

    try:
        candidates = await extract_rule_candidates(prompt, response, reason)
    except Exception as exc:
        logger.error("[RuleLearner] extract_rule_candidates raised: %s", exc)
        return

    if not candidates:
        logger.info("[RuleLearner] No high-confidence rule candidates found for log_id=%s.", log_id)
        return

    for candidate in candidates:
        try:
            save_suggested_rule(
                source_log_id=log_id,
                target_field=candidate["target_field"],
                operator=candidate["operator"],
                suggested_value=candidate["suggested_value"],
                description=candidate["description"],
                confidence=candidate["confidence"],
            )
        except Exception as exc:
            logger.error("[RuleLearner] Failed to save candidate %s: %s", candidate, exc)

    logger.info(
        "[RuleLearner] Generated %d suggestion(s) from blocked event (log_id=%s).",
        len(candidates),
        log_id,
    )
