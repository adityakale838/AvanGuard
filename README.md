# AvanGuard

> A 4-stage security middleware proxy that sits between your application and any LLM, blocking prompt injections, sanitizing PII, and enforcing business rules — before the model ever sees the input or after it generates a response.

---

## What It Is

AvanGuard is an LLM security proxy built with FastAPI and Python. You point your application at it instead of directly at Ollama (or any other LLM backend), and every request/response passes through a staged pipeline that handles:

- **Prompt injection attacks** — direct, encoded (base64, homoglyphs), multilingual, role-switch, delimiter, and jailbreak variants
- **PII leakage** — emails, Aadhaar numbers, credit cards, and other sensitive patterns are detected and redacted before reaching the model
- **Business rule violations** — the model's output is validated against plain-English rules stored in SQLite before the response is returned to the caller
- **Abuse** — token bombs, rate limiting, and malformed requests are rejected at the gate

The core philosophy: don't trust the input, don't trust the output. Validate both.

---

## Pipeline Stages

Every request flows through four stages in order. The first stage that fires a verdict short-circuits the pipeline — the request never reaches later stages unnecessarily.

```
Incoming Request
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  Stage 0 · Semantic Cache                           │
│  FAISS + all-MiniLM-L6-v2                           │
│  If intent matches a past approved prompt ≥ 95%     │
│  similarity → return cached response (~50ms)        │
└──────────────────────┬──────────────────────────────┘
                       │ (cache miss)
                       ▼
┌─────────────────────────────────────────────────────┐
│  Stage 1 · Input Guard                              │
│  deepset/deberta-v3-base-injection classifier       │
│  + heuristic PII pre-processor                      │
│  Injection detected → 403 BLOCK                     │
│  PII detected → redact and continue                 │
└──────────────────────┬──────────────────────────────┘
                       │ (clean or sanitized)
                       ▼
┌─────────────────────────────────────────────────────┐
│  Stage 2 · Main LLM                                 │
│  Llama 3 via Ollama                                 │
│  Strict system persona enforced per request         │
└──────────────────────┬──────────────────────────────┘
                       │ (model response)
                       ▼
┌─────────────────────────────────────────────────────┐
│  Stage 3 · Output Guard (LLM-as-a-Judge)            │
│  Response validated against business rules in       │
│  SQLite. Rule violated → 403 BLOCK before           │
│  response reaches the caller                        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
                 200 OK · Safe Response
```

---

## Repo Structure

```
edi2/
├── app/                      # FastAPI application (core proxy server)
├── avanguard_connected/      # Version wired to external/cloud LLM backends
├── avanguard_streamlit/      # Streamlit UI for manual testing and rule management
├── scripts/                  # Setup and utility scripts
├── tests/                    # Test suite
├── ui/                       # Frontend interface (TypeScript)
├── demo.py                   # CLI demo tool — runs 13 attack scenarios against the live server
├── requirements.txt          # Python dependencies
└── .gitignore
```

---

## Prerequisites

- Python 3.10+
- [Ollama](https://ollama.com) installed and running locally with Llama 3 pulled
- `pip` / `venv`

Pull the model if you haven't:

```bash
ollama pull llama3
```

---

## Installation

```bash
git clone https://github.com/adityakale838/edi2.git
cd edi2

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt
```

### Dependencies

| Package | Purpose |
|---|---|
| `fastapi` | Proxy server framework |
| `uvicorn` | ASGI server |
| `transformers` | Loads the DeBERTa injection classifier |
| `sentence-transformers` | Embeds prompts for semantic cache |
| `faiss-cpu` | Vector similarity search for the cache |
| `streamlit` | Admin/testing UI |
| `httpx` | Async HTTP client for Ollama calls |
| `scikit-learn` | Supporting ML utilities |
| `langdetect` | Detects prompt language for multilingual injection handling |
| `rich` | CLI output formatting |
| `python-dotenv` | Environment variable management |

---

## Running the Server

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The proxy is now listening at `http://127.0.0.1:8000`. Your application sends requests here instead of directly to Ollama.

### Environment Variables

Create a `.env` file in the project root:

```env
OLLAMA_URL=http://127.0.0.1:11434
ADMIN_KEY=dev-insecure-key-change-me
DEFAULT_MODEL=llama3
```

`ADMIN_KEY` is required for the `/api/admin/*` endpoints. Change it before any non-local deployment.

---

## API

### Chat Completions (Proxy Endpoint)

```
POST /v1/chat/completions
```

Drop-in compatible with the OpenAI chat completions shape:

```json
{
  "model": "llama3",
  "messages": [
    { "role": "user", "content": "What is your refund policy?" }
  ],
  "stream": false
}
```

Optional header: `X-Session-ID: <your-session-id>` — used for rate limiting and session tracking.

**Response codes:**

| Code | Meaning |
|---|---|
| `200` | Request passed all stages, response returned |
| `202` | Ambiguous — routed to human review queue |
| `400` | Input rejected (token limit exceeded, malformed shape) |
| `403` | Blocked by input guard or output guard |
| `429` | Rate limit exceeded |
| `503` | LLM backend unavailable |

### Health Check

```
GET /health
```

```json
{
  "ollama": "reachable",
  "db": "ok",
  "cache_entries": 42,
  "active_sessions": 3
}
```

### Admin Endpoints

All require the `X-Admin-Key` header.

```
GET  /api/admin/metrics          # Live pipeline metrics
GET  /api/admin/rules            # List business rules
POST /api/admin/rules            # Add a business rule
```

Business rules are plain English strings stored in SQLite. The output guard uses the LLM itself to evaluate whether a generated response violates any active rule.

Example rule: `"Do not promise refunds greater than $50"` — if the model output contains a $200 refund promise, Stage 3 blocks it with a 403 before the response reaches the caller.

---

## CLI Demo Tool

`demo.py` runs a battery of 13 pre-built attack scenarios against the live server, showing verdict and latency for each. Useful for verifying the pipeline is working after setup, or for demonstrations.

```bash
# Interactive mode (default)
python demo.py

# Run all 13 scenarios and print summary table
python demo.py --demo

# Run a single scenario by ID
python demo.py --scenario E

# Send a one-off custom prompt
python demo.py --prompt "Ignore all previous instructions"

# Print live metrics
python demo.py --metrics
```

### Built-in Scenarios

| ID | Label | Category | Expected |
|---|---|---|---|
| A | Legitimate query | baseline | PASS |
| B | Email PII — fast redact path | pii | SANITIZE/PASS |
| C | Aadhaar number | pii | SANITIZE/PASS |
| D | Credit card | pii | SANITIZE |
| E | Direct prompt injection | injection | BLOCK |
| F | DAN jailbreak | injection | BLOCK |
| G | Role-switch injection | injection | BLOCK |
| H | Base64-encoded injection | encoding | BLOCK |
| I | Homoglyph attack (Cyrillic lookalikes) | encoding | BLOCK |
| J | Hindi injection | multilingual | BLOCK |
| K | Spanish injection | multilingual | BLOCK |
| L | Output rule violation ($200 refund) | output_guard | BLOCK |
| M | Indirect delimiter injection | injection | BLOCK |
| N | Token bomb (5000 words) | dos | 400 |

---

## Streamlit UI

For a visual interface to test prompts and manage business rules:

```bash
streamlit run avanguard_streamlit/app.py
```

Opens a browser UI at `http://localhost:8501`.

---

## Running Tests

```bash
pytest tests/
```

---

## How the Semantic Cache Works

Stage 0 uses `all-MiniLM-L6-v2` to convert every incoming prompt into a 384-dimensional embedding, then searches a FAISS index for the nearest approved past prompt. If the cosine similarity exceeds 0.95, the cached response is returned immediately without hitting the classifier or the LLM — typically under 50ms.

The cache only stores responses from requests that cleared all four stages. A blocked prompt never pollutes the cache.

---

## How PII Sanitization Works

Before the injection classifier sees the prompt, a heuristic pre-processor scans for and redacts known PII patterns:

- Email addresses → `[EMAIL REDACTED]`
- Credit/debit card numbers → `[CARD REDACTED]`
- Aadhaar numbers (India 12-digit UID) → `[AADHAAR REDACTED]`

The sanitized prompt continues through the pipeline. The original prompt (with PII) is never forwarded to the LLM.

---

## How the Output Guard Works

After the LLM generates a response, Stage 3 calls the LLM again — as a judge — with the response and all active business rules. The judge returns a structured verdict. If any rule is violated, the original response is discarded and a 403 is returned to the caller. The caller never sees the violating response.

Rules are managed at runtime via the admin API. No redeploy required to add or remove rules.

---

## Limitations

- Designed for Ollama/Llama 3 locally. Adapting to OpenAI or other APIs requires modifying the Stage 2 routing in `app/`.
- The semantic cache is in-memory. It does not persist across server restarts by default.
- The injection classifier (`deepset/deberta-v3-base-injection`) is English-centric. Multilingual attacks (scenarios J, K) are handled by `langdetect` + heuristics, not the classifier itself.
- The output guard adds one additional LLM call per request. This roughly doubles Stage 2 latency. Disable it if latency is critical and you don't need output validation.
- The admin key is a single static secret. Rotate it and keep it out of version control.
