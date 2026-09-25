"""
Root-level alias for app.api.routes.analytics.
Provides the analytics router and POST /api/ask endpoint.
"""

from app.api.routes.analytics import router, ask_question, AskRequest, AskResponse

__all__ = ["router", "ask_question", "AskRequest", "AskResponse"]
