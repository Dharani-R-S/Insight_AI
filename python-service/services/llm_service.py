"""
Root-level alias for app.services.llm_service.
Exposes Groq LLM Text-to-SQL generation functions.
"""

from app.services.llm_service import LLMService, clean_llm_sql_response

__all__ = ["LLMService", "clean_llm_sql_response"]
