"""
Root-level alias for app.services.visualization_engine.
Exposes VisualizationEngine for auto-chart recommendation and semantic metrics.
"""

from app.services.visualization_engine import VisualizationEngine, ColumnProfile

__all__ = ["VisualizationEngine", "ColumnProfile"]
