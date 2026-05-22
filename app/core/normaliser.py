"""
app/core/normaliser.py
======================
Input normalisation layer — runs BEFORE all other guards to defeat
encoding-based injection bypasses.

Pipeline (in order):
  1. decode_if_encoded   — detects & unwraps Base64 / ROT13 / URL / HTML-entity
  2. normalise_unicode   — collapses homoglyphs, strips zero-width chars,
                          replaces Cyrillic lookalikes
  3. scan_for_keywords   — keyword matching on the fully-decoded text
  4. normalise_and_assess — orchestrator that returns a structured risk dict
"""

import base64
import codecs
import html
import re
import unicodedata
from urllib.parse import unquote

# ---------------------------------------------------------------------------
# Injection keyword list
# ---------------------------------------------------------------------------

INJECTION_KEYWORDS: list[str] = [
    "ignore", "forget", "disregard", "bypass", "override", "jailbreak",
    "system prompt", "previous instructions", "new instructions", "as dan",
    "developer mode", "unrestricted", "do anything now", "you are now",
    "pretend you", "act as", "roleplay as", "simulate", "hypothetically",
    "in a story", "for fiction", "base64", "rot13", "encoded",
]

# ---------------------------------------------------------------------------
# Cyrillic → Latin homoglyph map (str.translate requires ordinal keys)
# ---------------------------------------------------------------------------

_HOMOGLYPH_MAP: dict[int, str] = {
    ord("а"): "a",   # Cyrillic а  → Latin a
    ord("е"): "e",   # Cyrillic е  → Latin e
    ord("о"): "o",   # Cyrillic о  → Latin o
    ord("р"): "p",   # Cyrillic р  → Latin p
    ord("с"): "c",   # Cyrillic с  → Latin c
    ord("х"): "x",   # Cyrillic х  → Latin x
    # Extended uppercase lookalikes
    ord("А"): "A",
    ord("Е"): "E",
    ord("О"): "O",
    ord("Р"): "P",
    ord("С"): "C",
    ord("Х"): "X",
    ord("І"): "I",   # Cyrillic І  → Latin I
    ord("і"): "i",   # Cyrillic і  → Latin i
    ord("В"): "B",
    ord("К"): "K",
    ord("М"): "M",
    ord("Т"): "T",
}

# Zero-width & invisible character pattern
_ZERO_WIDTH_RE = re.compile(r"[\u200b-\u200f\u2060\ufeff]")


# ---------------------------------------------------------------------------
# 1. decode_if_encoded
# ---------------------------------------------------------------------------

def decode_if_encoded(text: str) -> tuple[str, list[str]]:
    """Try common encoding schemes and return the decoded text plus a list
    of transformations that were applied.

    Checks are applied in order; the function stops at the first successful
    decode that actually changes the text.

    Returns
    -------
    (decoded_text, list_of_transformations_applied)
    """
    transformations: list[str] = []
    stripped = text.strip()

    # ------------------------------------------------------------------
    # a) Base64
    # ------------------------------------------------------------------
    try:
        # Pad if necessary so b64decode doesn't choke
        padded = stripped + "=" * (-len(stripped) % 4)
        raw = base64.b64decode(padded)
        decoded = raw.decode("utf-8")
        if decoded != text and len(decoded) > 10:
            transformations.append("base64")
            return decoded, transformations
    except Exception:
        pass

    # ------------------------------------------------------------------
    # b) ROT13 — only flag if decoded text contains injection keywords
    # ------------------------------------------------------------------
    try:
        rot_decoded = codecs.decode(text, "rot_13")
        if rot_decoded != text:
            lower = rot_decoded.lower()
            if any(kw in lower for kw in INJECTION_KEYWORDS):
                transformations.append("rot13")
                return rot_decoded, transformations
    except Exception:
        pass

    # ------------------------------------------------------------------
    # c) URL encoding
    # ------------------------------------------------------------------
    try:
        url_decoded = unquote(text)
        if "%" in text and url_decoded != text:
            transformations.append("url_encoded")
            return url_decoded, transformations
    except Exception:
        pass

    # ------------------------------------------------------------------
    # d) HTML entities
    # ------------------------------------------------------------------
    try:
        html_decoded = html.unescape(text)
        if "&" in text and html_decoded != text:
            transformations.append("html_entity")
            return html_decoded, transformations
    except Exception:
        pass

    return text, []


# ---------------------------------------------------------------------------
# 2. normalise_unicode
# ---------------------------------------------------------------------------

def normalise_unicode(text: str) -> tuple[str, bool]:
    """Normalise Unicode to defeat homoglyph and invisible-character tricks.

    Steps applied in order:
      a. NFKC normalisation — collapses ℑ→I, ﬁ→fi, fullwidth ASCII, etc.
      b. Strip zero-width characters (U+200B–U+200F, U+2060, U+FEFF).
      c. Replace Cyrillic lookalikes with their ASCII equivalents.

    Returns
    -------
    (normalised_text, was_modified)
    """
    original = text

    # a. NFKC
    text = unicodedata.normalize("NFKC", text)

    # b. Zero-width characters
    text = _ZERO_WIDTH_RE.sub("", text)

    # c. Cyrillic homoglyphs
    text = text.translate(_HOMOGLYPH_MAP)

    return text, text != original


# ---------------------------------------------------------------------------
# 3. scan_for_keywords_post_decode
# ---------------------------------------------------------------------------

def scan_for_keywords_post_decode(text: str) -> list[str]:
    """Return every injection keyword found in *text* (case-insensitive)."""
    lower = text.lower()
    return [kw for kw in INJECTION_KEYWORDS if kw in lower]


# ---------------------------------------------------------------------------
# 4. normalise_and_assess  (main entry point)
# ---------------------------------------------------------------------------

def normalise_and_assess(raw_text: str) -> dict:
    """Run the full normalisation pipeline and return a structured risk report.

    Pipeline
    --------
    1. decode_if_encoded  — unwrap any encoding layer
    2. normalise_unicode  — collapse homoglyphs / strip invisibles
    3. homoglyph keyword scan (IMMEDIATE) — if homoglyphs were found, scan the
       normalised text right away; any keyword hit floors risk_score to 0.7
    4. scan_for_keywords  — keyword scan on fully normalised text

    Returns
    -------
    {
        "normalised_text":             str,        # text to use downstream
        "was_encoded":                 bool,
        "encoding_types":              list[str],  # e.g. ["base64"]
        "was_homoglyph":               bool,
        "keyword_matches_post_decode": list[str],
        "risk_score":                  float,      # 0.0–1.0
    }
    """
    # Step 1: keyword scan on plain (pre-decode) text
    plain_kw_matches = scan_for_keywords_post_decode(raw_text)

    # Step 2: try to decode encoding layers (single pass)
    decoded_text, encoding_types = decode_if_encoded(raw_text)
    was_encoded = bool(encoding_types)

    # Count additional encoding layers — if the decoded text is *itself*
    # encoded, recurse once more (handles double-encoded payloads).
    extra_layers = 0
    if was_encoded:
        double_decoded, extra_types = decode_if_encoded(decoded_text)
        if extra_types:
            decoded_text = double_decoded
            encoding_types.extend(extra_types)
            extra_layers += 1

    # Step 3: Unicode normalisation
    normalised_text, was_homoglyph = normalise_unicode(decoded_text)

    # Step 3b: IMMEDIATE homoglyph keyword check
    #
    # If homoglyphs were detected, scan the now-normalised text straight away.
    # Homoglyph obfuscation + injection keyword is never ambiguous — floor the
    # risk score to 0.7 so the normaliser block fires unconditionally.
    homoglyph_kw_matches: list[str] = []
    if was_homoglyph:
        homoglyph_kw_matches = scan_for_keywords_post_decode(normalised_text)

    # Step 4: keyword scan on the fully normalised text
    kw_matches = scan_for_keywords_post_decode(normalised_text)

    # Step 5: risk score
    #
    # Components (all independent, capped at 1.0):
    #   +0.2  — keyword matches found in post-normalisation text (base penalty)
    #   +0.3  — encoding layer detected AND keywords present after decode
    #   +0.1  — per extra encoding layer (double-encoding)
    #
    # Hard floor:
    #   >= 0.7 — homoglyph obfuscation AND any injection keyword (unambiguous)
    risk_score = 0.0

    if kw_matches:
        # Base penalty for any keyword hit in the final normalised text
        risk_score += 0.2

    if was_encoded and kw_matches:
        # Extra weight for encoding-based obfuscation
        risk_score += 0.3

    # +0.1 per additional encoding layer (double-encoding)
    risk_score += 0.1 * extra_layers

    # Hard floor: homoglyph + injection keyword is an unambiguous attack.
    # Apply AFTER all additive components so we never go below 0.7 in this case.
    if was_homoglyph and homoglyph_kw_matches:
        risk_score = max(risk_score, 0.7)

    # Cap at 1.0
    risk_score = min(risk_score, 1.0)

    return {
        "normalised_text":             normalised_text,
        "was_encoded":                 was_encoded,
        "encoding_types":              encoding_types,
        "was_homoglyph":               was_homoglyph,
        "keyword_matches_post_decode": kw_matches,
        "risk_score":                  round(risk_score, 4),
    }
