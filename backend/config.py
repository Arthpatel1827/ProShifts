# config.py
import os
from datetime import timedelta


class Config:
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
        "pool_size": 10,
        "max_overflow": 20,
        # Pin the session to UTC so naive values and timestamptz output never depend on the
        # database server's own timezone setting. Local days come from Location.timezone.
        "connect_args": {"options": "-c timezone=UTC"},
    }
    JSON_SORT_KEYS = False

    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-change-me")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        seconds=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES", "3600"))
    )
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(
        seconds=int(os.getenv("JWT_REFRESH_TOKEN_EXPIRES", "2592000"))
    )

    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/1")
    CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/2")
    CELERY_TASK_SERIALIZER = "json"
    CELERY_RESULT_SERIALIZER = "json"
    CELERY_ACCEPT_CONTENT = ["json"]
    CELERY_TIMEZONE = "UTC"

    SOCKETIO_MESSAGE_QUEUE = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    RATELIMIT_STORAGE_URI = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    RATELIMIT_DEFAULT = "200 per day;50 per hour"

    # NVIDIA Nemotron (OpenAI-compatible API). Server-side only — never sent to clients.
    NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
    NVIDIA_BASE_URL = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
    NVIDIA_NEMOTRON_MODEL = os.getenv("NVIDIA_NEMOTRON_MODEL", "nvidia/nemotron-3-super-120b-a12b")
    NVIDIA_TIMEOUT_SECONDS = float(os.getenv("NVIDIA_TIMEOUT_SECONDS", "60"))
    NVIDIA_NEMOTRON_REASONING = os.getenv("NVIDIA_NEMOTRON_REASONING", "false").lower() == "true"
    # Weekly hours after which overtime applies (varies by jurisdiction, e.g. 40 or 44).
    OVERTIME_WEEKLY_HOURS = float(os.getenv("OVERTIME_WEEKLY_HOURS", "40"))

    MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
    MAIL_USE_TLS = os.getenv("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USERNAME = os.getenv("MAIL_USERNAME")
    MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
    MAIL_DEFAULT_SENDER = os.getenv("MAIL_DEFAULT_SENDER")
    EMAIL_SENDING_ENABLED = os.getenv("EMAIL_SENDING_ENABLED", "false").lower() == "true"
    # Flask-Mail defaults MAIL_DEBUG to app.debug, which prints the whole SMTP session —
    # including the base64 AUTH line, i.e. the mail password — to the console.
    MAIL_DEBUG = False

    EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


class DevConfig(Config):
    DEBUG = True
    ENV_NAME = "development"
    RATELIMIT_STORAGE_URI = os.getenv("REDIS_URL", "memory://")


class ProdConfig(Config):
    DEBUG = False
    ENV_NAME = "production"