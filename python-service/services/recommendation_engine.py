"""
Recommendation Engine — Grounded LLM Generation for Executive Summaries
and Next Best Question Suggestion Chips.

All LLM interactions are strictly grounded:
  - Root-Cause Narrative: Receives ONLY pre-computed statistical drivers (never raw data).
    Enforced system prompt forbids hallucination outside the provided statistics.
  - Next Best Question: Receives only the dataset schema and last query context.
    Returns exactly 3 actionable follow-up questions as a JSON list of strings.

Stateless: no internal state is retained between invocations.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional

from models.intelligence import VarianceDriver
from services.llm import call_llm

logger = logging.getLogger("insightai.recommendation_engine")


class RecommendationEngine:
    """
    LLM-powered intelligence layer for grounded executive narratives
    and context-aware follow-up question generation.
    """

    # ─── Root-Cause Executive Summary ────────────────────────────────────────

    @classmethod
    def generate_variance_narrative(
        cls,
        metric_column: str,
        aggregation: str,
        baseline_total: float,
        comparison_total: float,
        total_absolute_change: float,
        total_percentage_change: float,
        top_drivers: List[VarianceDriver],
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Generate a concise 2-sentence executive summary explaining the root cause
        of an observed variance. The LLM receives ONLY the pre-computed statistical
        drivers — never raw data.

        Args:
            metric_column:           Name of the analyzed metric.
            aggregation:             Aggregation function used (SUM, AVG, etc.).
            baseline_total:          Total metric value in the baseline period.
            comparison_total:        Total metric value in the comparison period.
            total_absolute_change:   Overall absolute change.
            total_percentage_change: Overall percentage change.
            top_drivers:             Ranked list of VarianceDriver objects from DuckDB.
            llm_config:              Optional LLM provider configuration override.

        Returns:
            A 2-sentence executive narrative string.
        """
        # Format the statistical payload for the LLM
        direction = "increased" if total_absolute_change > 0 else "decreased"
        driver_descriptions = []

        for i, driver in enumerate(top_drivers, 1):
            driver_dir = "increased" if driver.absolute_change > 0 else "decreased"
            driver_descriptions.append(
                f"  Driver #{i}: {driver.dimension}='{driver.segment}' — "
                f"{driver_dir} by {abs(driver.absolute_change):,.2f} "
                f"({driver.percentage_change:+.1f}%), "
                f"contributing {abs(driver.contribution_pct):.1f}% of total variance. "
                f"(Baseline: {driver.baseline_value:,.2f} → Comparison: {driver.comparison_value:,.2f})"
            )

        drivers_block = "\n".join(driver_descriptions) if driver_descriptions else "  No significant drivers identified."

        prompt = f"""You are given a statistical variance analysis for the metric "{metric_column}" ({aggregation}).

OVERALL CHANGE:
  Baseline Total: {baseline_total:,.2f}
  Comparison Total: {comparison_total:,.2f}
  Change: {total_absolute_change:+,.2f} ({total_percentage_change:+.1f}%) — {direction}

TOP CONTRIBUTING DRIVERS (pre-computed from the database):
{drivers_block}

TASK: Write exactly 2 sentences summarizing why the metric {direction}. 
Sentence 1: State the overall change and its magnitude.
Sentence 2: Attribute the change to the specific drivers listed above with their exact numbers.

Do NOT invent, speculate, or add any information beyond what is provided above."""

        system_prompt = (
            "You are a concise business intelligence analyst. "
            "You MUST produce exactly 2 sentences. "
            "You are strictly forbidden from hallucinating, speculating, or adding any reasons "
            "beyond the statistical drivers provided. Use only the exact numbers given. "
            "Do not use bullet points, markdown, or formatting — just 2 plain sentences."
        )

        try:
            narrative = call_llm(
                prompt=prompt,
                system_prompt=system_prompt,
                llm_config=llm_config,
                temperature=0.1,
                max_tokens=300,
            )

            # Post-process: ensure it's clean text without markdown artifacts
            narrative = narrative.strip()
            narrative = re.sub(r'^```\w*\n?', '', narrative)
            narrative = re.sub(r'\n?```$', '', narrative)
            narrative = narrative.strip()

            return narrative

        except Exception as exc:
            logger.error(f"LLM narrative generation failed: {exc}", exc_info=True)
            # Graceful fallback: construct a deterministic summary from the statistics
            if top_drivers:
                top = top_drivers[0]
                fallback = (
                    f"The {aggregation.lower()} of {metric_column} {direction} by "
                    f"{abs(total_absolute_change):,.2f} ({total_percentage_change:+.1f}%) "
                    f"between the baseline and comparison periods. "
                    f"The largest contributing factor was {top.dimension}='{top.segment}', "
                    f"which accounted for {abs(top.contribution_pct):.1f}% of the total variance "
                    f"with a change of {top.absolute_change:+,.2f}."
                )
            else:
                fallback = (
                    f"The {aggregation.lower()} of {metric_column} {direction} by "
                    f"{abs(total_absolute_change):,.2f} ({total_percentage_change:+.1f}%). "
                    f"No dominant single-dimension driver was identified for this variance."
                )
            return fallback

    # ─── Next Best Question Generation ───────────────────────────────────────

    @classmethod
    def generate_next_questions(
        cls,
        schema_summary: Dict[str, Any],
        last_query: Optional[str] = None,
        last_sql: Optional[str] = None,
        last_result_columns: Optional[List[str]] = None,
        last_result_sample: Optional[List[Dict[str, Any]]] = None,
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        """
        Generate exactly 3 actionable follow-up question suggestion chips
        based on the dataset schema and the user's last query context.

        Args:
            schema_summary:       Dict with columns, categorical_columns, numeric_columns, sample_values.
            last_query:           The user's most recent natural language question.
            last_sql:             The SQL that was last executed.
            last_result_columns:  Column names from the last result set.
            last_result_sample:   Up to 5 sample rows from the last result.
            llm_config:           Optional LLM provider configuration.

        Returns:
            A list of exactly 3 follow-up question strings.
        """
        # Build schema context block
        columns_desc = "\n".join(
            f"  - {col} ({dtype})"
            for col, dtype in schema_summary.get("columns", {}).items()
        )

        categorical = schema_summary.get("categorical_columns", [])
        numeric = schema_summary.get("numeric_columns", [])
        sample_vals = schema_summary.get("sample_values", {})

        schema_block = f"""DATASET SCHEMA:
{columns_desc}

Categorical columns: {', '.join(categorical) if categorical else 'None detected'}
Numeric columns: {', '.join(numeric) if numeric else 'None detected'}
Total rows: {schema_summary.get('row_count', 'unknown')}"""

        if sample_vals:
            samples_desc = "\n".join(
                f"  {col}: {', '.join(vals[:3])}"
                for col, vals in sample_vals.items()
            )
            schema_block += f"\n\nSample values for categorical columns:\n{samples_desc}"

        # Build last-query context block
        context_block = ""
        if last_query:
            context_block += f"\nLAST USER QUESTION: {last_query}"
        if last_sql:
            context_block += f"\nLAST EXECUTED SQL: {last_sql}"
        if last_result_columns:
            context_block += f"\nLAST RESULT COLUMNS: {', '.join(last_result_columns)}"
        if last_result_sample:
            # Only send first 3 rows as compact JSON
            compact_sample = json.dumps(last_result_sample[:3], default=str)
            context_block += f"\nLAST RESULT SAMPLE (first 3 rows): {compact_sample}"

        if not context_block:
            context_block = "\nNo previous query context available. Suggest exploratory questions."

        prompt = f"""{schema_block}
{context_block}

TASK: Generate exactly 3 follow-up questions that a business analyst would naturally ask next.
Each question should:
  1. Be actionable and answerable from this dataset.
  2. Reference specific column names from the schema.
  3. Build logically on the last query context (if available) or explore the dataset.
  4. Be distinct from each other — cover different analytical angles.

Return your answer as a JSON array of exactly 3 strings. Example format:
["What is the average revenue by region?", "Which category has the highest profit margin?", "How does sales volume trend over time?"]

Return ONLY the JSON array. No explanation, no markdown."""

        system_prompt = (
            "You are a business intelligence assistant that generates follow-up analytical questions. "
            "You MUST return exactly a JSON array of 3 strings. No other text, no markdown formatting, "
            "no code blocks. Only reference columns that exist in the provided schema."
        )

        try:
            raw_response = call_llm(
                prompt=prompt,
                system_prompt=system_prompt,
                llm_config=llm_config,
                temperature=0.4,
                max_tokens=400,
            )

            # Parse the JSON response
            cleaned = raw_response.strip()
            cleaned = re.sub(r'^```\w*\n?', '', cleaned)
            cleaned = re.sub(r'\n?```$', '', cleaned)
            cleaned = cleaned.strip()

            # Extract JSON array from response (handle cases where LLM wraps it)
            json_match = re.search(r'\[.*\]', cleaned, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group(0))
            else:
                parsed = json.loads(cleaned)

            # Validate structure
            if isinstance(parsed, list) and all(isinstance(q, str) for q in parsed):
                return parsed[:3] if len(parsed) >= 3 else parsed
            else:
                raise ValueError("LLM did not return a valid list of strings.")

        except Exception as exc:
            logger.error(f"LLM next-question generation failed: {exc}", exc_info=True)
            # Deterministic fallback questions from schema
            fallback_questions = cls._generate_fallback_questions(
                categorical=categorical,
                numeric=numeric,
                last_query=last_query,
            )
            return fallback_questions

    @staticmethod
    def _generate_fallback_questions(
        categorical: List[str],
        numeric: List[str],
        last_query: Optional[str] = None,
    ) -> List[str]:
        """
        Generate deterministic fallback questions when the LLM is unavailable.
        Uses schema metadata to construct sensible analytical questions.
        """
        questions: List[str] = []

        if numeric and categorical:
            questions.append(
                f"What is the average {numeric[0].replace('_', ' ')} "
                f"broken down by {categorical[0].replace('_', ' ')}?"
            )
        if len(numeric) >= 2:
            questions.append(
                f"How does {numeric[0].replace('_', ' ')} correlate with "
                f"{numeric[1].replace('_', ' ')}?"
            )
        if categorical:
            questions.append(
                f"Which {categorical[0].replace('_', ' ')} has the highest total "
                f"{numeric[0].replace('_', ' ') if numeric else 'count'}?"
            )

        # Pad to 3 if needed
        generic = [
            "What are the top 5 records by the primary metric?",
            "Show the distribution of values across all categories.",
            "What is the overall trend over time?",
        ]
        while len(questions) < 3:
            questions.append(generic[len(questions) % len(generic)])

        return questions[:3]
