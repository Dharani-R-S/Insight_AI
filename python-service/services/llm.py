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
                # Groq SDK internally appends /openai/v1/chat/completions
                clean_base = re.sub(r'/openai/v1/?$', '', clean_base)
                # Only pass base_url if it is not the default Groq endpoint
                if clean_base and clean_base not in ("https://api.groq.com", "http://api.groq.com"):
                    groq_kwargs["base_url"] = clean_base

            client = Groq(**groq_kwargs)
            
            try:
                completion = client.chat.completions.create(
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
                    print(f"[Groq] Model '{model}' not accessible. Retrying with 'openai/gpt-oss-120b'...")
                    fallback_completion = client.chat.completions.create(
                        model="openai/gpt-oss-120b",
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": prompt},
                        ],
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                    return fallback_completion.choices[0].message.content.strip()
                raise first_try_err

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

    # ─── 3. GOOGLE GEMINI (OpenAI-compatible /chat/completions or generateContent) ───
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

    # ─── 4. OPENAI / GROQ REST / DEEPSEEK / OPENROUTER / OLLAMA ───
    if base_url:
        target_url = base_url.rstrip("/")
        if not target_url.endswith("/chat/completions"):
            target_url += "/chat/completions"
    elif provider == "groq":
        target_url = "https://api.groq.com/openai/v1/chat/completions"
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


def nl_to_sql(
    question: str,
    schema: dict,
    sample_rows: list = None,
    llm_config: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Convert a natural language question to a SQL query using the configured LLM provider.
    """
    schema_str = "\n".join([f"  - {col} ({dtype})" for col, dtype in schema.items()])

    prompt = f"""You are an expert SQL query generation agent for a Business Intelligence system.

Your task is to convert Natural Language queries into correct and optimized SQL queries
based strictly on the provided table schema.

DATABASE INFORMATION:
Table name: data

Columns and data types:
{schema_str}

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

EXAMPLE:
NL: "Find occupations where users use phones > 6 hours and have average stress above 7"
CORRECT: SELECT occupation, AVG(stress_level) FROM data WHERE phone_hours > 6 GROUP BY occupation HAVING AVG(stress_level) > 7

Convert the following Natural Language query into SQL:

{question}"""

    system_prompt = (
        "You are a SQL expert. Output ONLY a raw SQL SELECT query. "
        "No explanation, no markdown, no backticks, no semicolons. "
        "Never place aggregate conditions (AVG, SUM, etc.) in WHERE — use HAVING exclusively."
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

    # Clean trailing semicolons
    sql = sql.rstrip(';')

    # Fix WHERE/HAVING duplication
    sql = _fix_where_having_duplication(sql)

    return sql

