"""
Root-level alias for app.services.transformation_compiler.
Exposes DuckDBCompiler for CTE-based SQL compilation.
"""

from app.services.transformation_compiler import DuckDBCompiler

__all__ = ["DuckDBCompiler"]
