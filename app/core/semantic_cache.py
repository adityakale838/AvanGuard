import json
import logging
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


class AvanGuardCache:
    def __init__(self, similarity_threshold: float = 0.95, max_size: int = 5000):
        # Load a tiny, lightning-fast embedding model (runs on CPU in milliseconds)
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        self.embedding_dim = self.model.get_sentence_embedding_dimension()

        # FAISS Index for Cosine Similarity
        self.index = faiss.IndexFlatIP(self.embedding_dim)

        self.similarity_threshold = similarity_threshold
        self.max_size = max_size

        # In-memory store linking vector IDs to actual LLM responses
        self.response_store = {}
        self.vector_count = 0

    def check_cache(self, prompt: str):
        """Checks if a semantically identical prompt was already processed and approved."""
        if self.vector_count == 0:
            return None

        # Convert prompt to numbers and normalize for cosine similarity
        vector = self.model.encode([prompt], convert_to_numpy=True)
        faiss.normalize_L2(vector)

        # Search for the 1 nearest neighbor
        similarities, indices = self.index.search(vector, 1)

        best_score = similarities[0][0]
        best_index = indices[0][0]

        # If the intent matches by 95% or more, it's a Cache Hit!
        if best_score >= self.similarity_threshold:
            print(f"⚡ CACHE HIT! Semantic Similarity: {best_score:.4f}")
            return self.response_store[best_index]

        return None

    def add_to_cache(self, prompt: str, safe_response: dict):
        """Memorizes a safe prompt and its verified response."""
        if self.vector_count >= self.max_size:
            logger.warning(
                "AvanGuardCache is at max capacity (%d entries). "
                "Skipping cache addition for this response.",
                self.max_size,
            )
            return

        vector = self.model.encode([prompt], convert_to_numpy=True)
        faiss.normalize_L2(vector)

        self.index.add(vector)
        self.response_store[self.vector_count] = safe_response
        self.vector_count += 1

    def size(self) -> int:
        """Return the number of entries currently in the cache."""
        return self.vector_count

    def save_index(self, path: str):
        """Persist the FAISS index and response store to disk."""
        faiss.write_index(self.index, path)
        responses_path = path + ".responses.json"
        with open(responses_path, "w", encoding="utf-8") as f:
            json.dump(
                {"vector_count": self.vector_count, "response_store": self.response_store},
                f,
            )
        logger.info("Cache index saved to %s (entries: %d)", path, self.vector_count)

    def load_index(self, path: str):
        """Load a previously saved FAISS index and response store from disk."""
        self.index = faiss.read_index(path)
        responses_path = path + ".responses.json"
        with open(responses_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # JSON keys are always strings; convert back to int keys
        self.response_store = {int(k): v for k, v in data["response_store"].items()}
        self.vector_count = data["vector_count"]
        logger.info("Cache index loaded from %s (entries: %d)", path, self.vector_count)


# Initialize the global cache instance
semantic_cache = AvanGuardCache(similarity_threshold=0.95)