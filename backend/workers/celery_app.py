# workers/celery_app.py
"""Celery entrypoint:  celery -A workers.celery_app:celery worker --loglevel=info

Importing `app` builds the Flask app, which configures the shared Celery instance
(broker, result backend, app-context tasks) in extensions.init_extensions.
"""
from app import app as flask_app  # noqa: F401  (configures celery)
from extensions import celery
import workers.tasks  # noqa: F401  (registers the tasks)

__all__ = ["celery"]
