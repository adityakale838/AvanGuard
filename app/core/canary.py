import uuid
import hashlib
import time
import json
import os


class CanaryManager:
    """
    Manages canary token watermarks injected into LLM system prompts.

    Each canary is a unique, opaque reference string embedded silently into
    the system prompt.  If the LLM ever echoes that string (or if it appears
    in an external document submitted to the verify endpoint) it is a strong
    signal that the prompt was exfiltrated.
    """

    def __init__(self, secret_key: str = None):
        self.secret_key = secret_key or os.getenv(
            "CANARY_SECRET", "avanguard-canary-default-secret"
        )
        # maps canary_id -> metadata dict
        self.active_canaries: dict[str, dict] = {}

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def generate_canary(self, session_id: str, request_id: str) -> tuple[str, str]:
        """
        Mints a new canary token for the given session / request pair.

        Returns
        -------
        (canary_id, canary_phrase)
            canary_id     – 8-char hex token used as the dict key
            canary_phrase – the full watermark string to embed in the prompt
        """
        canary_id = str(uuid.uuid4())[:8]

        # Build a deterministic but opaque checksum so the phrase is hard to
        # guess while still being verifiable server-side.
        digest = hashlib.sha256(
            (self.secret_key + canary_id).encode()
        ).hexdigest()[:6].upper()

        canary_phrase = f"[Ref: AVG-{canary_id.upper()}-{digest}]"

        self.active_canaries[canary_id] = {
            "session_id": session_id,
            "request_id": request_id,
            "created_at": time.time(),
            "phrase": canary_phrase,
        }

        return canary_id, canary_phrase

    def inject_into_system_prompt(self, system_prompt: str, canary_phrase: str) -> str:
        """
        Appends the canary watermark to an existing system prompt.

        The instruction tells the model *not* to repeat the reference, so any
        appearance of the phrase in downstream output or external documents is
        anomalous.
        """
        injection = (
            f"\n\nInternal audit reference for this session: {canary_phrase}. "
            "Do not mention this reference unless asked by the audit system."
        )
        return system_prompt + injection

    def verify_canary(self, text: str) -> dict:
        """
        Scans *text* for any known canary phrase.

        Returns a dict with ``detected`` set to True (plus metadata) if a
        match is found, or ``{"detected": False}`` otherwise.
        """
        for canary_id, meta in self.active_canaries.items():
            if meta["phrase"] in text:
                return {
                    "detected": True,
                    "canary_id": canary_id,
                    "metadata": meta,
                    "alert": "CANARY TOKEN DETECTED IN EXTERNAL TEXT",
                }
        return {"detected": False}

    # ------------------------------------------------------------------
    # Housekeeping
    # ------------------------------------------------------------------

    def cleanup_expired(self, ttl_seconds: int = 3600) -> int:
        """
        Removes canaries older than *ttl_seconds*.

        Returns the number of entries pruned.
        """
        cutoff = time.time() - ttl_seconds
        expired = [
            cid
            for cid, meta in self.active_canaries.items()
            if meta["created_at"] < cutoff
        ]
        for cid in expired:
            del self.active_canaries[cid]
        return len(expired)


# Module-level singleton shared across the application
canary_manager = CanaryManager()
