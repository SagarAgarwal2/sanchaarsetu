from difflib import SequenceMatcher
from typing import Any
import re

import asyncpg

try:
    from sentence_transformers import SentenceTransformer, util
except Exception:
    SentenceTransformer = None
    util = None


CONFIDENCE_THRESHOLD = 0.75

def scrub_pii(text: str) -> str:
    """Scrub PII from text before it hits the AI model."""
    if not isinstance(text, str): return text
    text = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[EMAIL_REDACTED]', text)
    text = re.sub(r'\b\d{10}\b', '[PHONE_REDACTED]', text)
    text = re.sub(r'\b\d{4}\s?\d{4}\s?\d{4}\b', '[AADHAAR_REDACTED]', text)
    text = re.sub(r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b', '[PAN_REDACTED]', text)
    return text

def _best_field_match(source_field: str, target_fields: list[str]) -> tuple[str | None, float]:
    if not target_fields:
        return None, 0.0

    best_target = None
    best_score = 0.0
    source = source_field.lower()

    for target in target_fields:
        score = SequenceMatcher(None, source, target.lower()).ratio()
        if score > best_score:
            best_score = score
            best_target = target

    return best_target, best_score


def _semantic_similarity(source_field: str, target_fields: list[str]) -> tuple[str | None, float]:
    if SentenceTransformer is not None and util is not None:
        try:
            model = SentenceTransformer("all-MiniLM-L6-v2")
            scrubbed_source = scrub_pii(source_field)
            scrubbed_targets = [scrub_pii(t) for t in target_fields]
            source_embedding = model.encode(scrubbed_source, convert_to_tensor=True)
            target_embeddings = model.encode(scrubbed_targets, convert_to_tensor=True)
            similarities = util.pytorch_cos_sim(source_embedding, target_embeddings)[0]
            best_idx = similarities.argmax().item()
            best_score = similarities[best_idx].item()
            return target_fields[best_idx], float(best_score)
        except Exception:
            # Fall back to a fast lexical similarity if model loading or inference fails.
            pass

    return _best_field_match(source_field, target_fields)


async def find_or_create_mapping(
    pg_pool: asyncpg.pool.Pool,
    department: str,
    source_field: str,
    target_fields: list[str],
) -> tuple[str | None, float]:
    """
    Find existing mapping or compute new one via semantic similarity.
    Returns (mapped_field, confidence_score).
    """
    async with pg_pool.acquire() as conn:
        # Check if mapping already exists
        existing = await conn.fetchrow(
            "SELECT target_field, confidence FROM mapping_registry WHERE department=$1 AND source_field=$2 ORDER BY version DESC LIMIT 1",
            department,
            source_field,
        )
        if existing:
            return (existing["target_field"], existing["confidence"])

    best_target, best_score = _semantic_similarity(source_field, target_fields)

    if best_target is None:
        return None, 0.0

    # Store mapping in DB
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO mapping_registry(department, source_field, target_field, confidence, version) VALUES ($1, $2, $3, $4, 1)",
            department,
            source_field,
            best_target,
            float(best_score),
        )

    return (best_target if best_score >= CONFIDENCE_THRESHOLD else None, best_score)


async def transform_payload(
    pg_pool: asyncpg.pool.Pool,
    department: str,
    source_payload: dict[str, Any],
    target_schema: list[str],
) -> dict[str, Any]:
    """
    Transform payload from source schema to target department schema.
    Uses semantic mapping to automatically map fields.
    """
    transformed = {}
    for src_field, value in source_payload.items():
        mapped_field, confidence = await find_or_create_mapping(pg_pool, department, src_field, target_schema)
        if mapped_field:
            transformed[mapped_field] = value
        else:
            # Low confidence; hold for review (in production, this would go to a manual queue)
            pass

    return transformed
