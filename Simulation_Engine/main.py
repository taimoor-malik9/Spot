"""Compatibility entry point for the simulation engine.

The complete FastAPI application lives in ``api.py``. Keep ``main:app``
as a supported Uvicorn target because ``fastapi dev`` and older local
commands commonly discover or launch ``main.py`` automatically.
"""

from api import app

__all__ = ["app"]
