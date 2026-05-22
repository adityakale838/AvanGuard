import time
from collections import defaultdict


class TokenBucket:
    def __init__(self, capacity: int, refill_rate: float):
        self.capacity = capacity
        self.refill_rate = refill_rate  # tokens per second
        self._buckets: dict[str, dict] = defaultdict(
            lambda: {"tokens": capacity, "last_refill": time.time()}
        )

    def consume(self, key: str, tokens: int = 1) -> bool:
        bucket = self._buckets[key]
        now = time.time()
        elapsed = now - bucket["last_refill"]
        bucket["tokens"] = min(
            self.capacity,
            bucket["tokens"] + elapsed * self.refill_rate
        )
        bucket["last_refill"] = now
        if bucket["tokens"] >= tokens:
            bucket["tokens"] -= tokens
            return True
        return False

    def cleanup(self, max_age_seconds: int = 3600):
        now = time.time()
        stale = [k for k, v in self._buckets.items()
                 if now - v["last_refill"] > max_age_seconds]
        for k in stale:
            del self._buckets[k]


# 10 requests per minute per session, burst of 5
request_limiter = TokenBucket(capacity=5, refill_rate=10 / 60)
