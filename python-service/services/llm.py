"""
LLM service — Natural Language to SQL conversion using Groq (ChatGroq).
Uses Llama 3.3 70B model for fast, high-quality SQL generation.
"""
import os
import re
from groq import Groq

# Initialize Groq client
client = None


def get_client():
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
        client = Groq(api_key=api_key)
    return client


def _fix_where_having_duplication(sql: str) -> str:
    """
    Post-processing fix: Remove from the WHERE clause any conditions on columns
    that are also filtered via aggregate functions (AVG, SUM, COUNT, MIN, MAX)
    in the HAVING clause. These conditions are incorrect in WHERE because the NL
    query refers to *aggregate* values, not individual row values.

    Example fix:
      WHERE daily_phone_hours > 6 AND stress_level > 7   ← stress_level is an
      HAVING AVG(stress_level) > 7                        ← aggregate condition
    →
      WHERE daily_phone_hours > 6
      HAVING AVG(stress_level) > 7
    """
    # Find columns referenced inside aggregate functions in HAVING
    having_match = re.search(r'\bHAVING\b(.+?)(?:\bORDER\b|\bLIMIT\b|$)', sql, re.IGNORECASE | re.DOTALL)
    if not having_match:
        return sql

    having_clause = having_match.group(1)
    # Extract column names inside AVG/SUM/COUNT/MIN/MAX(...) in HAVING
    agg_cols = set(re.findall(
        r'\b(?:AVG|SUM|COUNT|MIN|MAX)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)',
        having_clause, re.IGNORECASE
    ))

    if not agg_cols:
        return sql

    # Find and clean WHERE clause
    where_match = re.search(r'\bWHERE\b(.+?)(?:\bGROUP\b|\bHAVING\b|\bORDER\b|\bLIMIT\b)', sql, re.IGNORECASE | re.DOTALL)
    if not where_match:
        return sql

    where_body = where_match.group(1).strip()

    # Split WHERE conditions by AND (simple split — covers most real cases)
    conditions = re.split(r'\bAND\b', where_body, flags=re.IGNORECASE)
    cleaned = []
    for cond in conditions:
        cond_stripped = cond.strip()
        # Check if this condition references any aggregated column
        col_in_cond = re.match(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*[><=!]', cond_stripped)
        if col_in_cond and col_in_cond.group(1).lower() in {c.lower() for c in agg_cols}:
            continue  # Remove — this belongs in HAVING, not WHERE
        cleaned.append(cond_stripped)

    if not cleaned:
        # Remove WHERE entirely if all conditions were duplicates
        sql = re.sub(r'\bWHERE\b.+?(?=\bGROUP\b|\bHAVING\b|\bORDER\b|\bLIMIT\b)', '', sql, flags=re.IGNORECASE | re.DOTALL)
    else:
        new_where = " AND ".join(cleaned)
        sql = sql[:where_match.start(1)] + " " + new_where + " " + sql[where_match.end(1):]

    return sql.strip()


def nl_to_sql(question: str, schema: dict, sample_rows: list = None) -> str:
    """
    Convert a natural language question to a SQL query using Groq.

    Args:
        question: User's natural language question
        schema: Dictionary of {column_name: column_type}
        sample_rows: Ignored — not sent to LLM to stay within token limits

    Returns:
        A safe SELECT SQL query string
    """
    # Fast path for common inspection queries
    q_norm = question.lower().strip().rstrip('.?!')
    if q_norm in {'show all data', 'show all', 'select all', 'show data', 'all data', 'show records', 'view all data', 'view data'}:
        return "SELECT * FROM data LIMIT 1000"

    match_filter = re.match(r"^show records where ([\w_]+) is ['\"](.+)['\"]$", q_norm, re.IGNORECASE)
    if match_filter:
        col_name, val = match_filter.groups()
        return f'SELECT * FROM data WHERE "{col_name}" = \'{val}\' LIMIT 1000'

    # Build schema string: "column_name (TYPE)" per entry
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

EXAMPLE (correct WHERE vs HAVING usage):
NL: "Find occupations where users use phones > 6 hours and have average stress above 7"
WRONG:  WHERE phone_hours > 6 AND stress_level > 7  HAVING AVG(stress_level) > 7
CORRECT: WHERE phone_hours > 6  HAVING AVG(stress_level) > 7

Convert the following Natural Language query into SQL:

{question}"""

    try:
        groq_client = get_client()
        model_name = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()
        try:
            response = groq_client.chat.completions.create(
                model=model_name,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a SQL expert. Output ONLY a raw SQL SELECT query. "
                            "No explanation, no markdown, no backticks, no semicolons. "
                            "Never place aggregate conditions (AVG, SUM, etc.) in WHERE — use HAVING exclusively."
                        )
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.1,
                max_tokens=500,
            )
        except Exception as model_err:
            if "model_not_found" in str(model_err) or "does not exist" in str(model_err):
                fallback = "openai/gpt-oss-120b"
                if model_name != fallback:
                    print(f"⚠️ Model '{model_name}' not found, falling back to '{fallback}'")
                    response = groq_client.chat.completions.create(
                        model=fallback,
                        messages=[
                            {
                                "role": "system",
                                "content": "You are a SQL expert. Output ONLY a raw SQL SELECT query. No explanation, no markdown, no backticks, no semicolons."
                            },
                            {
                                "role": "user",
                                "content": prompt
                            }
                        ],
                        temperature=0.1,
                        max_tokens=500,
                    )
                else:
                    raise
            else:
                raise

        sql = response.choices[0].message.content.strip()

        # Step 1: Remove markdown code blocks if present
        sql = re.sub(r'^```\w*\n?', '', sql)
        sql = re.sub(r'\n?```$', '', sql)
        sql = sql.strip()

        # Step 2: Remove trailing semicolons for SQLite compatibility
        sql = sql.rstrip(';')

        # Step 3: Fix WHERE/HAVING duplication (LLM safety net)
        sql = _fix_where_having_duplication(sql)

        return sql

    except Exception as e:
        raise ValueError(f"Groq API error: {str(e)}")
