"""
get_outfit_routes.py

Endpoints powering the Get Outfit UI:
- GET /get_outfit : render page
- GET /api/location/autocomplete : return location suggestions via OpenWeather geocoding
- GET /api/location/reverse : reverse geocode lat/lon to a human-readable label
- POST /api/get_outfit : generate outfit suggestions (calls model)
- POST /api/save_outfit : save a generated outfit to in-memory history

Notes:
- `requests` is used for server-side calls to OpenWeather's geocoding APIs.
- `add_history_entry` persists a saved outfit into the in-memory history model.
- `OPENWEATHER_API_KEY` is required in environment variables; if missing,
  API requests will fail and endpoints return errors or empty results.
"""

from flask import render_template, request, jsonify
from routes import outfit_bp
from model.get_outfit_model import generate_outfit
from model.outfit_history_model import add_history_entry   # used to persist saved outfits
from model.login_model import get_user_by_email
from model.wardrobe_model import record_outfit_worn, refresh_dirty_items_by_days
from utils.auth import token_required
import requests  # used to call third-party OpenWeather APIs
import os
from datetime import datetime

# Read the OpenWeather API key from env; required for geocoding and reverse geocoding
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")


# ---------------------------------------------------------
# PAGE RENDER
# ---------------------------------------------------------
@outfit_bp.route("/get_outfit", methods=["GET"])
@token_required
def get_outfit_page(current_user):
    return render_template("get_outfit.html", user=current_user)


# ---------------------------------------------------------
# AUTOCOMPLETE
# ---------------------------------------------------------
@outfit_bp.route("/api/location/autocomplete", methods=["GET"])
@token_required
def autocomplete(current_user):
    """Return up to 5 location suggestions for the given query string.

    Query param: q (partial place name)
    Response: JSON array of { label, lat, lon }
    """
    query = request.args.get("q", "")

    # If query is empty, return an empty list quickly
    if not query:
        return jsonify([])

    # Build the OpenWeather geocoding request URL. The `appid` must be set.
    url = (
        "https://api.openweathermap.org/geo/1.0/direct"
        f"?q={query}&limit=5&appid={OPENWEATHER_API_KEY}"
    )

    # NOTE: This performs a blocking HTTP call; if the external API fails
    # it will raise or return non-JSON; the current pattern forwards an empty
    # or error response upstream. In production you may add retries or error handling.
    results = requests.get(url).json()

    suggestions = []
    for loc in results:
        # Build a human-friendly label like 'City, State, Country'
        label = loc.get("name", "")

        if loc.get("state"):
            label += f", {loc['state']}"

        label += f", {loc.get('country', '')}"

        suggestions.append({
            "label": label,
            "lat": loc.get("lat"),  # may be None if API doesn't return it
            "lon": loc.get("lon")
        })

    return jsonify(suggestions)


# ---------------------------------------------------------
# REVERSE GEOCODING
# ---------------------------------------------------------
@outfit_bp.route("/api/location/reverse", methods=["GET"])
@token_required
def reverse_geocode(current_user):
    """Reverse geocode lat/lon into a human-readable label.

    Query params: lat, lon
    Returns 400 if coords missing, 404 if OpenWeather returns no match.
    """
    lat = request.args.get("lat")
    lon = request.args.get("lon")

    # Validate presence of coordinates
    if not lat or not lon:
        return jsonify({"error": "Missing coordinates"}), 400

    # Call OpenWeather reverse geocoding endpoint for a single result
    url = (
        "https://api.openweathermap.org/geo/1.0/reverse"
        f"?lat={lat}&lon={lon}&limit=1&appid={OPENWEATHER_API_KEY}"
    )
    result = requests.get(url).json()

    # If API returned an empty list, respond with 404 for not found
    if not result:
        return jsonify({"error": "Location not found"}), 404

    loc = result[0]

    # Construct label consistently with `autocomplete`
    label = loc.get("name", "")

    if loc.get("state"):
        label += f", {loc['state']}"

    label += f", {loc.get('country', '')}"

    return jsonify({
        "label": label,
        "lat": loc.get("lat"),
        "lon": loc.get("lon")
    })


# ---------------------------------------------------------
# GENERATE OUTFIT
# ---------------------------------------------------------
@outfit_bp.route("/api/get_outfit", methods=["POST"])
@token_required
def api_generate_outfit(current_user):
    """Generate outfit suggestions.

    Expected JSON body: { lat, lon, occasion }
    Returns JSON result from the model; if missing coords, returns 400.
    """
    data = request.get_json()
    print(f"DEBUG: Received payload: {data}")
    
    lat = data.get("lat")
    lon = data.get("lon")
    occasion = data.get("occasion")
    exclude_ids = data.get("exclude_ids")
    weather_override = None

    # Optional: allow callers (e.g., Plan Ahead) to pass forecast weather.
    # Shape: { weather: "Rain", temp: 8 } (temp optional)
    if isinstance(data, dict) and (data.get("weather") or data.get("temp") is not None):
        weather_override = {
            "weather": data.get("weather"),
            "temp": data.get("temp"),
        }
    # Always use LLM generation for outfits (AI-first behavior)
    use_llm = True

    # Validate required inputs
    if not lat or not lon:
        print(f"DEBUG: Missing location - lat: {lat}, lon: {lon}")
        return jsonify({"error": "Missing location"}), 400

    # Refresh wardrobe statuses based on day threshold (so generation uses correct Clean items)
    try:
        user = get_user_by_email(current_user)
        days_until_dirty = user.get('days_until_dirty') if user else None
        if days_until_dirty is not None:
            refresh_dirty_items_by_days(
                int(days_until_dirty),
                user_email=current_user,
            )
    except Exception:
        pass

    # Determine whether LLM generation is allowed by environment
    llm_allowed = os.getenv('USE_LLM_OUTFITS', '').lower() in ('1', 'true', 'yes') or bool(os.getenv('GROQ_API_KEY'))
    if use_llm and not llm_allowed:
        return jsonify({"error": "LLM generation is not enabled on this server"}), 403

    # Call into the business logic (model) to generate outfit suggestions
    result = generate_outfit(
        lat,
        lon,
        occasion,
        user_email=current_user,
        use_llm=use_llm,
        exclude_ids=exclude_ids,
        weather_override=weather_override,
    )

    # If model returns an error, forward appropriate status code for client handling
    if isinstance(result, dict) and 'error' in result:
        return jsonify(result), 400

    return jsonify(result)


# ---------------------------------------------------------
# SAVE OUTFIT INTO IN-MEMORY MODEL
# ---------------------------------------------------------
@outfit_bp.route("/api/save_outfit", methods=["POST"])
@token_required
def save_outfit(current_user):
    """Persist a liked outfit into the in-memory outfit history.

    Expected JSON body contains: outfit (array), weather (str), location (str),
    optional: occasion, date. Uses `add_history_entry` from model.
    """
    data = request.get_json()

    outfit = data.get("outfit")
    weather = data.get("weather")
    location = data.get("location")
    occasion = data.get("occasion")

    # Basic validation to ensure required fields are present
    if not outfit or not weather or not location:
        return jsonify({"error": "Missing outfit data"}), 400

    entry = {
        "date": data.get("date") or datetime.now().strftime("%Y-%m-%d"),
        "location": location,
        "weather": weather,
        "outfit": outfit,
        "occasion": occasion,
        "liked": True,
    }

    # Add to the in-memory history store via the model layer
    add_history_entry(entry, current_user)

    # Day-based behavior:
    # Like implies the user wore the outfit now -> store last_worn_at for each item.
    # Items are auto-marked as "Needs Wash" after N days via refresh_dirty_items_by_days.
    try:
        record_outfit_worn(outfit, current_user)
    except Exception:
        pass

    return jsonify({"success": True})
