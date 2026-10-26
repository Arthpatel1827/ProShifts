"""Regression tests for location-local calendar days.

The bug: "today" was UTC midnight → UTC midnight. In Toronto (UTC-4 in summer) that
meant every evening from 8 PM the dashboard showed *tomorrow's* team, and naive shift
times were stored in the database server's timezone instead of the location's.

Time is frozen by patching utils.timezones.utc_now, the single source of "now".
"""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from utils import timezones as tzu

TORONTO = ZoneInfo("America/Toronto")
TOKYO = ZoneInfo("Asia/Tokyo")


# ── helpers ───────────────────────────────────────────────────────────────────

@pytest.fixture
def freeze(monkeypatch):
    """freeze(datetime_with_tz) — fixes 'now' for everything that uses tzu.utc_now()."""
    def _freeze(moment: datetime):
        assert moment.tzinfo is not None
        monkeypatch.setattr(tzu, "utc_now", lambda: moment.astimezone(timezone.utc))
    return _freeze


def set_tz(app, loc_id, name):
    from extensions import db
    from models import Location
    with app.app_context():
        db.session.get(Location, loc_id).timezone = name
        db.session.commit()


def local(tz, y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=tz)


def team(client, world, loc_id, as_user=None):
    res = client.get(f"/time-entries/team-status?location_id={loc_id}",
                     headers=world.headers(as_user or world.manager_a))
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def names(body):
    return {m["name"] for m in body["team"]}


# ── unit: day boundaries ──────────────────────────────────────────────────────

def test_day_bounds_are_local_midnights():
    start, end = tzu.day_bounds(TORONTO, date(2026, 10, 25))
    assert start == datetime(2026, 10, 25, 4, 0, tzinfo=timezone.utc)   # 00:00 EDT
    assert end == datetime(2026, 10, 26, 4, 0, tzinfo=timezone.utc)


def test_dst_days_are_23_and_25_hours_long():
    # Toronto 2026: DST starts Sun Mar 8, ends Sun Nov 1.
    s, e = tzu.day_bounds(TORONTO, date(2026, 3, 8))
    assert e - s == timedelta(hours=23)
    s, e = tzu.day_bounds(TORONTO, date(2026, 11, 1))
    assert e - s == timedelta(hours=25)
    s, e = tzu.week_bounds(TORONTO, date(2026, 11, 1))   # week containing the change
    assert e - s == timedelta(days=7, hours=1)


def test_unknown_timezone_falls_back_to_utc():
    assert tzu.get_tz("Not/AZone").key == "UTC"
    assert tzu.get_tz(None).key == "UTC"
    assert not tzu.is_valid_timezone("Mars/Base") and tzu.is_valid_timezone("America/Toronto")


# ── Today's Team ──────────────────────────────────────────────────────────────

def test_toronto_evening_after_utc_midnight_shows_toronto_today(app, client, world, freeze):
    """10:30 PM Oct 25 in Toronto is already Oct 26 in UTC — the exact bug."""
    set_tz(app, world.loc_a, "America/Toronto")
    tonight = world.shift(world.loc_a, local(TORONTO, 2026, 10, 25, 18), hours=5.5,
                          assign=[world.staff_a], status="published")
    tomorrow = world.shift(world.loc_a, local(TORONTO, 2026, 10, 26, 9), hours=6,
                           assign=[world.staff_a2], status="published")
    freeze(local(TORONTO, 2026, 10, 25, 22, 30))   # = 2026-10-26 02:30 UTC

    body = team(client, world, world.loc_a)
    assert body["date"] == "2026-10-25"
    assert body["timezone"] == "America/Toronto"
    assert names(body) == {"Sam Staff"}            # tonight's shift, not tomorrow's
    assert tonight and tomorrow


def test_toronto_early_morning_rolls_to_the_new_local_day(app, client, world, freeze):
    set_tz(app, world.loc_a, "America/Toronto")
    world.shift(world.loc_a, local(TORONTO, 2026, 10, 25, 17), hours=4,
                assign=[world.staff_a], status="published")       # yesterday, finished
    world.shift(world.loc_a, local(TORONTO, 2026, 10, 26, 8), hours=8,
                assign=[world.staff_a2], status="published")      # today
    freeze(local(TORONTO, 2026, 10, 26, 0, 30))    # 12:30 AM local = 04:30 UTC

    body = team(client, world, world.loc_a)
    assert body["date"] == "2026-10-26"
    assert names(body) == {"Ria Barista"}


def test_overnight_shift_stays_one_shift_across_midnight(app, client, world, freeze):
    set_tz(app, world.loc_a, "America/Toronto")
    start = local(TORONTO, 2026, 10, 25, 23)
    world.shift(world.loc_a, start, hours=4, assign=[world.staff_a], status="published")  # 11 PM → 3 AM

    freeze(local(TORONTO, 2026, 10, 25, 23, 5))    # just after it starts
    m = team(client, world, world.loc_a)["team"][0]
    assert m["name"] == "Sam Staff" and m["status"] == "scheduled"

    freeze(local(TORONTO, 2026, 10, 26, 1, 0))     # 1 AM: a new local day, shift still running
    body = team(client, world, world.loc_a)
    assert body["date"] == "2026-10-26"
    m = body["team"][0]
    assert m["name"] == "Sam Staff"
    assert datetime.fromisoformat(m["shift_start"]) == start
    assert datetime.fromisoformat(m["shift_end"]) == local(TORONTO, 2026, 10, 26, 3)

    freeze(local(TORONTO, 2026, 10, 26, 4, 0))     # after it ended
    assert team(client, world, world.loc_a)["team"] == []


def test_late_detection_uses_the_same_15_minute_grace(app, client, world, freeze):
    set_tz(app, world.loc_a, "America/Toronto")
    world.shift(world.loc_a, local(TORONTO, 2026, 10, 25, 21, 0), hours=3,
                assign=[world.staff_a], status="published")
    world.shift(world.loc_a, local(TORONTO, 2026, 10, 25, 21, 10), hours=3,
                assign=[world.staff_a2], status="published")
    freeze(local(TORONTO, 2026, 10, 25, 21, 20))   # 01:20 UTC on Oct 26

    status = {m["name"]: m["status"] for m in team(client, world, world.loc_a)["team"]}
    assert status == {"Sam Staff": "late", "Ria Barista": "scheduled"}


def test_other_timezone_ahead_of_utc(app, client, world, freeze):
    """Tokyo is ahead of UTC: its morning is still the previous UTC day."""
    set_tz(app, world.loc_b, "Asia/Tokyo")
    world.shift(world.loc_b, local(TOKYO, 2026, 10, 26, 9), hours=8,
                assign=[world.owner_b], status="published")       # 00:00 UTC Oct 26
    freeze(local(TOKYO, 2026, 10, 26, 8, 30))      # = 2026-10-25 23:30 UTC

    body = team(client, world, world.loc_b, as_user=world.owner_b)
    assert body["date"] == "2026-10-26" and body["timezone"] == "Asia/Tokyo"
    assert names(body) == {"Bea Owner"}


def test_two_locations_each_use_their_own_day(app, client, world, freeze):
    set_tz(app, world.loc_a, "America/Toronto")
    set_tz(app, world.loc_b, "Asia/Tokyo")
    freeze(datetime(2026, 10, 26, 2, 30, tzinfo=timezone.utc))
    assert team(client, world, world.loc_a)["date"] == "2026-10-25"
    assert team(client, world, world.loc_b, as_user=world.owner_b)["date"] == "2026-10-26"


def test_after_dst_fall_back(app, client, world, freeze):
    set_tz(app, world.loc_a, "America/Toronto")
    late_shift = local(TORONTO, 2026, 11, 1, 23, 30)   # EST now: 04:30 UTC Nov 2
    world.shift(world.loc_a, late_shift, hours=2, assign=[world.staff_a], status="published")
    freeze(local(TORONTO, 2026, 11, 1, 23, 0))
    body = team(client, world, world.loc_a)
    assert body["date"] == "2026-11-01" and names(body) == {"Sam Staff"}


# ── Clock-in screen (mobile) and weekly summary ───────────────────────────────

def test_employees_today_shift_and_week_use_location_day(app, client, world, freeze):
    set_tz(app, world.loc_a, "America/Toronto")
    tonight = world.shift(world.loc_a, local(TORONTO, 2026, 10, 25, 20), hours=3,
                          assign=[world.staff_a], status="published")
    world.shift(world.loc_a, local(TORONTO, 2026, 10, 26, 9), hours=3,
                assign=[world.staff_a], status="published")
    freeze(local(TORONTO, 2026, 10, 25, 20, 5))    # Sunday evening; UTC is Monday

    active = client.get("/time-entries/active", headers=world.headers(world.staff_a)).get_json()
    assert active["today_shift"]["shift_id"] == tonight

    history = client.get("/time-entries/", headers=world.headers(world.staff_a)).get_json()
    assert history["weekly_summary"]["week_start"] == "2026-10-19"   # Toronto's Monday, not UTC's


# ── Creating and listing shifts ───────────────────────────────────────────────

def test_naive_shift_times_mean_location_wall_clock(app, client, world):
    """Mobile sends '2026-10-25T23:00:00'. It must be 11 PM in Toronto — overnight to 3 AM."""
    set_tz(app, world.loc_a, "America/Toronto")
    h = world.headers(world.manager_a)
    res = client.post("/shifts/", headers=h, json={
        "location_id": world.loc_a,
        "start_time": "2026-10-25T23:00:00", "end_time": "2026-10-26T03:00:00",
    })
    assert res.status_code == 201, res.get_json()
    s = res.get_json()["shift"]
    assert datetime.fromisoformat(s["start_time"]) == local(TORONTO, 2026, 10, 25, 23)
    assert datetime.fromisoformat(s["end_time"]) == local(TORONTO, 2026, 10, 26, 3)

    # Listed in the local week it starts in (Mon Oct 19 – Sun Oct 25), not the next one.
    this_week = client.get(f"/shifts/?location_id={world.loc_a}&week_start=2026-10-19", headers=h).get_json()["shifts"]
    next_week = client.get(f"/shifts/?location_id={world.loc_a}&week_start=2026-10-26", headers=h).get_json()["shifts"]
    assert [x["shift_id"] for x in this_week] == [s["shift_id"]]
    assert next_week == []


def test_naive_times_respect_dst(app, client, world):
    set_tz(app, world.loc_a, "America/Toronto")
    h = world.headers(world.manager_a)
    before = client.post("/shifts/", headers=h, json={"location_id": world.loc_a,
             "start_time": "2026-10-31T09:00:00", "end_time": "2026-10-31T17:00:00"}).get_json()["shift"]
    after = client.post("/shifts/", headers=h, json={"location_id": world.loc_a,
            "start_time": "2026-11-02T09:00:00", "end_time": "2026-11-02T17:00:00"}).get_json()["shift"]
    assert datetime.fromisoformat(before["start_time"]).astimezone(timezone.utc).hour == 13   # EDT
    assert datetime.fromisoformat(after["start_time"]).astimezone(timezone.utc).hour == 14    # EST


def test_explicit_offset_is_kept(app, client, world):
    set_tz(app, world.loc_a, "America/Toronto")
    res = client.post("/shifts/", headers=world.headers(world.manager_a), json={
        "location_id": world.loc_a,
        "start_time": "2026-10-25T09:00:00+00:00", "end_time": "2026-10-25T10:00:00+00:00",
    })
    assert datetime.fromisoformat(res.get_json()["shift"]["start_time"]) == datetime(2026, 10, 25, 9, tzinfo=timezone.utc)


def test_bulk_week_uses_location_wall_clock_and_overnight(app, client, world):
    set_tz(app, world.loc_a, "America/Toronto")
    h = world.headers(world.manager_a)
    res = client.post("/shifts/bulk-week", headers=h, json={
        "location_id": world.loc_a, "week_start": "2026-10-19",
        "rows": [{"user_id": world.staff_a, "start_time": "22:00", "end_time": "02:00", "days": [6]}],
    })
    assert res.status_code == 201 and res.get_json()["created_count"] == 1
    s = client.get(f"/shifts/?location_id={world.loc_a}&week_start=2026-10-19", headers=h).get_json()["shifts"][0]
    assert datetime.fromisoformat(s["start_time"]) == local(TORONTO, 2026, 10, 25, 22)   # Sunday 10 PM
    assert datetime.fromisoformat(s["end_time"]) == local(TORONTO, 2026, 10, 26, 2)


def test_time_off_conflict_uses_the_shifts_local_date(app, client, world):
    """Approved time off on Oct 25 must block a 10 PM Oct 25 shift (02:00 UTC Oct 26)."""
    from extensions import db
    from models import TimeOffRequest
    set_tz(app, world.loc_a, "America/Toronto")
    with app.app_context():
        db.session.add(TimeOffRequest(user_id=world.staff_a, comp_id=world.comp_a,
                                      start_date=date(2026, 10, 25), end_date=date(2026, 10, 25),
                                      status="approved"))
        db.session.commit()
    sid = world.shift(world.loc_a, local(TORONTO, 2026, 10, 25, 22), hours=3)
    res = client.post(f"/shifts/{sid}/assign", headers=world.headers(world.manager_a), json={"user_id": world.staff_a})
    assert res.status_code == 400 and "time off" in res.get_json()["error"].lower()


def test_publish_and_labor_cost_use_the_local_week(app, client, world):
    set_tz(app, world.loc_a, "America/Toronto")
    # Sunday 10 PM local belongs to the week of Mon Oct 19 even though it is Monday in UTC.
    world.shift(world.loc_a, local(TORONTO, 2026, 10, 25, 22), hours=2, assign=[world.staff_a])
    h = world.headers(world.manager_a)
    cost = client.get(f"/shifts/labor-cost?location_id={world.loc_a}&week_start=2026-10-19", headers=h).get_json()
    assert cost["total_shifts"] == 1 and cost["total_hours"] == 2.0
    pub = client.post("/shifts/publish", headers=h, json={"location_id": world.loc_a, "week_start": "2026-10-19"})
    assert pub.get_json()["published_count"] == 1


# ── Analytics ─────────────────────────────────────────────────────────────────

def test_analytics_buckets_by_local_day(app, client, world, freeze):
    from extensions import db
    from models import TimeEntry
    set_tz(app, world.loc_a, "America/Toronto")
    clock_in = local(TORONTO, 2026, 10, 25, 21)    # 01:00 UTC Oct 26
    with app.app_context():
        db.session.add(TimeEntry(user_id=world.staff_a, clock_in=clock_in,
                                 clock_out=clock_in + timedelta(hours=2), total_minutes=120))
        db.session.commit()
    freeze(local(TORONTO, 2026, 10, 25, 23, 30))
    h = world.headers(world.manager_a)

    day = client.get(f"/admin/analytics/?location_id={world.loc_a}&period=day&start_date=2026-10-25", headers=h).get_json()
    assert day["timezone"] == "America/Toronto"
    assert day["summary"]["worked_hours"] == 2.0
    assert day["hours_per_day"] == [{"date": "2026-10-25", "day": "Sun", "dayNum": "25", "worked": 2.0}]

    nxt = client.get(f"/admin/analytics/?location_id={world.loc_a}&period=day&start_date=2026-10-26", headers=h).get_json()
    assert nxt["summary"]["worked_hours"] == 0

    # No start_date → the location's today (Oct 25), and the week is Toronto's Mon–Sun.
    week = client.get(f"/admin/analytics/?location_id={world.loc_a}&period=week", headers=h).get_json()
    assert (week["start"], week["end"]) == ("2026-10-19", "2026-10-26")
    assert week["summary"]["worked_hours"] == 2.0
    assert week["trend_data"][-1] == {"label": "Oct 19", "hours": 2.0, "cost": 40.0}


# ── Setting a location's timezone ─────────────────────────────────────────────

def test_location_timezone_can_be_set_and_is_validated(client, world):
    h = world.headers(world.owner_a)
    bad = client.put(f"/admin/locations/{world.loc_a}", headers=h, json={"timezone": "Mars/Base"})
    assert bad.status_code == 400
    ok = client.put(f"/admin/locations/{world.loc_a}", headers=h, json={"timezone": "America/Vancouver"})
    assert ok.status_code == 200 and ok.get_json()["location"]["timezone"] == "America/Vancouver"
    locs = client.get("/admin/locations", headers=h).get_json()["locations"]
    assert {l["id"]: l["timezone"] for l in locs}[world.loc_a] == "America/Vancouver"
    # Staff can't change it.
    assert client.put(f"/admin/locations/{world.loc_a}", headers=world.headers(world.staff_a),
                      json={"timezone": "UTC"}).status_code == 403
