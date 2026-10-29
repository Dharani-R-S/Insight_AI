"""
LLM service — Multi-provider Natural Language to SQL and AI completion engine.
Supports Groq, OpenAI, Anthropic Claude, Google Gemini, and OpenAI-compatible custom endpoints.
"""
import os
import re
import json
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional

# Module-level client holder for backward compatibility and fast access
client = None
USER_AGENT = "InsightAI/1.0"


def get_client():
    """
    Get or create Groq client for backwards compatibility.
    """
    global client
    if client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            from pathlib import Path
            from dotenv import load_dotenv
            env_file = Path(__file__).resolve().parent.parent / ".env"
            if env_file.exists():
                load_dotenv(dotenv_path=env_file)
            api_key = os.getenv("GROQ_API_KEY")
        if not api_key or api_key == "your-groq-api-key-here":
            raise ValueError(
                "GROQ_API_KEY is not set. Please add your Groq API key to python-service/.env"
            )
        from groq import Groq
        client = Groq(api_key=api_key)
    return client


def _fix_where_having_duplication(sql: str) -> str:
    """
    Post-processing fix: Remove from the WHERE clause any conditions on columns
    that are also filtered via aggregate functions (AVG, SUM, COUNT, MIN, MAX)
    in the HAVING clause.
    """
    having_match = re.search(r'\bHAVING\b(.+?)(?:\bORDER\b|\bLIMIT\b|$)', sql, re.IGNORECASE | re.DOTALL)
    if not having_match:
        return sql

    having_clause = having_match.group(1)
    agg_cols = set(re.findall(
        r'\b(?:AVG|SUM|COUNT|MIN|MAX)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)',
        having_clause, re.IGNORECASE
    ))

    if not agg_cols:
        return sql

    where_match = re.search(r'\bWHERE\b(.+?)(?:\bGROUP\b|\bHAVING\b|\bORDER\b|\bLIMIT\b)', sql, re.IGNORECASE | re.DOTALL)
    if not where_match:
        return sql

    where_body = where_match.group(1).strip()
    conditions = re.split(r'\bAND\b', where_body, flags=re.IGNORECASE)
    cleaned = []
    for cond in conditions:
        cond_stripped = cond.strip()
        col_in_cond = re.match(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*[><=!]', cond_stripped)
        if col_in_cond and col_in_cond.group(1).lower() in {c.lower() for c in agg_cols}:
            continue
        cleaned.append(cond_stripped)

    if not cleaned:
        sql = re.sub(r'\bWHERE\b.+?(?=\bGROUP\b|\bHAVING\b|\bORDER\b|\bLIMIT\b)', '', sql, flags=re.IGNORECASE | re.DOTALL)
    else:
        new_where = " AND ".join(cleaned)
        sql = sql[:where_match.start(1)] + " " + new_where + " " + sql[where_match.end(1):]

    return sql.strip()


def resolve_llm_config(llm_config: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    """
    Resolve provider, API key, and model from request or fallback environment variables.
    """
    cfg = llm_config or {}
    provider = (cfg.get("provider") or "groq").lower().strip()
    api_key = (cfg.get("api_key") or cfg.get("apiKey") or "").strip()
    model = (cfg.get("model") or "").strip()
    base_url = (cfg.get("base_url") or cfg.get("baseUrl") or "").strip()

    # Fallbacks from environment variables if not provided in request
    if not api_key:
        if provider == "groq":
            api_key = os.getenv("GROQ_API_KEY", "")
        elif provider == "openai":
            api_key = os.getenv("OPENAI_API_KEY", "")
        elif provider in ("anthropic", "claude"):
            api_key = os.getenv("ANTHROPIC_API_KEY", "")
        elif provider in ("gemini", "google"):
            api_key = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")

    # Clean dummy placeholder keys
    if api_key in ("your-groq-api-key-here", "your-openai-api-key-here", "your-anthropic-api-key-here", "your-gemini-api-key-here"):
        api_key = ""

    # Default models per provider
    if not model:
        if provider == "groq":
            model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
        elif provider == "openai":
            model = "gpt-4o-mini"
        elif provider in ("anthropic", "claude"):
            model = "claude-3-5-sonnet-20241022"
        elif provider in ("gemini", "google"):
            model = "gemini-1.5-flash"
        elif provider in ("deepseek", "deepseek-ai"):
            model = "deepseek-chat"
        else:
            model = "gpt-3.5-turbo"

    return {
        "provider": provider,
        "api_key": api_key,
        "model": model,
        "base_url": base_url,
    }


# Model normalization mapping for retired or renamed models
GROQ_MODEL_FALLBACKS = {
    "llama-3.1-8b-instant": "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
    "llama3-8b-8192": "openai/gpt-oss-120b",
    "llama3-70b-8192": "openai/gpt-oss-120b",
    "mixtral-8x7b-32768": "openai/gpt-oss-120b",
    "gemma2-9b-it": "openai/gpt-oss-120b",
    "gemma-7b-it": "openai/gpt-oss-120b",
}


def call_llm(
    prompt: str,
    system_prompt: str = "You are an expert AI assistant.",
    llm_config: Optional[Dict[str, Any]] = None,
    temperature: float = 0.1,
    max_tokens: int = 1000,
) -> str:
    """
    Execute an LLM chat completion across Groq, OpenAI, Anthropic, Gemini, or custom endpoints.
    """
    config = resolve_llm_config(llm_config)
    provider = config["provider"]
    api_key = config["api_key"]
    model = config["model"]
    base_url = config["base_url"]

    # Normalize retired Groq models
    if provider == "groq" and model in GROQ_MODEL_FALLBACKS:
        print(f"[Groq] Remapping retired model '{model}' to '{GROQ_MODEL_FALLBACKS[model]}'")
        model = GROQ_MODEL_FALLBACKS[model]

    if not api_key:
        raise ValueError(
            f"API key is missing for provider '{provider.upper()}'. Please configure your API key in Settings."
        )

    # ─── 1. GROQ (Try official SDK first, fallback to REST) ───
    if provider == "groq":
        try:
            from groq import Groq
            groq_kwargs = {"api_key": api_key}
            if base_url and base_url.strip():
                clean_base = base_url.strip().rstrip("/")
                clean_base = re.sub(r'/openai/v1/?$', '', clean_base)
                if clean_base and clean_base not in ("https://api.groq.com", "http://api.groq.com"):
                    groq_kwargs["base_url"] = clean_base

            g_client = Groq(**groq_kwargs)

            try:
                completion = g_client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return completion.choices[0].message.content.strip()
            except Exception as first_try_err:
                err_str = str(first_try_err)
                if "does not exist" in err_str or "not have access" in err_str or "404" in err_str:
                    fallback_model = "openai/gpt-oss-120b"
                    print(f"[Groq] Model '{model}' not accessible. Retrying with '{fallback_model}'...")
                    fallback_completion = g_client.chat.completions.create(
                        model=fallback_model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": prompt},
                        ],
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                    return fallback_completion.choices[0].message.content.strip()
                raise

        except Exception as groq_err:
            err_msg = str(groq_err)
            if "Authentication" in err_msg or "Invalid API Key" in err_msg or "401" in err_msg:
                raise ValueError(f"Groq Authentication failed: {err_msg}")
            raise ValueError(f"Groq API error: {err_msg}")

    # ─── 2. ANTHROPIC (Claude) ───
    if provider in ("anthropic", "claude"):
        url = (base_url.rstrip("/") + "/messages") if base_url else "https://api.anthropic.com/v1/messages"
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system_prompt,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
        }
        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "User-Agent": USER_AGENT,
        }
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=45) as response:
                data = json.loads(response.read().decode("utf-8"))
                contents = data.get("content", [])
                text_parts = [c.get("text", "") for c in contents if c.get("type") == "text"]
                return "".join(text_parts).strip()
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            try:
                err_json = json.loads(err_body)
                msg = err_json.get("error", {}).get("message", err_body)
            except Exception:
                msg = err_body
            raise ValueError(f"Anthropic API error ({e.code}): {msg}")
        except Exception as e:
            raise ValueError(f"Anthropic request failed: {str(e)}")

    # ─── 3. GOOGLE GEMINI (OpenAI-compatible /chat/completions) ───
    if provider in ("gemini", "google"):
        if base_url:
            target_url = base_url.rstrip("/")
            if not target_url.endswith("/chat/completions"):
                target_url += "/chat/completions"
        else:
            target_url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": USER_AGENT,
        }
        try:
            req = urllib.request.Request(target_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=45) as response:
                data = json.loads(response.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"].strip()
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            try:
                err_json = json.loads(err_body)
                msg = err_json.get("error", {}).get("message", err_body)
            except Exception:
                msg = err_body
            raise ValueError(f"Google Gemini API error ({e.code}): {msg}")
        except Exception as e:
            raise ValueError(f"Google Gemini request failed: {str(e)}")

    # ─── 4. OPENAI / DEEPSEEK / OPENROUTER / OLLAMA ───
    if base_url:
        target_url = base_url.rstrip("/")
        if not target_url.endswith("/chat/completions"):
            target_url += "/chat/completions"
    elif provider == "openai":
        target_url = "https://api.openai.com/v1/chat/completions"
    elif provider == "deepseek":
        target_url = "https://api.deepseek.com/v1/chat/completions"
    elif provider == "openrouter":
        target_url = "https://openrouter.ai/api/v1/chat/completions"
    else:
        target_url = "https://api.openai.com/v1/chat/completions"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": USER_AGENT,
    }

    try:
        req = urllib.request.Request(target_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=45) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_body)
            msg = err_json.get("error", {}).get("message", err_body)
        except Exception:
            msg = err_body
        raise ValueError(f"{provider.upper()} API error ({e.code}): {msg}")
    except Exception as e:
        raise ValueError(f"{provider.upper()} request failed: {str(e)}")


def is_out_of_bounds_query(question: str, schema: dict) -> tuple[bool, str]:
    """
    Check if user question is out of bounds (unrelated to dataset analytics, BI, or project data)
    or is a conversational greeting/help request.
    Returns (is_out: bool, response_message: str)
    """
    q_raw = question.strip()
    q_lower = q_raw.lower()

    # 1. Greetings and Conversational Intent Check
    greetings = {
        'hello', 'hi', 'hey', 'greetings', 'howdy', 'good morning', 'good afternoon', 'good evening',
        'help', 'who are you', 'what can you do', 'how to use', 'what is insightai', 'what is this',
        'thanks', 'thank you', 'ok', 'okay', 'cool', 'awesome'
    }

    words = re.findall(r'\b[a-z0-9]+\b', q_lower)
    if not words or (len(words) <= 3 and any(w in greetings for w in words)):
        return True, (
            "CONVERSATIONAL: Hello! I am InsightAI, your dedicated Business Intelligence & Data Analytics assistant. "
            "How can I help you analyze your dataset today? You can ask me to run custom queries, compare metrics, "
            "generate visualizations, or uncover statistical trends across your data."
        )

    if q_lower in {'who are you', 'what can you do', 'what do you do', 'help me', 'how to use this', 'what is insightai'}:
        return True, (
            "CONVERSATIONAL: I am InsightAI, your dedicated Data Analytics & BI Assistant! "
            "I can convert your natural language questions into accurate SQL queries, build dynamic charts, "
            "compute statistical metrics, filter dataset records, and discover key insights. "
            "Try asking questions like 'Show total sales per region' or 'Top 5 categories by count'."
        )

    # 2. Explicit Out-of-Bounds Triggers (Unrelated LLM generation tasks)
    out_of_bounds_triggers = [
        'write a poem', 'tell me a joke', 'who is the president', 'capital of', 'weather in',
        'how to code', 'write a python script to', 'quicksort', 'fibonacci', 'recipe for',
        'translate to', 'who won the', 'what is the meaning of life', 'write an essay',
        'play a game', 'sing a song', 'story about', 'tell me about your model', 'create a game'
    ]

    for trigger in out_of_bounds_triggers:
        if trigger in q_lower:
            return True, (
                "OUT_OF_BOUNDS: I am InsightAI, your dedicated Business Intelligence & Data Analytics assistant. "
                "I can only answer questions related to your uploaded dataset, data analytics, visualizations, and project insights. "
                "Please ask a question about your dataset (e.g., 'What are the top categories?' or 'Show average score by group')."
            )

    # 3. Comprehensive Data & BI Analytics Intent & Column Match
    col_names = [str(col).lower() for col in schema.keys()] if schema else []

    # Normalized schema column variations (spaces, underscores, special characters)
    normalized_cols = set()
    col_tokens = set()
    for col in col_names:
        normalized_cols.add(col)
        normalized_cols.add(col.replace('_', ' '))
        normalized_cols.add(re.sub(r'[^a-z0-9]', '', col))
        for tok in col.replace('_', ' ').split():
            if len(tok) > 2 and tok not in {'data', 'type', 'name', 'code', 'date', 'text'}:
                col_tokens.add(tok)

    data_terms = [
        'select', 'show', 'find', 'get', 'list', 'top', 'bottom', 'average', 'avg', 'sum', 'count', 'max', 'min',
        'total', 'distribution', 'percentage', 'breakdown', 'trend', 'sales', 'profit', 'quantity', 'category',
        'region', 'discount', 'revenue', 'cost', 'amount', 'records', 'data', 'table', 'column', 'rows', 'chart',
        'compare', 'difference', 'highest', 'lowest', 'where', 'by', 'per', 'group', 'all', 'how many', 'what',
        'which', 'over time', 'correlation', 'rate', 'stats', 'summary', 'relationship', 'between', 'versus', 'vs',
        'against', 'impact', 'effect', 'influence', 'plot', 'scatter', 'line', 'bar', 'pie', 'histogram', 'filter',
        'order', 'sort', 'rank', 'median', 'mode', 'variance', 'std', 'deviation', 'most', 'least', 'score', 'rating',
        'value', 'metric', 'dimension'
    ]

    has_term_match = any(term in q_lower for term in data_terms)
    has_col_match = any(ncol in q_lower for ncol in normalized_cols if len(ncol) > 2)
    has_token_match = any(tok in q_lower for tok in col_tokens)

    has_data_intent = has_term_match or has_col_match or has_token_match

    if not has_data_intent and len(words) > 4:
        return True, (
            "OUT_OF_BOUNDS: I am InsightAI, your dedicated Business Intelligence & Data Analytics assistant. "
            "I can only answer questions related to your uploaded dataset, data analytics, visualizations, and project insights. "
            "Please ask a question about your dataset (e.g., 'What are the top categories?' or 'Show average score by group')."
        )

    return False, ""


def nl_to_sql(
    question: str,
    schema: dict,
    sample_rows: list = None,
    llm_config: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Convert a natural language question to a SQL query using the configured LLM provider.
    """
    # Guardrail check
    is_out, refusal_msg = is_out_of_bounds_query(question, schema)
    if is_out:
        if refusal_msg.startswith("CONVERSATIONAL:") or refusal_msg.startswith("OUT_OF_BOUNDS:"):
            return refusal_msg
        return f"OUT_OF_BOUNDS: {refusal_msg}"

    # Fast path for common inspection queries
    q_norm = question.lower().strip().rstrip('.?!')
    if q_norm in {'show all data', 'show all', 'select all', 'show data', 'all data', 'show records', 'view all data', 'view data'}:
        return "SELECT * FROM data LIMIT 1000"

    # Fast path for relationship / correlation queries between 2 columns
    rel_match = re.search(r'(?:relationship|correlation|compare|vs|versus)\s+(?:between\s+)?(.+?)\s+(?:and|vs|versus|with)\s+(.+)', q_norm, re.IGNORECASE)
    if rel_match and schema:
        target1, target2 = rel_match.group(1).strip(), rel_match.group(2).strip()
        col_map = {col.lower().replace('_', ' '): col for col in schema.keys()}
        matched1 = col_map.get(target1)
        matched2 = col_map.get(target2)
        if not matched1:
            for n_c, o_c in col_map.items():
                if target1 in n_c or n_c in target1:
                    matched1 = o_c
                    break
        if not matched2:
            for n_c, o_c in col_map.items():
                if target2 in n_c or n_c in target2:
                    matched2 = o_c
                    break
        if matched1 and matched2 and matched1 != matched2:
            return f'SELECT "{matched1}", "{matched2}" FROM data WHERE "{matched1}" IS NOT NULL AND "{matched2}" IS NOT NULL LIMIT 1000'

    # Fast path for compound 'show records where ...' queries (single or multi-condition)
    if q_norm.startswith('show records where '):
        conditions_str = question[len('show records where '):].strip()
        parts = re.split(r'\s+and\s+', conditions_str, flags=re.IGNORECASE)
        where_clauses = []
        valid_compound = True
        for part in parts:
            m = re.match(r"^\s*([\w_]+)\s+(?:is|=)\s+['\"](.+?)['\"]\s*$", part, re.IGNORECASE)
            if m:
                c_name, c_val = m.groups()
                where_clauses.append(f'"{c_name}" = \'{c_val}\'')
            else:
                valid_compound = False
                break
        if valid_compound and where_clauses:
            return f"SELECT * FROM data WHERE {' AND '.join(where_clauses)} LIMIT 1000"

    schema_str = "\n".join([f"  - {col} ({dtype})" for col, dtype in schema.items()])

    # Include a sample row for better column value understanding
    sample_str = ""
    if sample_rows and len(sample_rows) > 0:
        try:
            import json as _json
            sample_str = f"\nSAMPLE ROW (for context only):\n{_json.dumps(sample_rows[0], default=str)}\n"
        except Exception:
            pass

    prompt = f"""You are an expert SQL query generation agent for a Business Intelligence system.

Your task is to convert Natural Language queries into correct and optimized SQL queries
based strictly on the provided table schema.

DATABASE INFORMATION:
Table name: data

Columns and data types:
{schema_str}{sample_str}
STRICT SQL GENERATION RULES:
1. Use WHERE only for direct row-level filters (e.g., phone_hours > 6 per individual row).
2. Use GROUP BY when aggregation per category is required.
3. CRITICAL: If the NL query says "average X is above/below Y", "total X exceeds Y", or
   uses any aggregate condition — place it ONLY in HAVING, NEVER in WHERE.
4. NEVER duplicate a condition in both WHERE and HAVING. Each condition belongs in exactly one place:
   - Individual row values → WHERE
   - Aggregate results (AVG, SUM, COUNT, MIN, MAX) → HAVING
5. Never place aggregate functions inside WHERE.
6. Correct ORDER BY direction:
   - "lowest", "bottom", "worst" → ORDER BY ASC
   - "highest", "top", "best" → ORDER BY DESC
7. Apply LIMIT only after ORDER BY.
8. Only use columns that exist in the provided schema. Do not hallucinate column names.
9. Return only valid SQL — no explanations, no markdown, no backticks, no semicolons.
10. Use SQLite-compatible syntax.
11. For "relationship between X and Y" or "correlation between X and Y" → use SELECT X, Y FROM data.
12. For "top N X by Y" → SELECT X, SUM(Y) ... GROUP BY X ORDER BY SUM(Y) DESC LIMIT N.

EXAMPLE:
NL: "Find occupations where users use phones > 6 hours and have average stress above 7"
CORRECT: SELECT occupation, AVG(stress_level) FROM data WHERE phone_hours > 6 GROUP BY occupation HAVING AVG(stress_level) > 7

Convert the following Natural Language query into SQL:

{question}"""

    system_prompt = (
        "You are a SQL expert. Output ONLY a raw SQL SELECT query. "
        "No explanation, no markdown, no backticks, no semicolons. "
        "Never place aggregate conditions (AVG, SUM, etc.) in WHERE — use HAVING exclusively. "
        "Never output multiple statements. Output a single SELECT query only."
    )

    sql = call_llm(
        prompt=prompt,
        system_prompt=system_prompt,
        llm_config=llm_config,
        temperature=0.1,
        max_tokens=500,
    )

    # Clean markdown code blocks if present
    sql = re.sub(r'^```\w*\n?', '', sql)
    sql = re.sub(r'\n?```$', '', sql)
    sql = sql.strip()

    # Strip any trailing non-SELECT statements (e.g., injected DROP TABLE)
    # Keep only the first statement
    statements = [s.strip() for s in re.split(r';', sql) if s.strip()]
    if statements:
        sql = statements[0]

    # Ensure output is a SELECT or WITH (CTE) statement
    sql_upper = sql.upper().lstrip()
    if not (sql_upper.startswith('SELECT') or sql_upper.startswith('WITH')):
        # LLM returned garbage — fall back to SELECT *
        print(f"⚠️ LLM returned non-SELECT output, falling back. Raw: {sql[:80]}")
        sql = "SELECT * FROM data LIMIT 100"

    # Clean trailing semicolons
    sql = sql.rstrip(';').strip()

    # Fix WHERE/HAVING duplication
    sql = _fix_where_having_duplication(sql)

    return sql

