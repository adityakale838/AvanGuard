import os
import uuid
import sqlite3
import json
import asyncio
import httpx
import logging
import math
import re
import secrets
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from starlette.responses import StreamingResponse, JSONResponse

# Import our new semantic LLM guards
from app.core.guards import stage_1_input_guard, stage_3_output_guard
from app.core.ppa import assemble_polymorphic_prompt
from app.db.database import (
    log_audit_event,
    get_all_rules,
    get_pending_suggestions,
    approve_suggestion,
    update_suggestion_status,
    add_to_review_queue,
    get_pending_reviews,
    resolve_review,
    get_metrics,
    DB_NAME,
)
from app.core.rule_learner import process_blocked_event
from app.core.semantic_cache import semantic_cache
from app.core.session_guard import analyse_session, SESSION_STORE, purge_stale_sessions
from app.core.canary import canary_manager
from app.core.rate_limiter import request_limiter
from app.core.normaliser import normalise_and_assess

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

# ---------------------------------------------------------------------------
# Admin API key authentication
# ---------------------------------------------------------------------------
ADMIN_API_KEY = os.getenv("AVANGUARD_ADMIN_KEY", "dev-insecure-key-change-me")
api_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)


async def require_admin(key: str = Depends(api_key_header)):
    """Dependency that enforces admin API key auth for protected endpoints."""
    if not key or not secrets.compare_digest(key, ADMIN_API_KEY):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing admin API key. Set X-Admin-Key header.",
        )


logger = logging.getLogger("avanguard")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="AvanGuard Semantic Pipeline")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_API_URL = "http://localhost:11434/v1/chat/completions"

CACHE_INDEX_PATH = "data/cache.faiss"

# ---------------------------------------------------------------------------
# Confidence thresholds for ambiguous guard decisions
# ---------------------------------------------------------------------------
# A block whose confidence falls in (REVIEW_THRESHOLD_LOW, REVIEW_THRESHOLD_HIGH)
# is placed in the human review queue instead of being hard-rejected.
REVIEW_THRESHOLD_LOW  = 0.45   # below this → too uncertain, treat as queued
REVIEW_THRESHOLD_HIGH = 0.75   # at/above this → confident block → 403 immediately

# ---------------------------------------------------------------------------
# Input / output size limits — resource exhaustion protection
# ---------------------------------------------------------------------------
MAX_INPUT_CHARS      = 8_000   # ~2000 tokens; beyond this is suspicious for a support bot
MAX_MESSAGES         = 20      # max conversation turns accepted
MAX_SINGLE_MSG_CHARS = 4_000  # single message hard cap
MAX_SYSTEM_MSG_CHARS = 2_000  # system message cap
MAX_OUTPUT_CHARS     = 4_000  # truncate LLM output beyond this


class NewBusinessRule(BaseModel):
    target_field: str
    operator: str
    rule_value: float
    description: str


class ChatRequest(BaseModel):
    model: str
    messages: list
    class Config:
        extra = "allow"


# ---------------------------------------------------------------------------
# Input validation helper
# ---------------------------------------------------------------------------

def validate_request_shape(chat_request: ChatRequest) -> None:
    """Validate structural and size constraints on the incoming chat request.

    Raises HTTPException(400) on any violation so that malformed or
    oversized payloads are rejected before any expensive computation.
    """
    messages = chat_request.messages

    # 1. Too many messages
    if len(messages) > MAX_MESSAGES:
        raise HTTPException(status_code=400, detail="Too many messages in context")

    system_count = 0
    total_chars = 0

    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")

        # 4. Invalid role
        if role not in ("user", "assistant", "system"):
            raise HTTPException(status_code=400, detail="Invalid message role")

        # 5. Non-string content (multimodal injection attempt)
        if not isinstance(content, str):
            raise HTTPException(status_code=400, detail="Invalid message content type")

        # 2. Single message exceeds hard cap
        if role == "system":
            system_count += 1
            if len(content) > MAX_SYSTEM_MSG_CHARS:
                raise HTTPException(status_code=400, detail="Message exceeds character limit")
        elif len(content) > MAX_SINGLE_MSG_CHARS:
            raise HTTPException(status_code=400, detail="Message exceeds character limit")

        total_chars += len(content)

    # 3. Total characters across all messages
    if total_chars > MAX_INPUT_CHARS:
        raise HTTPException(status_code=400, detail="Total input exceeds character limit")

    # 6. Conversation must not start with an assistant turn
    if messages and messages[0].get("role") == "assistant":
        raise HTTPException(status_code=400, detail="Conversation must start with user or system")

    # 7. Only one system message allowed
    if system_count > 1:
        raise HTTPException(status_code=400, detail="Multiple system messages not permitted")


@app.on_event("startup")
async def startup_event():
    """On startup, load the persisted FAISS cache and start background cleanup."""
    if os.path.exists(CACHE_INDEX_PATH):
        try:
            semantic_cache.load_index(CACHE_INDEX_PATH)
            print(f"✅ Semantic cache loaded from {CACHE_INDEX_PATH}")
        except Exception as e:
            print(f"⚠️ Could not load semantic cache: {e}")
    else:
        print("ℹ️ No persisted cache found, starting fresh.")

    async def cleanup_loop():
        while True:
            await asyncio.sleep(300)
            request_limiter.cleanup()
            canary_manager.cleanup_expired()
            purge_stale_sessions()

    asyncio.create_task(cleanup_loop())


@app.on_event("shutdown")
async def shutdown_event():
    """On shutdown, persist the FAISS cache to disk."""
    try:
        os.makedirs("data", exist_ok=True)
        semantic_cache.save_index(CACHE_INDEX_PATH)
        print(f"✅ Semantic cache saved to {CACHE_INDEX_PATH}")
    except Exception as e:
        print(f"⚠️ Could not save semantic cache: {e}")


# ---------------------------------------------------------------------------
# Health check — no auth required
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
async def health_check():
    """
    Lightweight liveness + readiness probe.

    Probes Ollama with a HEAD request (no inference) and SQLite with SELECT 1.
    Returns 200 regardless so that load-balancers can always read the body;
    the caller should inspect the field values to decide service health.
    """
    # --- Ollama probe ---
    ollama_status = "unreachable"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.head("http://localhost:11434")
            if r.status_code < 500:
                ollama_status = "reachable"
    except Exception:
        pass

    # --- SQLite probe ---
    db_status = "error"
    try:
        import sqlite3 as _sqlite3
        conn = _sqlite3.connect(DB_NAME, timeout=3.0)
        conn.execute("SELECT 1")
        conn.close()
        db_status = "ok"
    except Exception:
        pass

    return {
        "status": "ok",
        "ollama": ollama_status,
        "db": db_status,
        "cache_entries": semantic_cache.size(),
        "active_sessions": len(SESSION_STORE),
    }

@app.post("/v1/chat/completions")
async def proxy_chat_completions(chat_request: ChatRequest, request: Request):
    audit_masked_input = []

    # Extract session ID for multi-turn tracking (defaults to "default")
    session_id = request.headers.get("X-Session-ID", "default")

    # ==========================================
    # PRE-FLIGHT: Shape & size validation
    # ==========================================
    validate_request_shape(chat_request)

    # ==========================================
    # STAGE -1: INPUT NORMALISATION (Encoding Attack Detection)
    # Must run BEFORE the rate limiter so malicious encoding attacks never
    # consume a rate-limit token and are rejected at the earliest possible point.
    # ==========================================
    latest_user_message = next((m for m in reversed(chat_request.messages) if m.get("role") == "user"), None)
    if not latest_user_message:
        raise HTTPException(status_code=400, detail="No user message found.")

    original_prompt = latest_user_message["content"]

    norm_result = normalise_and_assess(original_prompt)
    normalised_prompt = norm_result["normalised_text"]

    if norm_result["risk_score"] >= 0.7:
        log_audit_event(
            masked_input=[{"role": "user", "content": original_prompt}],
            sanitization_results={
                "redacted": False,
                "details": "Encoding Attack Detected",
                "norm_result": norm_result,
            },
            validation_status={
                "is_valid": False,
                "action_taken": "BLOCKED",
                "reason": f"Encoding attack: {norm_result['encoding_types'] or ['homoglyph']}",
            },
            final_output={"error": "Blocked by Normalisation Layer"},
            total_tokens=0,
        )
        raise HTTPException(
            status_code=403,
            detail=(
                f"Encoding Attack Detected: homoglyph+injection"
                if norm_result["was_homoglyph"] and not norm_result["encoding_types"]
                else f"Encoding Attack Detected: {norm_result['encoding_types']}"
            ),
        )

    # Rebind — all downstream pipeline stages use the normalised prompt
    original_prompt = normalised_prompt

    # ==========================================
    # PRE-FLIGHT: Per-session rate limiting
    # ==========================================
    if not request_limiter.consume(session_id):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Slow down.")

    # ==========================================
    # STAGE 0: THE FAST LANE (Semantic Cache)
    # ==========================================
    cached_response = semantic_cache.check_cache(original_prompt)
    if cached_response:
        # We inject a custom header so the dashboard knows it was lightning fast
        cached_response["avanguard_cache_hit"] = True
        return cached_response

    # ==========================================
    # STAGE 0.5: MULTI-TURN SESSION ANALYSIS
    # ==========================================
    session_result = analyse_session(session_id, original_prompt)
    if session_result["suspicious"]:
        log_audit_event(
            masked_input=[{"role": "user", "content": original_prompt}],
            sanitization_results={
                "redacted": False,
                "details": "Session Guard triggered",
                "drift": session_result["drift"],
                "escalation": session_result["escalation"],
                "norm_result": norm_result,
            },
            validation_status={
                "is_valid": False,
                "action_taken": "BLOCKED",
                "reason": session_result["reason"],
            },
            final_output={"error": "Blocked by Session Guard"},
            total_tokens=0,
        )
        raise HTTPException(
            status_code=403,
            detail=f"Session Guard Blocked: {session_result['reason']}",
        )

    # ==========================================
    # STAGE 1: INPUT GUARD (Semantic Evaluation)
    # ==========================================
    input_eval = await stage_1_input_guard(original_prompt)

    if input_eval.get("action") == "BLOCK":
        confidence = float(input_eval.get("confidence", 1.0))
        reason     = input_eval.get("reason", "")

        if REVIEW_THRESHOLD_LOW < confidence < REVIEW_THRESHOLD_HIGH:
            # Ambiguous — queue for human review instead of hard-blocking
            logger.info(
                "[Stage 1] Ambiguous block (confidence=%.2f) — queuing for review.", confidence
            )
            queue_id = add_to_review_queue(
                session_id=session_id,
                masked_prompt=original_prompt,
                llm_response="",
                guard_stage="input",
                guard_score=confidence,
                guard_reason=reason,
            )
            log_audit_event(
                masked_input=[{"role": "user", "content": original_prompt}],
                sanitization_results={
                    "redacted": False,
                    "details": "Injection Blocked",
                    "drift": session_result["drift"],
                    "escalation": session_result["escalation"],
                    "norm_result": norm_result,
                },
                validation_status={
                    "is_valid": False,
                    "action_taken": "QUEUED_FOR_REVIEW",
                    "reason": reason,
                    "confidence": confidence,
                },
                final_output={"queued": True, "review_id": queue_id},
                total_tokens=0,
            )
            return JSONResponse(
                status_code=202,
                content={
                    "status": "queued_for_review",
                    "message": "Your request is pending security review.",
                    "review_id": queue_id,
                },
            )

        # High-confidence block — reject immediately
        log_audit_event(
            masked_input=[{"role": "user", "content": original_prompt}],
            sanitization_results={
                "redacted": False,
                "details": "Injection Blocked",
                "drift": session_result["drift"],
                "escalation": session_result["escalation"],
                "norm_result": norm_result,
            },
            validation_status={
                "is_valid": False,
                "action_taken": "BLOCKED",
                "reason": reason,
                "confidence": confidence,
            },
            final_output={"error": "Blocked by Stage 1 Input Guard"},
            total_tokens=0,
        )
        raise HTTPException(status_code=403, detail=f"Input Guard Blocked: {reason}")
    
    # Apply sanitization if PII was semantically detected
    safe_prompt = input_eval.get("sanitized_prompt", original_prompt)
    for message in chat_request.messages:
        if message.get("role") == "user":
            message["content"] = safe_prompt
            audit_masked_input.append(message)

    # ==========================================
    # CANARY INJECTION (after Stage 1 passes)
    # ==========================================
    request_id = str(uuid.uuid4())
    canary_id, canary_phrase = canary_manager.generate_canary(session_id, request_id)
    payload = chat_request.dict()

    # PPA — Polymorphic Prompt Assembling (Stage 1 defence layer)
    payload["messages"], ppa_index = assemble_polymorphic_prompt(payload["messages"])
    print(f"\U0001f500 PPA: Using system prompt variant #{ppa_index}")

    # Inject canary into the system message (if one exists)
    for msg in payload["messages"]:
        if msg.get("role") == "system":
            msg["content"] = canary_manager.inject_into_system_prompt(msg["content"], canary_phrase)
            break

    # ==========================================
    # STAGE 2: MAIN LLM GENERATION
    # ==========================================
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(OLLAMA_API_URL, json=payload)
            response.raise_for_status()
            llm_response_data = response.json()
        except httpx.TimeoutException:
            log_audit_event(
                masked_input=audit_masked_input,
                sanitization_results={"error": "main_llm_timeout"},
                validation_status={"is_valid": False, "action_taken": "LLM_UNAVAILABLE"},
                final_output={"error": "LLM timeout"},
                total_tokens=0,
            )
            raise HTTPException(status_code=503, detail="LLM service timeout. Please retry.")
        except httpx.RequestError as exc:
            log_audit_event(
                masked_input=audit_masked_input,
                sanitization_results={"error": "main_llm_connection_error"},
                validation_status={"is_valid": False, "action_taken": "LLM_UNAVAILABLE"},
                final_output={"error": str(exc)},
                total_tokens=0,
            )
            raise HTTPException(status_code=503, detail=f"LLM service unavailable: {exc}")
        
    llm_output_text = llm_response_data.get("choices", [{}])[0].get("message", {}).get("content", "")

    # ==========================================
    # OUTPUT TRUNCATION (resource exhaustion protection)
    # ==========================================
    if len(llm_output_text) > MAX_OUTPUT_CHARS:
        llm_output_text = llm_output_text[:MAX_OUTPUT_CHARS] + "\n\n[Output truncated by AvanGuard]"
        # Patch the truncated text back into the response object so
        # downstream stages and the final return all see the same value.
        if llm_response_data.get("choices"):
            llm_response_data["choices"][0].setdefault("message", {})["content"] = llm_output_text

    # ==========================================
    # CANARY LEAK CHECK (after Stage 2)
    # ==========================================
    canary_response_headers = {}
    canary_check = canary_manager.verify_canary(llm_output_text)
    if canary_check["detected"]:
        logger.warning(
            "[AUDIT] action=CANARY_LEAK canary_id=%s session_id=%s request_id=%s",
            canary_check["canary_id"],
            session_id,
            request_id,
        )
        canary_response_headers["X-AvanGuard-Canary-Leak"] = "true"
        log_audit_event(
            masked_input=audit_masked_input,
            sanitization_results={
                "redacted": input_eval.get("action") == "SANITIZE",
                "details": "Canary leak detected in LLM output",
                "drift": session_result["drift"],
                "escalation": session_result["escalation"],
                "norm_result": norm_result,
            },
            validation_status={
                "is_valid": True,
                "action_taken": "CANARY_LEAK_FLAGGED",
                "reason": "LLM echoed canary watermark — flagged for admin review",
            },
            final_output=llm_response_data,
            total_tokens=llm_response_data.get("eval_count", 0),
            canary_id=canary_id,
        )

    # ==========================================
    # STAGE 3: OUTPUT GUARD (Semantic Evaluation)
    # ==========================================
    active_rules = get_all_rules()
    output_eval = await stage_3_output_guard(safe_prompt, llm_output_text, active_rules)
    
    if output_eval.get("action") == "BLOCK":
        confidence = float(output_eval.get("confidence", 1.0))
        reason     = output_eval.get("reason", "")

        if REVIEW_THRESHOLD_LOW < confidence < REVIEW_THRESHOLD_HIGH:
            # Ambiguous output block — queue for human review
            logger.info(
                "[Stage 3] Ambiguous block (confidence=%.2f) — queuing for review.", confidence
            )
            queue_id = add_to_review_queue(
                session_id=session_id,
                masked_prompt=safe_prompt,
                llm_response=llm_output_text,
                guard_stage="output",
                guard_score=confidence,
                guard_reason=reason,
            )
            log_audit_event(
                masked_input=audit_masked_input,
                sanitization_results={
                    "redacted": input_eval.get("action") == "SANITIZE",
                    "details": "Evaluated semantically",
                    "norm_result": norm_result,
                },
                validation_status={
                    "is_valid": False,
                    "action_taken": "QUEUED_FOR_REVIEW",
                    "reason": reason,
                    "confidence": confidence,
                },
                final_output={"queued": True, "review_id": queue_id},
                total_tokens=0,
                canary_id=canary_id,
            )
            return JSONResponse(
                status_code=202,
                content={
                    "status": "queued_for_review",
                    "message": "Your request is pending security review.",
                    "review_id": queue_id,
                },
            )

        # High-confidence block — reject immediately and learn from it
        blocked_log_id = log_audit_event(
            masked_input=audit_masked_input,
            sanitization_results={
                "redacted": input_eval.get("action") == "SANITIZE",
                "details": "Evaluated semantically",
                "norm_result": norm_result,
            },
            validation_status={
                "is_valid": False,
                "action_taken": "BLOCKED",
                "reason": reason,
                "confidence": confidence,
            },
            final_output={"error": "Blocked by Stage 3 Output Guard"},
            total_tokens=0,
            canary_id=canary_id,
        )
        # Fire-and-forget — don't await, don't block the response
        async def _safe_process_blocked(log_id, prompt, response, reason):
            try:
                await process_blocked_event(log_id, prompt, response, reason)
            except Exception as e:
                print(f"[RULE_LEARNER] Failed to process blocked event: {e}")

        asyncio.create_task(_safe_process_blocked(blocked_log_id, safe_prompt, llm_output_text, reason))
        raise HTTPException(status_code=403, detail=f"Output Guard Blocked: {reason}")

    # ==========================================
    # STAGE 4: PASSED & LOGGED
    # ==========================================
    # Only log PASSED if we didn't already log a canary-leak event above
    if not canary_check["detected"]:
        log_audit_event(
            masked_input=audit_masked_input,
            sanitization_results={
                "redacted": input_eval.get("action") == "SANITIZE",
                "details": "Evaluated semantically",
                "drift": session_result["drift"],
                "escalation": session_result["escalation"],
                "norm_result": norm_result,
            },
            validation_status={"is_valid": True, "action_taken": "PASSED", "reason": "Cleared all semantic guards"},
            final_output=llm_response_data,
            total_tokens=llm_response_data.get("eval_count", 0),
            canary_id=canary_id,
        )

    semantic_cache.add_to_cache(safe_prompt, llm_response_data)

    return JSONResponse(content=llm_response_data, headers=canary_response_headers)

# ... [Keep your existing Admin API Endpoints exactly as they were below here] ...

# ==========================================
# ADMIN DASHBOARD ENDPOINTS
# ==========================================

_VALID_TARGET_FIELD = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_ALLOWED_OPERATORS  = {"<=", ">=", "<", ">", "==", "!="}


@app.post("/api/admin/rules", status_code=201, dependencies=[Depends(require_admin)])
async def create_business_rule(rule: NewBusinessRule):
    """Allows the company to add a new dynamic rule."""
    # --- Input validation (prevent SQL injection / bad data) ---
    if not _VALID_TARGET_FIELD.match(rule.target_field):
        raise HTTPException(
            status_code=400,
            detail="target_field must match ^[a-zA-Z_][a-zA-Z0-9_]{0,63}$",
        )
    if rule.operator not in _ALLOWED_OPERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"operator must be one of {sorted(_ALLOWED_OPERATORS)}",
        )
    if not math.isfinite(rule.rule_value):
        raise HTTPException(
            status_code=400,
            detail="rule_value must be a finite float (not NaN or Inf)",
        )
    description = rule.description.strip()
    if len(description) > 500:
        raise HTTPException(
            status_code=400,
            detail="description must not exceed 500 characters",
        )

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO business_rules (target_field, operator, rule_value, description)
            VALUES (?, ?, ?, ?)
        """, (rule.target_field, rule.operator, rule.rule_value, description))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    conn.close()
    return {"message": "Rule successfully added to AvanGuard."}

@app.get("/api/admin/rules", dependencies=[Depends(require_admin)])
async def get_active_rules():
    """Returns all active rules so the React dashboard can display them."""
    return {"active_rules": get_all_rules()}

@app.delete("/api/admin/rules/{rule_id}", dependencies=[Depends(require_admin)])
async def delete_business_rule(rule_id: int):
    """Allows the company to remove an outdated rule."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM business_rules WHERE id = ?", (rule_id,))
    conn.commit()
    conn.close()
    return {"message": f"Rule {rule_id} deleted."}


@app.get("/api/admin/sessions", dependencies=[Depends(require_admin)])
async def get_session_scores():
    """
    Returns all active session IDs together with their current drift and
    escalation scores.  Intended for the AvanGuard admin dashboard so operators
    can monitor conversation trajectories in real time.
    """
    sessions = []
    for sid, mem in SESSION_STORE.items():
        sessions.append({
            "session_id": sid,
            "turns": len(mem.turn_texts),
            "drift": mem.compute_drift_score(),
            "escalation": mem.compute_escalation_score(),
            "suspicious": mem.is_suspicious()[0],
            "reason": mem.is_suspicious()[1],
        })
    return {"sessions": sessions}


# Fields emitted over SSE — deliberately excludes `masked_input` and
# `final_output` which may carry PII or full LLM response JSON.
_SSE_SAFE_FIELDS = [
    "id",
    "timestamp",
    "sanitization_results",
    "validation_status",
    "total_tokens",
    "hallucination_score",
]


@app.get("/api/admin/logs/stream", dependencies=[Depends(require_admin)])
async def stream_audit_logs(request: Request):
    """Streams live logs to the dashboard using Server-Sent Events (SSE).

    Only the fields listed in ``_SSE_SAFE_FIELDS`` are emitted; ``masked_input``
    and ``final_output`` are intentionally excluded to avoid leaking PII
    metadata or raw LLM response JSON to the dashboard stream.
    """
    async def event_generator():
        while True:
            # Drop the connection if the browser closes
            if await request.is_disconnected():
                break

            conn = sqlite3.connect(DB_NAME)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, timestamp, sanitization_results, validation_status, "
                "total_tokens, hallucination_score "
                "FROM audit_logs ORDER BY timestamp DESC LIMIT 50"
            )
            columns = [column[0] for column in cursor.description]
            logs = [dict(zip(columns, row)) for row in cursor.fetchall()]
            conn.close()

            yield f"data: {json.dumps(logs)}\n\n"

            # Control the refresh rate
            await asyncio.sleep(2)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ==========================================
# CANARY TOKEN ENDPOINT
# ==========================================

class CanaryVerifyRequest(BaseModel):
    text: str


@app.post("/api/admin/verify-canary", dependencies=[Depends(require_admin)])
async def verify_canary_token(body: CanaryVerifyRequest):
    """
    Allows security teams to check whether a document or blob of text
    contains an AvanGuard canary watermark, indicating potential prompt
    exfiltration.  Submit the suspected text and the response will indicate
    which canary token (if any) was found and which session it belongs to.
    """
    result = canary_manager.verify_canary(body.text)
    return result


# ==========================================
# ADAPTIVE RULE SUGGESTION ENDPOINTS
# ==========================================

@app.get("/api/admin/suggestions", dependencies=[Depends(require_admin)])
async def get_rule_suggestions():
    """
    Returns all pending rule suggestions generated by the adaptive rule
    learner.  Each suggestion was extracted from a blocked LLM response and
    is awaiting admin review.
    """
    return {"suggestions": get_pending_suggestions()}


@app.post("/api/admin/suggestions/{suggestion_id}/approve", status_code=200, dependencies=[Depends(require_admin)])
async def approve_rule_suggestion(suggestion_id: int):
    """
    Promotes a pending suggestion to an active business rule and marks it as
    'approved'.  Returns 404 if the suggestion does not exist.
    """
    promoted = approve_suggestion(suggestion_id)
    if not promoted:
        raise HTTPException(status_code=404, detail=f"Suggestion {suggestion_id} not found.")
    return {"message": f"Suggestion {suggestion_id} approved and added to active business rules."}


@app.post("/api/admin/suggestions/{suggestion_id}/reject", status_code=200, dependencies=[Depends(require_admin)])
async def reject_rule_suggestion(suggestion_id: int):
    """
    Marks a pending suggestion as 'rejected' so it is excluded from future
    pending lists without being promoted to an active rule.
    """
    update_suggestion_status(suggestion_id, "rejected")
    return {"message": f"Suggestion {suggestion_id} rejected."}


# ==========================================
# HUMAN REVIEW QUEUE ENDPOINTS
# ==========================================

class ReviewDecisionRequest(BaseModel):
    reviewer: str = "admin"


@app.get("/api/admin/review-queue", dependencies=[Depends(require_admin)])
async def get_review_queue():
    """
    Returns all items in the human review queue that are still pending.
    Each entry is a guard decision the system was too uncertain to resolve
    automatically (confidence between 0.45 and 0.75).
    """
    return {"reviews": get_pending_reviews()}


@app.post("/api/admin/review-queue/{review_id}/approve", status_code=200, dependencies=[Depends(require_admin)])
async def approve_review(review_id: int, body: ReviewDecisionRequest):
    """
    Mark a queued guard decision as 'approved', meaning the original request
    was safe and the guard made a false positive.  This resolution is counted
    in the false-positive rate shown on the metrics dashboard.
    """
    resolve_review(review_id, "approved", body.reviewer)
    logger.info("[ReviewQueue] id=%s approved (false positive) by %s", review_id, body.reviewer)
    return {"message": f"Review {review_id} approved (false positive logged)."}


@app.post("/api/admin/review-queue/{review_id}/reject", status_code=200, dependencies=[Depends(require_admin)])
async def reject_review(review_id: int, body: ReviewDecisionRequest):
    """
    Mark a queued guard decision as 'rejected', confirming the block was
    correct.  The item is removed from the pending list.
    """
    resolve_review(review_id, "rejected", body.reviewer)
    logger.info("[ReviewQueue] id=%s rejected (block confirmed) by %s", review_id, body.reviewer)
    return {"message": f"Review {review_id} rejected (block confirmed)."}


# ==========================================
# METRICS ENDPOINT
# ==========================================

@app.get("/api/admin/metrics", dependencies=[Depends(require_admin)])
async def get_dashboard_metrics():
    """
    Returns summary statistics that power the admin dashboard cards:
    total requests, blocked counts per stage, items in the review queue,
    false-positive rate (approved reviews / total resolved), and cache-hit rate.
    """
    return get_metrics()