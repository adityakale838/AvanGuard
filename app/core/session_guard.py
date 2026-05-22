"""
session_guard.py — Multi-turn Crescendo Jailbreak Analyser
===========================================================
Defends against Crescendo-style gradual jailbreak attacks by tracking
conversation trajectory across turns using semantic embeddings.

Two signals are computed:
  • Drift Score   — cosine distance between the FIRST and LAST turn.
                    A big jump in topic indicates the user steered the
                    conversation far from the starting point.
  • Escalation    — variance of sequential cosine similarities between
                    consecutive turns.  Erratic topic hopping is a
                    tell-tale Crescendo signature.
"""

from __future__ import annotations

import time
import numpy as np
from collections import deque
from typing import Dict, Tuple

from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# Model — loaded once at import time.
# HuggingFace caches the weights locally (~80 MB) so subsequent loads are
# instant.  We intentionally load independently of semantic_cache.py to keep
# the two modules decoupled.
# ---------------------------------------------------------------------------
print("⏳ Loading Session Guard embedding model (all-MiniLM-L6-v2)…")
_model = SentenceTransformer("all-MiniLM-L6-v2")
print("✅ Session Guard model ready.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Return the cosine similarity between two 1-D normalised vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0.0 or norm_b == 0.0:
        return 1.0  # treat zero-vector as identical (edge case)
    return float(np.dot(a, b) / (norm_a * norm_b))


# ---------------------------------------------------------------------------
# SessionMemory
# ---------------------------------------------------------------------------

class SessionMemory:
    """
    Maintains a rolling window of turn embeddings for a single session and
    exposes drift / escalation scores used to flag Crescendo attacks.
    """

    def __init__(self, session_id: str, window: int = 8) -> None:
        self.session_id = session_id
        self.created_at: float = time.time()  # wall-clock creation time for eviction ordering
        # Only keep the most recent `window` embeddings so memory is bounded
        self.turn_embeddings: deque = deque(maxlen=window)
        self.turn_texts: list[str] = []

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    def add_turn(self, text: str) -> None:
        """Encode *text* and append the resulting vector to the rolling window."""
        vector: np.ndarray = _model.encode(text, convert_to_numpy=True)
        self.turn_embeddings.append(vector)
        self.turn_texts.append(text)

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    def compute_drift_score(self) -> float:
        """
        Cosine distance between the FIRST and LAST turn embeddings.

        Returns
        -------
        float
            0.0  → no drift (topics are identical)
            1.0  → maximum drift (completely orthogonal topics)
        """
        if len(self.turn_embeddings) < 3:
            return 0.0

        embeddings = list(self.turn_embeddings)
        first = embeddings[0]
        last = embeddings[-1]
        similarity = _cosine_similarity(first, last)
        return float(1.0 - similarity)

    def compute_escalation_score(self) -> float:
        """
        Variance of sequential cosine similarities between consecutive turns.

        High variance → the conversation is jumping topics erratically,
        which is the fingerprint of a Crescendo gradual-jailbreak attempt.

        Returns
        -------
        float
            Variance of the pairwise similarity sequence (≥ 0).
        """
        embeddings = list(self.turn_embeddings)
        if len(embeddings) < 2:
            return 0.0

        sequential_sims = [
            _cosine_similarity(embeddings[i], embeddings[i + 1])
            for i in range(len(embeddings) - 1)
        ]
        return float(np.var(sequential_sims))

    # ------------------------------------------------------------------
    # Decision
    # ------------------------------------------------------------------

    def is_suspicious(
        self,
        drift_threshold: float = 0.65,
        escalation_threshold: float = 0.08,
    ) -> Tuple[bool, str]:
        """
        Evaluate whether this session looks like a Crescendo attack.

        Parameters
        ----------
        drift_threshold : float
            Drift score above which the session is flagged (default 0.65).
        escalation_threshold : float
            Escalation variance above which the session is flagged (default 0.08).

        Returns
        -------
        (suspicious: bool, reason: str)
        """
        score = self.compute_drift_score()
        if score > drift_threshold:
            return True, f"Topic drift detected (score: {score:.2f})"

        var = self.compute_escalation_score()
        if var > escalation_threshold:
            return True, f"Erratic topic escalation detected (variance: {var:.2f})"

        return False, ""


# ---------------------------------------------------------------------------
# Module-level session store
# ---------------------------------------------------------------------------

SESSION_STORE: Dict[str, SessionMemory] = {}


def get_or_create_session(session_id: str) -> SessionMemory:
    """Return the existing :class:`SessionMemory` for *session_id*, or create one."""
    if session_id not in SESSION_STORE:
        SESSION_STORE[session_id] = SessionMemory(session_id)
    return SESSION_STORE[session_id]


# ---------------------------------------------------------------------------
# Session store maintenance
# ---------------------------------------------------------------------------

_SESSION_STORE_CAP = 10_000   # hard upper bound on in-memory sessions
_SESSION_EVICT_COUNT = 1_000  # how many to evict when cap is hit


def purge_stale_sessions() -> None:
    """Remove empty sessions and enforce the SESSION_STORE cap.

    Called periodically by the startup cleanup loop in main.py.
    """
    # 1. Remove sessions that have never had a turn (no embeddings yet)
    stale = [
        sid for sid, sess in SESSION_STORE.items()
        if not sess.turn_embeddings
    ]
    for sid in stale:
        del SESSION_STORE[sid]

    # 2. If we're still over the cap, evict the oldest sessions by created_at
    if len(SESSION_STORE) > _SESSION_STORE_CAP:
        oldest_sids = sorted(
            SESSION_STORE.keys(),
            key=lambda sid: SESSION_STORE[sid].created_at,
        )[:_SESSION_EVICT_COUNT]
        for sid in oldest_sids:
            del SESSION_STORE[sid]
        print(
            f"[SESSION_GUARD] Cap enforced: evicted {len(oldest_sids)} oldest sessions. "
            f"Store size: {len(SESSION_STORE)}"
        )


# ---------------------------------------------------------------------------
# Public analyser
# ---------------------------------------------------------------------------

def analyse_session(session_id: str, new_message: str) -> dict:
    """
    Add *new_message* to the session window and evaluate for Crescendo signals.

    Parameters
    ----------
    session_id : str
        Opaque identifier for the conversation (e.g. from ``X-Session-ID`` header).
    new_message : str
        The latest user turn text.

    Returns
    -------
    dict with keys:
        suspicious  – bool
        reason      – str (empty string when not suspicious)
        drift       – float  (0 → 1, higher = more drifted)
        escalation  – float  (variance, higher = more erratic)
    """
    session = get_or_create_session(session_id)
    session.add_turn(new_message)

    suspicious, reason = session.is_suspicious()

    return {
        "suspicious": suspicious,
        "reason": reason,
        "drift": session.compute_drift_score(),
        "escalation": session.compute_escalation_score(),
    }
