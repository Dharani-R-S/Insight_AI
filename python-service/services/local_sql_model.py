"""Local Qwen + PEFT adapter inference for the SQL generation endpoint."""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Dict

_model = None
_tokenizer = None
_load_lock = threading.Lock()
_generate_lock = threading.Lock()

DEFAULT_ADAPTER_PATH = (
    Path(__file__).resolve().parents[2] / "model" / "adapter"
)


def _adapter_path() -> Path:
    return Path(os.getenv("LOCAL_SQL_MODEL_PATH", str(DEFAULT_ADAPTER_PATH))).expanduser().resolve()


def _load_model():
    """Load once, only when the local provider is actually selected."""
    global _model, _tokenizer
    if _model is not None:
        return _model, _tokenizer

    with _load_lock:
        if _model is not None:
            return _model, _tokenizer

        adapter_path = _adapter_path()
        if not adapter_path.is_dir() or not (adapter_path / "adapter_config.json").is_file():
            raise ValueError(
                "Local SQL adapter was not found. Set LOCAL_SQL_MODEL_PATH to a LoRA adapter directory. "
                f"Expected: {adapter_path}"
            )

        try:
            import torch
            from peft import PeftConfig, PeftModel
            from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        except ImportError as exc:
            raise ValueError(
                "Local SQL dependencies are missing. Install python-service/requirements.txt "
                "before selecting the Local Qwen SQL provider."
            ) from exc

        config = PeftConfig.from_pretrained(str(adapter_path))
        tokenizer_source = str(adapter_path) if (adapter_path / "tokenizer_config.json").exists() else config.base_model_name_or_path
        _tokenizer = AutoTokenizer.from_pretrained(tokenizer_source, trust_remote_code=True)
        _tokenizer.pad_token = _tokenizer.pad_token or _tokenizer.eos_token

        model_kwargs = {"trust_remote_code": True}
        if torch.cuda.is_available():
            # Matches the QLoRA evaluation setup while keeping memory usage low.
            model_kwargs.update({
                "quantization_config": BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_use_double_quant=True,
                ),
                "device_map": "auto",
            })
        else:
            model_kwargs["torch_dtype"] = torch.float32

        base_model = AutoModelForCausalLM.from_pretrained(config.base_model_name_or_path, **model_kwargs)
        _model = PeftModel.from_pretrained(base_model, str(adapter_path))
        if not torch.cuda.is_available():
            _model.to("cpu")
        _model.eval()
        return _model, _tokenizer


def schema_to_ddl(schema: Dict[str, str]) -> str:
    """Create the single-table SQLite schema representation used by the adapter prompt."""
    if not schema:
        raise ValueError("A dataset schema is required for local SQL generation.")

    columns = []
    for name, data_type in schema.items():
        safe_name = str(name).replace('"', '""')
        # SQLite types are supplied by the ingestion layer; keep a safe fallback.
        safe_type = re.sub(r"[^A-Za-z0-9_ ()]", "", str(data_type or "TEXT")) or "TEXT"
        columns.append(f'  "{safe_name}" {safe_type}')
    return "CREATE TABLE IF NOT EXISTS \"data\" (\n" + ",\n".join(columns) + "\n);"


def _clean_sql(text: str) -> str:
    """Extract and clean the first SQL statement from raw model output.

    Strategy:
    1. Strip markdown fences.
    2. Find the first SELECT/WITH keyword.
    3. Split at the first semicolon — everything after is model hallucination.
    4. Strip trailing inline -- comments from each line.
    5. Safety-check that the result is still a SELECT/WITH.
    """
    # 1. Strip markdown code fences
    text = re.sub(r"^```(?:sql)?\s*", "", text.strip(), flags=re.IGNORECASE)
    text = text.split("```")[0].strip()

    # 2. Find first SELECT / WITH
    match = re.search(r"\b(SELECT|WITH)\b[\s\S]*", text, flags=re.IGNORECASE)
    if not match:
        raise ValueError("The local model did not return a SQL SELECT query.")

    # 3. Take everything up to the FIRST semicolon — drops all hallucinated continuations
    sql = match.group(0).split(";")[0].strip()

    # 4. Strip trailing inline -- comments from every line
    sql = re.sub(r"\s*--.*$", "", sql, flags=re.MULTILINE).strip()

    # 5. Final safety check
    if not re.match(r"^(SELECT|WITH)\b", sql, flags=re.IGNORECASE):
        raise ValueError("The local model returned an unsafe query.")

    return sql


# ── SQLite compatibility: rewrite MySQL-style functions ─────────────────────
_SQLITE_COMPAT_RULES = [
    # YEAR(col)  →  CAST(strftime('%Y', col) AS INTEGER)
    (re.compile(r"\bYEAR\s*\(([^)]+)\)",        re.IGNORECASE),
     r"CAST(strftime('%Y', \1) AS INTEGER)"),
    # MONTH(col) →  CAST(strftime('%m', col) AS INTEGER)
    (re.compile(r"\bMONTH\s*\(([^)]+)\)",       re.IGNORECASE),
     r"CAST(strftime('%m', \1) AS INTEGER)"),
    # DAY(col)   →  CAST(strftime('%d', col) AS INTEGER)
    (re.compile(r"\bDAY\s*\(([^)]+)\)",         re.IGNORECASE),
     r"CAST(strftime('%d', \1) AS INTEGER)"),
    # DATE_FORMAT(col, fmt) → strftime(fmt, col)  (best-effort)
    (re.compile(r"\bDATE_FORMAT\s*\(([^,]+),\s*'([^']+)'\)", re.IGNORECASE),
     r"strftime('\2', \1)"),
    # NOW() / CURDATE() → date('now')
    (re.compile(r"\bNOW\s*\(\s*\)",             re.IGNORECASE), "date('now')"),
    (re.compile(r"\bCURDATE\s*\(\s*\)",         re.IGNORECASE), "date('now')"),
    # DATEDIFF(a, b) → CAST(julianday(a) - julianday(b) AS INTEGER)
    (re.compile(r"\bDATEDIFF\s*\(([^,]+),\s*([^)]+)\)", re.IGNORECASE),
     r"CAST(julianday(\1) - julianday(\2) AS INTEGER)"),
    # IFNULL is fine in SQLite; ISNULL → IFNULL
    (re.compile(r"\bISNULL\s*\(",               re.IGNORECASE), "IFNULL("),
    # NVL → IFNULL
    (re.compile(r"\bNVL\s*\(",                  re.IGNORECASE), "IFNULL("),
]


def _fix_sqlite_compat(sql: str) -> str:
    """Rewrite MySQL/PostgreSQL dialect functions to their SQLite equivalents."""
    for pattern, replacement in _SQLITE_COMPAT_RULES:
        sql = pattern.sub(replacement, sql)
    return sql


def _inject_order_by_aggregates(sql: str) -> str:
    """Fix #4 — 'Top N by metric' queries.

    When the model writes:
        SELECT region FROM data GROUP BY region ORDER BY sum(quantity) DESC LIMIT 3
    it returns only region names — no numeric column — so no chart can be drawn.

    This function detects aggregates in ORDER BY that are absent from SELECT
    and injects them, turning the above into:
        SELECT region, sum(quantity) FROM data GROUP BY region ORDER BY sum(quantity) DESC LIMIT 3
    """
    # Extract ORDER BY clause (before optional LIMIT / end of string)
    order_match = re.search(
        r'\bORDER\s+BY\s+(.*?)(?=\s*\bLIMIT\b|\s*$)',
        sql, re.IGNORECASE | re.DOTALL
    )
    if not order_match:
        return sql

    order_clause = order_match.group(1).strip()

    # Find all aggregate expressions in ORDER BY
    agg_exprs = re.findall(
        r'\b(?:SUM|AVG|COUNT|MIN|MAX)\s*\([^)]+\)',
        order_clause, re.IGNORECASE
    )
    if not agg_exprs:
        return sql

    # Extract current SELECT column list
    select_match = re.search(
        r'\bSELECT\s+(.*?)\s+\bFROM\b',
        sql, re.IGNORECASE | re.DOTALL
    )
    if not select_match:
        return sql

    select_clause = select_match.group(1).strip()

    # Identify which ORDER BY aggregates are missing from SELECT
    select_norm = re.sub(r'\s+', ' ', select_clause).lower()
    to_add = [
        agg for agg in agg_exprs
        if re.sub(r'\s+', ' ', agg).lower() not in select_norm
    ]

    if not to_add:
        return sql

    # Inject missing aggregates at end of SELECT list
    new_select = select_clause + ', ' + ', '.join(to_add)
    sql = sql[:select_match.start(1)] + new_select + sql[select_match.end(1):]
    return sql


def generate_sql(question: str, schema: Dict[str, str]) -> str:
    """Generate read-only SQLite SQL using the fine-tuning prompt format."""
    model, tokenizer = _load_model()
    prompt = f"""You are an expert SQL generator. Given a database schema and a natural language question, generate the correct SQL query.

### Schema:
{schema_to_ddl(schema)}

### Question:
{question}

### SQL:
"""

    import torch
    with _generate_lock, torch.inference_mode():
        inputs = tokenizer(prompt, return_tensors="pt")
        device = next(model.parameters()).device
        inputs = {key: value.to(device) for key, value in inputs.items()}
        output = model.generate(
            **inputs,
            max_new_tokens=256,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    generated = tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    sql = _clean_sql(generated)                   # Fix #1: strip hallucinations
    sql = _fix_sqlite_compat(sql)                 # Fix #2: MySQL → SQLite dialect
    sql = _inject_order_by_aggregates(sql)        # Fix #4: inject missing SELECT aggregates
    return sql


def local_model_status() -> Dict[str, str | bool]:
    path = _adapter_path()
    return {"adapter_path": str(path), "adapter_available": (path / "adapter_config.json").is_file(), "loaded": _model is not None}
