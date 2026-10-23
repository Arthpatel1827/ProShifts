# tests/conftest.py
"""
Integration tests run against a real PostgreSQL database (the schema uses CITEXT and
JSON columns) and Redis (JWT blocklist). Point them at throwaway instances:

    export TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/myschedule_test
    export TEST_REDIS_URL=redis://localhost:6379/15
    pytest

Every table is truncated between tests, so never point TEST_DATABASE_URL at real data.
"""
import os
import sys
from datetime import date, datetime, timedelta

import pytest

TEST_DB = os.getenv("TEST_DATABASE_URL")
TEST_REDIS = os.getenv("TEST_REDIS_URL", "redis://localhost:6379/15")

if not TEST_DB:
    pytest.skip("TEST_DATABASE_URL is not set — skipping integration tests", allow_module_level=True)

# Must be set before app.py is imported: it builds the app at import time.
os.environ.update({
    "DATABASE_URL": TEST_DB,
    "REDIS_URL": TEST_REDIS,
    "CELERY_BROKER_URL": TEST_REDIS,
    "CELERY_RESULT_BACKEND": TEST_REDIS,
    "JWT_SECRET_KEY": "test-only-secret-key-that-is-long-enough-1234",
    "FLASK_ENV": "development",
    "EMAIL_SENDING_ENABLED": "false",
    "CORS_ORIGINS": "http://localhost:3000",
})
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import app as flask_app  # noqa: E402
from extensions import db  # noqa: E402
from flask_jwt_extended import create_access_token  # noqa: E402
from models import (  # noqa: E402
    AppUser, Company, Employment, Location, Role, Shift, ShiftAssignment,
)
from utils.security import hash_password  # noqa: E402

PASSWORD = "Correct-horse-1"


@pytest.fixture(scope="session")
def app():
    flask_app.config.update(TESTING=True, RATELIMIT_ENABLED=False)
    return flask_app


@pytest.fixture(autouse=True)
def clean_db(app):
    yield
    with app.app_context():
        db.session.remove()
        tables = ", ".join(f'"{t.name}"' for t in db.metadata.sorted_tables)
        db.session.execute(db.text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        db.session.commit()


@pytest.fixture
def client(app):
    return app.test_client()


class World:
    """Two companies, so every test can try to cross the tenant boundary."""

    def __init__(self, app):
        self.app = app
        with app.app_context():
            self.comp_a = self._company("Cafe A", "a@cafe.test")
            self.loc_a = self._location(self.comp_a, "Downtown")
            self.loc_a2 = self._location(self.comp_a, "Uptown")
            self.comp_b = self._company("Bistro B", "b@bistro.test")
            self.loc_b = self._location(self.comp_b, "Harbour")

            self.role_owner_a = self._role(self.loc_a, "Owner")
            self.role_mgr_a = self._role(self.loc_a, "Manager")
            self.role_barista = self._role(self.loc_a, "Barista")
            self.role_owner_b = self._role(self.loc_b, "Owner")

            self.owner_a = self._user("owner@a.test", "Olive Owner", self.comp_a, self.loc_a, self.role_owner_a, rate=30)
            self.manager_a = self._user("manager@a.test", "Max Manager", self.comp_a, self.loc_a, self.role_mgr_a, rate=25)
            self.staff_a = self._user("sam@a.test", "Sam Staff", self.comp_a, self.loc_a, self.role_barista, rate=20)
            self.staff_a2 = self._user("ria@a.test", "Ria Barista", self.comp_a, self.loc_a, self.role_barista, rate=18)
            self.owner_b = self._user("owner@b.test", "Bea Owner", self.comp_b, self.loc_b, self.role_owner_b, rate=40)
            db.session.commit()

    def _company(self, name, email):
        c = Company(comp_name=name, comp_email=email, is_verified=True)
        db.session.add(c)
        db.session.flush()
        return c.comp_id

    def _location(self, comp_id, name):
        loc = Location(comp_id=comp_id, loc_name=name, timezone="UTC")
        db.session.add(loc)
        db.session.flush()
        return loc.loc_id

    def _role(self, loc_id, name):
        r = Role(name=name, location_id=loc_id, is_system=True)
        db.session.add(r)
        db.session.flush()
        return r.role_id

    def _user(self, email, name, comp_id, loc_id, role_id, rate=None, verified=True):
        u = AppUser(username=email, user_email=email, user_password=hash_password(PASSWORD),
                    is_verified=verified, display_name=name)
        db.session.add(u)
        db.session.flush()
        db.session.add(Employment(user_id=u.user_id, comp_id=comp_id, location_id=loc_id,
                                  role_id=role_id, status="active", hourly_rate=rate))
        db.session.flush()
        return u.user_id

    def headers(self, user_id):
        with self.app.app_context():
            return {"Authorization": f"Bearer {create_access_token(identity=str(user_id))}"}

    def shift(self, loc_id, start, hours=8, assign=(), status="draft", break_minutes=0):
        with self.app.app_context():
            s = Shift(location_id=loc_id, start_time=start, end_time=start + timedelta(hours=hours),
                      status=status, break_minutes=break_minutes)
            db.session.add(s)
            db.session.flush()
            for uid in assign:
                db.session.add(ShiftAssignment(shift_id=s.shift_id, user_id=uid))
            db.session.commit()
            return s.shift_id


@pytest.fixture
def world(app):
    return World(app)


def next_monday() -> datetime:
    today = date.today()
    monday = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
    return datetime(monday.year, monday.month, monday.day)
