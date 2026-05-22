import sqlite3
from datetime import datetime
import json

# DB_NAME = "avanguard.db"
import os
import sqlite3

# Dynamically point to the data/ folder at the root of the project
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_NAME = os.path.join(BASE_DIR, "data", "avanguard.db")

def init_db():
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()

        # Redesigned table for dynamic evaluation
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS business_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_field TEXT NOT NULL,
                operator TEXT NOT NULL,
                rule_value REAL NOT NULL,
                description TEXT
            )
        """)

        # Seed the database with a dynamic rule (can be updated later via API)
        # This reads: "The field 'proposed_refund_amount' must be <= 50.00"
        cursor.execute("SELECT COUNT(*) FROM business_rules")
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO business_rules (target_field, operator, rule_value, description)
                VALUES ('proposed_refund_amount', '<=', 50.00, 'Max automatic refund')
            """)

            # You could easily add more rules here for other fields
            # VALUES ('discount_percentage', '<=', 15.00, 'Max promo discount')

        # 2. NEW: Audit Logs Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                masked_input TEXT,
                sanitization_results TEXT,
                validation_status TEXT,
                final_output TEXT,
                total_tokens INTEGER
            )
        """)

        # 3. Migration: add canary_id column if it doesn't exist yet
        try:
            cursor.execute("ALTER TABLE audit_logs ADD COLUMN canary_id TEXT")
        except Exception:
            # Column already exists — safe to ignore
            pass

        # 4. Suggested rules table for adaptive rule learning
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS suggested_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                source_log_id INTEGER,
                target_field TEXT,
                operator TEXT,
                suggested_value REAL,
                description TEXT,
                confidence REAL,
                status TEXT DEFAULT 'pending'
            )
        """)

        # 5. Human review queue for ambiguous guard decisions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS review_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                session_id TEXT,
                masked_prompt TEXT,
                llm_response TEXT,
                guard_stage TEXT,
                guard_score REAL,
                guard_reason TEXT,
                status TEXT DEFAULT 'pending',
                reviewed_by TEXT,
                reviewed_at DATETIME
            )
        """)

        conn.commit()
    except Exception as e:
        print(f"[DB] init_db failed: {e}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def get_all_rules() -> list:
    """Fetches all active business rules for dynamic evaluation."""
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()
        # Ensure 'id' and 'description' are selected!
        cursor.execute("SELECT id, target_field, operator, rule_value, description FROM business_rules")
        rules = cursor.fetchall()
        return [{"id": r[0], "field": r[1], "operator": r[2], "value": r[3], "description": r[4]} for r in rules]
    except Exception as e:
        print(f"[DB] Read failed (get_all_rules): {e}")
        return []
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def log_audit_event(
    masked_input: list,
    sanitization_results: dict,
    validation_status: dict,
    final_output: dict,
    total_tokens: int,
    canary_id: str = None,
) -> int:
    """Writes a complete request lifecycle to the audit log. Returns the inserted row ID.

    Never raises — a failed audit write must not crash a user request.
    Returns -1 if the write fails.
    """
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO audit_logs
                (masked_input, sanitization_results, validation_status, final_output, total_tokens, canary_id)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            json.dumps(masked_input),
            json.dumps(sanitization_results),
            json.dumps(validation_status),
            json.dumps(final_output),
            total_tokens,
            canary_id,
        ))

        last_id = cursor.lastrowid
        conn.commit()
        return last_id
    except Exception as e:
        print(f"[AUDIT] Failed to write audit log: {e}")
        return -1
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def save_suggested_rule(
    source_log_id: int,
    target_field: str,
    operator: str,
    suggested_value: float,
    description: str,
    confidence: float,
) -> int:
    """Inserts a candidate rule into the suggested_rules table. Returns the inserted row ID.

    Never raises — a failed write is logged but does not crash the caller.
    Returns -1 if the write fails.
    """
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO suggested_rules
                (source_log_id, target_field, operator, suggested_value, description, confidence)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (source_log_id, target_field, operator, suggested_value, description, confidence))
        last_id = cursor.lastrowid
        conn.commit()
        return last_id
    except Exception as e:
        print(f"[DB] Failed to save suggested rule: {e}")
        return -1
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def get_pending_suggestions() -> list:
    """Returns all pending suggested rules ordered by confidence descending."""
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, created_at, source_log_id, target_field, operator,
                   suggested_value, description, confidence, status
            FROM suggested_rules
            WHERE status = 'pending'
            ORDER BY confidence DESC
        """)
        columns = [c[0] for c in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return rows
    except Exception as e:
        print(f"[DB] Read failed (get_pending_suggestions): {e}")
        return []
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def update_suggestion_status(suggestion_id: int, status: str) -> None:
    """Updates the status field of a suggested rule. Never raises."""
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE suggested_rules SET status = ? WHERE id = ?",
            (status, suggestion_id),
        )
        conn.commit()
    except Exception as e:
        print(f"[DB] Failed to update suggestion status: {e}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def approve_suggestion(suggestion_id: int) -> bool:
    """
    Fetches a pending suggestion, promotes it to the business_rules table,
    and marks it as 'approved'.  Returns True if the rule was promoted,
    False if the suggestion was not found or on error.
    """
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT target_field, operator, suggested_value, description FROM suggested_rules WHERE id = ?",
            (suggestion_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return False

        target_field, operator, suggested_value, description = row

        cursor.execute("""
            INSERT INTO business_rules (target_field, operator, rule_value, description)
            VALUES (?, ?, ?, ?)
        """, (target_field, operator, suggested_value, description))

        cursor.execute(
            "UPDATE suggested_rules SET status = 'approved' WHERE id = ?",
            (suggestion_id,),
        )

        conn.commit()
        return True
    except Exception as e:
        print(f"[DB] Failed to approve suggestion {suggestion_id}: {e}")
        return False
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def add_to_review_queue(
    session_id: str,
    masked_prompt: str,
    llm_response: str,
    guard_stage: str,
    guard_score: float,
    guard_reason: str,
) -> int:
    """Inserts an ambiguous guard decision into the human review queue.

    Returns the new row ID, or -1 if the write fails.
    Never raises.
    """
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO review_queue
                (session_id, masked_prompt, llm_response, guard_stage, guard_score, guard_reason)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (session_id, masked_prompt, llm_response, guard_stage, guard_score, guard_reason))
        last_id = cursor.lastrowid
        conn.commit()
        return last_id
    except Exception as e:
        print(f"[DB] Failed to add to review queue: {e}")
        return -1
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def get_pending_reviews() -> list:
    """Returns all review_queue rows where status = 'pending', newest first."""
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, created_at, session_id, masked_prompt, llm_response,
                   guard_stage, guard_score, guard_reason, status, reviewed_by, reviewed_at
            FROM review_queue
            WHERE status = 'pending'
            ORDER BY created_at DESC
        """)
        columns = [c[0] for c in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return rows
    except Exception as e:
        print(f"[DB] Read failed (get_pending_reviews): {e}")
        return []
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def resolve_review(review_id: int, decision: str, reviewer: str) -> None:
    """Sets the status, reviewed_by, and reviewed_at of a review_queue row. Never raises."""
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE review_queue
            SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (decision, reviewer, review_id))
        conn.commit()
    except Exception as e:
        print(f"[DB] Failed to resolve review {review_id}: {e}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def get_metrics() -> dict:
    """
    Queries audit_logs and review_queue to produce dashboard summary metrics.
    Returns total_requests, blocked_input, blocked_output, queued_for_review,
    false_positive_rate, and cache_hit_rate.

    Returns empty/zero metrics dict on DB error.
    """
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0)
        cursor = conn.cursor()

        # Total requests proxied (every audit log row is one request)
        cursor.execute("SELECT COUNT(*) FROM audit_logs")
        total_requests = cursor.fetchone()[0]

        # Blocked at Stage 1 (input guard)
        cursor.execute("""
            SELECT COUNT(*) FROM audit_logs
            WHERE json_extract(validation_status, '$.action_taken') = 'BLOCKED'
              AND json_extract(sanitization_results, '$.details') = 'Injection Blocked'
        """)
        blocked_input = cursor.fetchone()[0]

        # Blocked at Stage 3 (output guard)
        cursor.execute("""
            SELECT COUNT(*) FROM audit_logs
            WHERE json_extract(validation_status, '$.action_taken') = 'BLOCKED'
              AND json_extract(sanitization_results, '$.details') = 'Evaluated semantically'
        """)
        blocked_output = cursor.fetchone()[0]

        # Queued for human review
        cursor.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'pending'")
        queued_for_review = cursor.fetchone()[0]

        # False-positive rate: approved reviews / total reviews resolved
        cursor.execute("SELECT COUNT(*) FROM review_queue WHERE status IN ('approved', 'rejected')")
        total_resolved = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'approved'")
        total_approved = cursor.fetchone()[0]  # approved = guard was wrong (false positive)
        false_positive_rate = round(total_approved / total_resolved, 4) if total_resolved > 0 else 0.0

        # Cache-hit rate: rows with action_taken = CACHE_HIT vs total
        cursor.execute("""
            SELECT COUNT(*) FROM audit_logs
            WHERE json_extract(validation_status, '$.action_taken') = 'CACHE_HIT'
        """)
        cache_hits = cursor.fetchone()[0]
        cache_hit_rate = round(cache_hits / total_requests, 4) if total_requests > 0 else 0.0

        return {
            "total_requests": total_requests,
            "blocked_input": blocked_input,
            "blocked_output": blocked_output,
            "queued_for_review": queued_for_review,
            "false_positive_rate": false_positive_rate,
            "cache_hit_rate": cache_hit_rate,
        }
    except Exception as e:
        print(f"[DB] Read failed (get_metrics): {e}")
        return {
            "total_requests": 0,
            "blocked_input": 0,
            "blocked_output": 0,
            "queued_for_review": 0,
            "false_positive_rate": 0.0,
            "cache_hit_rate": 0.0,
        }
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


init_db()
