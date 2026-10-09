"""
plan_ahead_routes.py

Routes to support the "Plan Ahead" feature. Endpoints provided:
- GET /plan_ahead : render UI
- GET /plan/plans : list plans (archives past plans first)
- POST /plan/create : create plans for a single date or a date range
- POST /plan/update : update allowed plan fields
- POST /plan/delete : delete a plan
- POST /plan/delete_group : delete plans by group
- GET /plan_ahead/api/weather_for_date : fetch forecast for a specific date

This module relies on `model.plan_ahead_model` for persistent operations
and uses OpenWeather's forecast API to fetch weather for a requested date.
"""

from flask import Blueprint, render_template, request, jsonify, current_app
from datetime import datetime
import requests
import traceback

from utils.auth import token_required
from model.plan_ahead_model import (
    serialize_plan, get_all_plans,
    add_plan_range, update_plan, delete_plan, delete_group, archive_past_plans
)

plan_bp = Blueprint("plan", __name__)

@plan_bp.route("/plan_ahead")
@token_required
def plan_ahead_page(current_user):
    """Render the Plan Ahead UI page."""
    return render_template("plan_ahead.html")

@plan_bp.route("/plan/plans")
@token_required
def api_plans(current_user):
    """Return a serialized list of plans for current user.

    Calls `archive_past_plans()` to move past plans into history before
    returning the current plan set.
    """
    try:
        # Archive any past plans first (moves them into outfit history)
        archive_past_plans(current_user)

        plans = get_all_plans(current_user)
        return jsonify([serialize_plan(p) for p in plans])
    except Exception:
        traceback.print_exc()
        return jsonify([])

@plan_bp.route("/plan/create", methods=["POST"])
@token_required
def api_create(current_user):
    """Create one or more plan entries for a date or date range for current user.

    Expected JSON: start (YYYY-MM-DD), optional end (YYYY-MM-DD), and
    optional metadata (location, lat, lon, occasion, weather, temp, description).
    Uses `add_plan_range` which creates one record per date and assigns a
    group id for multi-day ranges.
    """
    try:
        data = request.json
        start = data["start"]
        end = data.get("end", start)

        base = {
            "location": data.get("location", ""),
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "occasion": data.get("occasion", "Casual"),
            "weather": data.get("weather", ""),
            "temp": data.get("temp"),
            "description": data.get("description"),
            "outfit": []
        }

        # add_plan_range handles date ordering and group id assignment
        created = add_plan_range(start, end, base, current_user)
        return jsonify([serialize_plan(c) for c in created]), 201

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "failed"}), 500

@plan_bp.route("/plan/update", methods=["POST"])
@token_required
def api_update(current_user):
    """Update an existing plan's allowed fields for current user.

    Expects JSON with `id` plus any subset of the allowed update fields.
    Returns the serialized updated plan.
    """
    try:
        data = request.json
        pid = data["id"]

        allowed = ["location", "lat", "lon", "occasion",
                   "weather", "temp", "description", "outfit"]

        update_fields = {k: data[k] for k in allowed if k in data}

        updated = update_plan(pid, current_user, **update_fields)
        return jsonify(serialize_plan(updated))

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "failed"}), 500

@plan_bp.route("/plan/delete", methods=["POST"])
@token_required
def api_delete(current_user):
    """Delete a single plan by numeric ID for current user. Expects JSON { id }."""
    try:
        delete_plan(request.json["id"], current_user)
        return jsonify({"success": True})
    except Exception:
        traceback.print_exc()
        return jsonify({"success": False})

@plan_bp.route("/plan/delete_group", methods=["POST"])
@token_required
def api_delete_group(current_user):
    """Delete all plans in a group for current user. Expects JSON { group_id }."""
    try:
        delete_group(request.json["group_id"], current_user)
        return jsonify({"success": True})
    except Exception:
        traceback.print_exc()
        return jsonify({"success": False})


@plan_bp.route("/plan_ahead/api/weather_for_date")
@token_required
def weather_for_date(current_user):
    """Return forecasted weather for a given date and coordinates.

    Query params:
      - lat: latitude
      - lon: longitude
      - date: ISO date string (YYYY-MM-DD)

    This uses OpenWeather 5-day/3-hour forecast and searches for any
    timestamp matching the requested date. If found, it returns weather,
    description and temp; otherwise returns 404.
    """
    try:
        lat = request.args["lat"]
        lon = request.args["lon"]
        date_str = request.args["date"]

        # Read API key from app configuration
        key = current_app.config["OPENWEATHER_API_KEY"]

        # Forecast endpoint provides multiple 3-hour blocks for several days
        url = (
            f"https://api.openweathermap.org/data/2.5/forecast?"
            f"lat={lat}&lon={lon}&units=metric&appid={key}"
        )

        r = requests.get(url).json()
        # If the API failed or returned an unexpected shape, signal an error
        if "list" not in r:
            return jsonify({"error": "Weather unavailable"}), 500

        # Parse requested date to compare against each forecast timestamp
        target = datetime.strptime(date_str, "%Y-%m-%d").date()

        for e in r["list"]:
            # `dt_txt` is in format 'YYYY-MM-DD HH:MM:SS'; parse and compare dates
            dt = datetime.strptime(e["dt_txt"], "%Y-%m-%d %H:%M:%S").date()
            if dt == target:
                return jsonify({
                    "weather": e["weather"][0]["main"],
                    "description": e["weather"][0]["description"],
                    "temp": e["main"]["temp"]
                })

        # No matching timestamp found for requested date
        return jsonify({"error": "Weather not available"}), 404

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "failed"}), 500
