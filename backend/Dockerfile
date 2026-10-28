# MySchedule API — one image for three roles (see docker-compose.yml):
#   api     gunicorn + eventlet (REST, GraphQL, Socket.IO)        ← default CMD
#   worker  celery -A workers.celery_app:celery worker
#   migrate flask --app app.py db upgrade -d migrations
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Alembic owns the schema in containers; never create tables at import time.
    AUTO_CREATE_TABLES=false \
    FLASK_ENV=production

WORKDIR /app

# Dependencies first so code changes don't invalidate the pip layer.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

EXPOSE 5000

# One eventlet worker per container (Flask-SocketIO's supported setup); one worker serves
# many concurrent connections. Scale with more containers — events fan out through Redis.
CMD ["gunicorn", "--worker-class", "eventlet", "--workers", "1", \
     "--bind", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", \
     "--graceful-timeout", "20", "app:app"]
