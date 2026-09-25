"""
Root-level alias for app.api.routes.visualization.
Exposes visualization router and endpoints.
"""

from app.api.routes.visualization import router, auto_visualize_dataset

__all__ = ["router", "auto_visualize_dataset"]
