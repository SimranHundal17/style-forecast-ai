"""
plan_ahead_model.py

This file manages outfit planning for future dates in the application.
It supports single-day planning as well as multi-day planning (such as vacations).

All operations in this file interact directly with the database and
belong to the Model layer.
"""

from datetime import datetime, timedelta
from utils.db import db

# MongoDB collection used for storing plan-ahead data
plans = db["plans"]


def serialize_plan(p):
    """
    Convert a plan document into a JSON-friendly dictionary.
    """

    if not p:
        return None

    return {
        "id": int(p.get("id")),
        "date": p.get("date"),
        "location": p.get("location"),
        "lat": p.get("lat"),
        "lon": p.get("lon"),
        "occasion": p.get("occasion"),
        "weather": p.get("weather"),
        "temp": p.get("temp"),
        "description": p.get("description"),
        "outfit": p.get("outfit", []),
        "group_id": int(p.get("group_id")) if p.get("group_id") is not None else None
    }


def _next_id():
    """
    Generate the next available plan ID.
    """
    last = plans.find_one(sort=[("id", -1)])
    return (last["id"] + 1) if last else 1


def _next_group_id():
    """
    Generate a group ID for multi-day plans.
    """
    last = plans.find_one(sort=[("group_id", -1)])
    return (last["group_id"] + 1) if last else 1


def get_all_plans(user_email: str = None):
    """
    Fetch all plan entries for a specific user.
    """
    query = {"user_email": user_email} if user_email else {}
    return list(plans.find(query))


def get_plans_for_date(date_str, user_email: str = None):
    """
    Fetch plans for a specific date and user.
    """
    query = {"date": date_str}
    if user_email:
        query["user_email"] = user_email
    return list(plans.find(query))


def get_plan_by_id(pid, user_email: str = None):
    """
    Fetch a single plan using its numeric ID and verify user ownership.
    """
    query = {"id": int(pid)}
    if user_email:
        query["user_email"] = user_email
    return plans.find_one(query)


def add_plan_entry(entry, user_email: str = None):
    """
    Add a single plan entry with default values for missing fields.
    """

    new_entry = dict(entry)
    new_entry["id"] = _next_id()

    # Default values to avoid missing fields
    new_entry.setdefault("location", "")
    new_entry.setdefault("lat", None)
    new_entry.setdefault("lon", None)
    new_entry.setdefault("occasion", "Casual")
    new_entry.setdefault("weather", "")
    new_entry.setdefault("temp", None)
    new_entry.setdefault("description", None)
    new_entry.setdefault("outfit", [])
    new_entry.setdefault("group_id", None)
    new_entry["user_email"] = user_email

    plans.insert_one(new_entry)
    return new_entry


def add_plan_range(start_date, end_date, entry_template, user_email: str = None):
    """
    Add multiple plan entries for a given date range.
    All entries share the same group ID and user email.
    """

    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()

    # Ensure correct date order
    if end < start:
        start, end = end, start

    gid = _next_group_id()
    created = []
    cur = start

    # Create a plan entry for each day in the range
    while cur <= end:
        entry = dict(entry_template)
        entry["date"] = cur.strftime("%Y-%m-%d")
        new_entry = add_plan_entry(entry, user_email)

        # Assign group ID to link related plans
        plans.update_one(
            {"id": new_entry["id"]},
            {"$set": {"group_id": gid}}
        )

        new_entry["group_id"] = gid
        created.append(new_entry)
        cur += timedelta(days=1)

    return created


def update_plan(pid, user_email: str = None, **fields):
    """
    Update selected fields of an existing plan, verifying user ownership.
    """
    query = {"id": int(pid)}
    if user_email:
        query["user_email"] = user_email
    plans.update_one(query, {"$set": fields})
    return get_plan_by_id(pid, user_email)


def delete_plan(pid, user_email: str = None):
    """
    Delete a single plan entry, verifying user ownership.
    """
    query = {"id": int(pid)}
    if user_email:
        query["user_email"] = user_email
    plans.delete_one(query)
    return True


def delete_group(gid, user_email: str = None):
    """
    Delete all plans belonging to the same group, verifying user ownership.
    """
    query = {"group_id": int(gid)}
    if user_email:
        query["user_email"] = user_email
    plans.delete_many(query)
    return True


from model.outfit_history_model import add_history_entry


def archive_past_plans(user_email: str = None):
    """
    Archive past plans by moving them into outfit history for a specific user.
    """

    today = datetime.utcnow().date()
    query = {"date": {"$lt": today.strftime("%Y-%m-%d")}}
    if user_email:
        query["user_email"] = user_email
    past_plans = plans.find(query)

    for p in past_plans:
        if p.get("outfit"):
            add_history_entry({
                "date": p["date"],
                "location": p.get("location"),
                "occasion": p.get("occasion"),
                "weather": p.get("weather"),
                "temp": p.get("temp"),
                "outfit": p.get("outfit")
            }, user_email)
            plans.delete_one({"id": p["id"]})
