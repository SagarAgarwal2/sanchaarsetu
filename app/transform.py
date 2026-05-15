from difflib import SequenceMatcher
from typing import Any, Literal
import re

import asyncpg

try:
    from sentence_transformers import SentenceTransformer, util
except Exception:
    SentenceTransformer = None
    util = None


AUTO_MAP_THRESHOLD = 0.85

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
    department_code: str,
    source_field: str,
    target_fields: list[str],
    direction: Literal["sws_to_dept", "dept_to_sws"] = "sws_to_dept",
) -> tuple[str | None, float]:
    """UI-backed mapping registry.

    Uses `schema_mappings` (department_id, sws_field, dept_field, confidence_score, status).

    - sws_to_dept: map sws_field -> dept_field
    - dept_to_sws: map dept_field -> sws_field
    """
    if not department_code:
        return None, 0.0

    async with pg_pool.acquire() as conn:
        dept_row = await conn.fetchrow(
            "SELECT id FROM departments WHERE code = $1 OR domain = $1",
            department_code,
        )
        dept_id = dept_row["id"] if dept_row else None
        if not dept_id:
            return None, 0.0

        if direction == "sws_to_dept":
            existing = await conn.fetchrow(
                """
                SELECT dept_field, confidence_score
                FROM schema_mappings
                WHERE department_id = $1 AND sws_field = $2 AND status IN ('confirmed','auto_mapped')
                ORDER BY version DESC, confidence_score DESC, created_at DESC
                LIMIT 1
                """,
                dept_id,
                source_field,
            )
            if existing:
                return existing["dept_field"], float(existing["confidence_score"]) if existing["confidence_score"] is not None else 0.0
        else:
            existing = await conn.fetchrow(
                """
                SELECT sws_field, confidence_score
                FROM schema_mappings
                WHERE department_id = $1 AND dept_field = $2 AND status IN ('confirmed','auto_mapped')
                ORDER BY version DESC, confidence_score DESC, created_at DESC
                LIMIT 1
                """,
                dept_id,
                source_field,
            )
            if existing:
                return existing["sws_field"], float(existing["confidence_score"]) if existing["confidence_score"] is not None else 0.0

        best_target, best_score = _semantic_similarity(source_field, target_fields)
        if best_target is None:
            return None, 0.0

        status = "auto_mapped" if float(best_score) >= AUTO_MAP_THRESHOLD else "pending_review"

        if direction == "sws_to_dept":
            await conn.execute(
                """
                INSERT INTO schema_mappings(department_id, sws_field, dept_field, confidence_score, status, version)
                VALUES ($1,$2,$3,$4,$5,1)
                ON CONFLICT DO NOTHING
                """,
                dept_id,
                source_field,
                best_target,
                float(best_score),
                status,
            )
        else:
            await conn.execute(
                """
                INSERT INTO schema_mappings(department_id, sws_field, dept_field, confidence_score, status, version)
                VALUES ($1,$2,$3,$4,$5,1)
                ON CONFLICT DO NOTHING
                """,
                dept_id,
                best_target,
                source_field,
                float(best_score),
                status,
            )

    return (best_target if float(best_score) >= AUTO_MAP_THRESHOLD else None, float(best_score))


async def transform_payload(
    pg_pool: asyncpg.pool.Pool,
    department: str,
    source_payload: dict[str, Any],
    target_schema: list[str],
    direction: Literal["sws_to_dept", "dept_to_sws"] = "sws_to_dept",
) -> dict[str, Any]:
    """
    Transform payload from source schema to target department schema.
    Uses semantic mapping to automatically map fields.
    """
    transformed = {}
    for src_field, value in source_payload.items():
        mapped_field, confidence = await find_or_create_mapping(pg_pool, department, src_field, target_schema, direction=direction)
        if mapped_field:
            transformed[mapped_field] = value
        else:
            # Low confidence; hold for review (in production, this would go to a manual queue)
            pass

    return transformed
