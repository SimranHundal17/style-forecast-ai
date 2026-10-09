# routes/history_routes.py
from flask import render_template, jsonify, request
from routes import history_bp # Blueprint for history routes
from model.outfit_history_model import get_all_history, delete_history_entry, add_history_entry

# Try to import real auth decorator
## Fallback is used ONLY if utils.auth is not available
try:
    from utils.auth import token_required
except ImportError:
    from functools import wraps

    def token_required(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            return f(current_user="Guest", *args, **kwargs)
        return wrapper

# Page to view outfit history
## Render HTML page (server-side)
@history_bp.route("/")
@token_required
def outfit_history(current_user):
    return render_template("outfit_history.html", current_user=current_user)

# Return all history entries as JSON for frontend fetch
@history_bp.route("/data")
@token_required
def history_data(current_user):
    entries = get_all_history(current_user)
    return jsonify(entries)

# Delete one history entry by numeric id
@history_bp.route("/api/delete/<int:entry_id>", methods=["DELETE"])
@token_required
def history_delete(current_user, entry_id):
    ok = delete_history_entry(entry_id, current_user)
    return jsonify({"ok": ok})

# Add a new history from Plan Ahead
## This endpoint is called from Plan Ahead JS to archive an outfit
@history_bp.route("/api/add_from_plan", methods=["POST"])
@token_required
def history_add_from_plan(current_user):

    data = request.get_json() or {}

    entry = {
        "date":        data.get("date"),
        "location":    data.get("location", ""),
        "weather":     data.get("weather", ""),
        "outfit":      data.get("outfit", []),
        "occasion":    data.get("occasion", ""),
        "liked":       data.get("liked", True),
    }
# Saving in the database
    new_entry = add_history_entry(entry, current_user)
    return jsonify(new_entry), 201
