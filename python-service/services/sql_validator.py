"""
Root-level alias for app.services.sql_validator.
Exposes AST validation functions.
"""

from app.services.sql_validator import FORBIDDEN_AST_NODES, validate_sql

__all__ = ["validate_sql", "FORBIDDEN_AST_NODES"]
