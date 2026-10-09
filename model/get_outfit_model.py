"""
get_outfit_model.py

This file is responsible for handling weather data retrieval and
generating outfit suggestions based on weather conditions and occasion.

It acts as a logic layer that connects external weather data with
outfit recommendation rules.

NOTE (AI-only):
- Outfit generation is now LLM-only (no rule-based fallback).
- We keep server-side validation minimal, but we enforce that an outfit includes shoes.
"""

import requests
import os
import json
import re
import time
from typing import Optional

# Fetching OpenWeather API key from environment variables for security
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")


def get_weather(lat, lon):
    """
    Fetch weather data from OpenWeather API using latitude and longitude.

    Returns basic weather details like condition, temperature,
    humidity, and wind speed.
    """

    # OpenWeather API endpoint with required query parameters
    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric"

    try:
        # Sending request to OpenWeather API and converting response to JSON
        data = requests.get(url).json()

        # Checking if the API response is successful
        if data.get("cod") != 200:
            return {"error": "Invalid location"}

        # Extracting only the required weather information
        return {
            "condition": data["weather"][0]["main"],
            "temp": round(data["main"]["temp"]),
            "humidity": data["main"]["humidity"],
            "wind": data["wind"]["speed"],
        }

    except:
        # Handles network errors, API downtime, or unexpected response formats
        return {"error": "Unable to fetch weather"}


from model.wardrobe_model import get_all_items

# Accessories are managed on a separate page and stored separately from wardrobe items.
# We pass them to the LLM as optional add-ons and validate them separately.
from model.accessories_model import get_all_accessories


def _accessory_icon(accessory: dict) -> str:
    text = f"{accessory.get('type', '')} {accessory.get('name', '')}".strip().lower()
    if any(k in text for k in ("sunglass", "sunglasses")):
        return "🕶️"
    if any(k in text for k in ("watch",)):
        return "⌚"
    if any(k in text for k in ("bag", "handbag", "purse", "clutch")):
        return "👜"
    if any(k in text for k in ("hat", "cap", "beanie")):
        return "🧢"
    if any(k in text for k in ("scarf",)):
        return "🧣"
    if any(k in text for k in ("belt",)):
        return "🧷"
    if any(k in text for k in ("umbrella",)):
        return "☂️"
    if any(k in text for k in ("ring", "necklace", "earring", "jewelry", "jewellery")):
        return "💎"
    return "✨"


## ------------------------------------------------------------
## Removed: deterministic color/pair selection helpers
## Outfit selection is now handled by the LLM.
## ------------------------------------------------------------


GROQ_API_KEY = os.getenv("GROQ_API_KEY")
# Groq's API base is `https://api.groq.com`.
# We allow GROQ_API_URL to be either the base (recommended) OR a full chat-completions endpoint.
GROQ_API_URL = os.getenv("GROQ_API_URL", "https://api.groq.com")
# NOTE: Groq occasionally decommissions models. You can override with env var GROQ_MODEL.
# Defaulting to a commonly-available Groq model.
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

def _resolve_groq_chat_completions_url(groq_api_url: str) -> str:
    """
    Convert Groq API URL to standard chat-completions endpoint.

    Accepts either:
    - Base URL: https://api.groq.com
    - Full endpoint: https://api.groq.com/openai/v1/chat/completions
    
    Always returns the complete endpoint URL for consistency.
    """
    base = (groq_api_url or "https://api.groq.com").strip().rstrip("/")

    # If caller already provided a full endpoint, keep it.
    if base.endswith("/openai/v1/chat/completions") or base.endswith("/v1/chat/completions"):
        return base

    # If they provided a version prefix, append the remaining path.
    if base.endswith("/openai/v1") or base.endswith("/v1"):
        return f"{base}/chat/completions"

    # Default to Groq's OpenAI-compatible path.
    return f"{base}/openai/v1/chat/completions"


def _build_prompt(items, accessories, weather, occasion, extra_instruction: Optional[str] = None):
    """
    Build JSON-only prompt for LLM outfit generation.

    Parameters:
    - items: List of wardrobe items with id, name, type, color, category
    - accessories: Optional list of accessory items
    - weather: String like "Clear, 12°C"
    - occasion: String like "Casual", "Formal", "Gym"
    - extra_instruction: Optional constraint (e.g., "exclude shoes with id 5")

    Returns: Dict with instruction, items, accessories, weather, occasion
    
    The LLM is instructed to:
    1. Always include exactly one shoes item if shoes exist
    2. Optionally include 1-2 accessories
    3. Avoid inappropriate combinations (e.g., belt for gym)
    4. Return JSON with outfit array and explanation
    """
    items_short = [
        {
            "id": i.get("id"),
            "name": i.get("name"),
            "type": i.get("type"),
            "category": i.get("category"),
            "color": i.get("color"),
        }
        for i in items
    ]

    accessories_short = []
    for a in (accessories or []):
        if not isinstance(a, dict):
            continue
        acc_id = a.get("_id")
        if acc_id is None:
            continue
        accessories_short.append({
            "id": str(acc_id),
            "name": a.get("name"),
            "type": a.get("type"),
        })

    # Comprehensive LLM instructions for consistent outfit generation
    instruction = (
        "You are a helpful wardrobe assistant. Return ONLY valid JSON (no extra text).\n"
        "Use ONLY the provided wardrobe items (by id).\n"
        "If the accessories list is non-empty, INCLUDE 1 accessory in most outfits (by id).\n"
        "You may omit accessories only when clearly inappropriate (e.g., Gym) or if none are provided.\n"
        "Never include more than 2 accessories.\n"
        "IMPORTANT: Always include exactly one shoes item (type='shoes') if any shoes exist.\n"
        "If no shoes exist in the wardrobe, return JSON with an 'error' telling the user to add shoes.\n"
        "Input fields: 'items' (list of available wardrobe items with id,name,type,category,color),\n"
        "'accessories' (list of optional accessories with id,name,type),\n"
        "'weather' (string, e.g., 'Clear, 12°C'), and 'occasion' (string).\n"
        "Output schema:\n"
        "{\n"
        "  \"outfit\": [ { role, id, reason } ],\n"
        "  \"explanation\": string (optional),\n"
        "  \"score\": float between 0 and 1 (optional)\n"
        "}\n"
        "Roles should be one of: top,bottom,onepiece,outer,shoes,accessory.\n"
        "Wardrobe item ids are numbers. Accessory ids are strings (ObjectId).\n"
        "Make it weather/occasion appropriate.\n"
        "If you cannot assemble an outfit from the provided items, return JSON with an 'error' key describing why."
    )

    if extra_instruction:
        instruction = instruction + "\n\n" + str(extra_instruction).strip()

    payload = {
        "instruction": instruction,
        "items": items_short,
        "accessories": accessories_short,
        "weather": weather,
        "occasion": occasion
    }

    return json.dumps(payload)


def generate_with_llm(items, accessories, weather, occasion, temperature=0.2, timeout=30, extra_instruction: Optional[str] = None):
    """Call the Groq API and return parsed JSON or an error dict."""
    api_key = os.getenv("GROQ_API_KEY") or GROQ_API_KEY
    if not api_key:
        return {"error": "GROQ_API_KEY not set"}

    url = _resolve_groq_chat_completions_url(GROQ_API_URL)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    prompt_json = _build_prompt(items, accessories, weather, occasion, extra_instruction=extra_instruction)

    # If the configured model is decommissioned, retry with a small set of fallback models.
    # This keeps the app working without requiring code edits.
    candidate_models = [GROQ_MODEL]
    for m in ["llama-3.1-8b-instant", "llama-3.1-70b-versatile", "mixtral-8x7b-32768"]:
        if m not in candidate_models:
            candidate_models.append(m)

    try:
        data = None
        last_error = None

        def _extract_retry_after_seconds(res, err_json) -> Optional[float]:
            # Prefer standard header if present.
            ra = None
            try:
                ra = res.headers.get("Retry-After")
            except Exception:
                ra = None
            if ra:
                try:
                    return float(ra)
                except Exception:
                    pass

            # Fall back to parsing Groq error message like: "Please try again in 4.2s."
            msg = None
            if isinstance(err_json, dict):
                err_obj = err_json.get("error") if isinstance(err_json.get("error"), dict) else None
                if err_obj:
                    msg = err_obj.get("message")
                if not msg:
                    msg = err_json.get("message")
            if isinstance(msg, str):
                m = re.search(r"try again in\s+([0-9]*\.?[0-9]+)s", msg, flags=re.IGNORECASE)
                if m:
                    try:
                        return float(m.group(1))
                    except Exception:
                        return None
            return None

        for model_name in candidate_models:
            body = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": "You are a JSON-output-only assistant that suggests outfits."},
                    {"role": "user", "content": prompt_json}
                ],
                "temperature": temperature,
                "max_tokens": 350
            }

            # Rate limits are common; retry once after the suggested wait (if it's short).
            for attempt in range(2):
                res = requests.post(url, headers=headers, json=body, timeout=timeout)

                if res.status_code != 429:
                    break

                try:
                    err_json = res.json()
                except Exception:
                    err_json = {"message": res.text}

                retry_after = _extract_retry_after_seconds(res, err_json)
                # Only do a quick retry to keep the UI responsive.
                if attempt == 0 and retry_after is not None and retry_after <= 6:
                    time.sleep(max(0.0, retry_after) + 0.3)
                    continue
                break

            if res.status_code >= 400:
                # Try to parse Groq error payload.
                try:
                    err_json = res.json()
                except Exception:
                    err_json = {"message": res.text}

                # Friendly rate-limit error.
                if res.status_code == 429:
                    retry_after = _extract_retry_after_seconds(res, err_json)
                    wait_hint = ""
                    if retry_after is not None:
                        wait_hint = f" Please wait ~{retry_after:.0f}s and try again."
                    return {
                        "error": "Groq is rate limiting requests right now (token limit)." + wait_hint,
                        "code": "rate_limit_exceeded",
                        "retry_after": retry_after,
                    }

                # Friendly auth error for common misconfiguration.
                # Groq returns 401 for invalid/missing API keys.
                if res.status_code == 401:
                    code = None
                    msg = None
                    if isinstance(err_json, dict):
                        err_obj = err_json.get("error") if isinstance(err_json.get("error"), dict) else {}
                        code = err_obj.get("code") or err_json.get("code")
                        msg = err_obj.get("message") or err_json.get("message")
                    if code == "invalid_api_key" or (isinstance(msg, str) and "invalid api key" in msg.lower()):
                        return {"error": "Invalid GROQ_API_KEY. Set a valid Groq API key in the GROQ_API_KEY environment variable and restart the app."}
                    return {"error": "Unauthorized to call Groq API (401). Check GROQ_API_KEY and restart the app."}

                # If the model is decommissioned, try the next fallback model.
                code = None
                if isinstance(err_json, dict):
                    err_obj = err_json.get("error") if isinstance(err_json.get("error"), dict) else {}
                    code = err_obj.get("code") or err_json.get("code")

                if res.status_code == 400 and code == "model_decommissioned":
                    last_error = f"Groq API 400: {err_json}"
                    continue

                return {"error": f"Groq API {res.status_code}: {err_json}"}

            data = res.json()
            last_error = None
            break

        if data is None:
            return {"error": last_error or "Groq API request failed"}

        # Try common shapes: choices[0].message.content or choices[0].text
        content = None
        if isinstance(data, dict) and "choices" in data and len(data["choices"]) > 0:
            choice = data["choices"][0]
            if isinstance(choice, dict) and "message" in choice and choice["message"]:
                content = choice["message"].get("content")
            elif "text" in choice:
                content = choice.get("text")

        if not content:
            return {"error": "LLM returned unexpected structure"}

        # The model is instructed to return JSON only, but some models may wrap it.
        # Try a couple of safe normalizations before failing.
        text = (content or "").strip()
        if text.startswith("```"):
            # remove surrounding code fences
            text = text.strip('`')
            # sometimes includes a language tag like ```json
            text = text.replace('json\n', '', 1).strip()

        try:
            return json.loads(text)
        except Exception:
            # fallback: extract first JSON object substring
            start = text.find('{')
            end = text.rfind('}')
            if start != -1 and end != -1 and end > start:
                return json.loads(text[start:end + 1])
            raise

    except Exception as e:
        return {"error": f"LLM request failed: {str(e)}"}


def generate_outfit(lat, lon, occasion, user_email: str = None, use_llm: bool = False, exclude_ids=None, weather_override: Optional[dict] = None):
    """Generate outfit using the LLM exclusively when requested for a specific user.

    If `use_llm` is True (or LLM enabled in the environment), the function uses the LLM to generate an outfit.
    On any LLM failure or invalid output the function returns an error — there is no rule-based fallback.
    """
    # Weather source:
    # - Get Outfit page uses live weather (OpenWeather current weather)
    # - Plan Ahead may pass a forecast override (condition/temp) for a future date
    condition = None
    temp = None
    humidity = None
    wind = None

    if isinstance(weather_override, dict) and (weather_override.get('weather') or weather_override.get('condition')):
        condition = weather_override.get('condition') or weather_override.get('weather')
        temp = weather_override.get('temp')
        humidity = weather_override.get('humidity')
        wind = weather_override.get('wind')

        if temp is not None:
            try:
                temp = round(float(temp))
            except Exception:
                temp = None

    if not condition:
        weather = get_weather(lat, lon)
        if 'error' in weather:
            return {'error': weather['error']}

        condition = weather['condition']
        temp = weather['temp']
        humidity = weather['humidity']
        wind = weather['wind']

    weather_str = f"{condition}, {temp}°C" if temp is not None else str(condition)

    def _error_with_weather(message: str):
        return {
            'error': message,
            'weather': weather_str,
            'condition': condition,
            'temp': temp,
            'humidity': humidity,
            'wind': wind,
        }

    # Pull user's available wardrobe items
    try:
        wardrobe_items = get_all_items(user_email)
    except Exception:
        wardrobe_items = []

    # Pull user's accessories (optional)
    try:
        accessories_items = get_all_accessories(user_email)
    except Exception:
        accessories_items = []

    if not wardrobe_items:
        return _error_with_weather('No wardrobe items available')

    # Normalize inputs
    occasion_norm = (occasion or '').strip()
    # Backward-compat: older UI used "Business" for what is now "Formal".
    if occasion_norm.lower() == 'business':
        occasion_norm = 'Formal'
    exclude_set = set()
    if isinstance(exclude_ids, list):
        for x in exclude_ids:
            try:
                exclude_set.add(int(x))
            except Exception:
                continue

    # Use clean items only (consistent with UI copy: "available clean items")
    clean_items = [i for i in wardrobe_items if str(i.get('status', '')).lower() == 'clean']
    if not clean_items:
        return _error_with_weather('No clean wardrobe items available. Mark items as Clean or add new items.')

    # For the selected occasion, only consider items whose category matches that occasion.
    # This prevents the LLM from returning a "formal" outfit when the user selected "casual".
    if occasion_norm:
        occasion_items = [
            i for i in clean_items
            if str(i.get('category', '')).strip().lower() == occasion_norm.lower()
        ]
    else:
        occasion_items = list(clean_items)

    # Apply exclusion (used by Dislike/regenerate to force variety)
    if exclude_set:
        occasion_items = [i for i in occasion_items if i.get('id') not in exclude_set]

    # Basic feasibility check (before calling LLM):
    # - Always require shoes
    # - Require either onepiece OR (top + bottom)
    # - Require outerwear in very cold/wet conditions
    def _count_type(items, t):
        return sum(1 for i in items if str(i.get('type', '')).lower() == t)

    shoes_count = _count_type(occasion_items, 'shoes')
    top_count = _count_type(occasion_items, 'top')
    bottom_count = _count_type(occasion_items, 'bottom')
    onepiece_count = _count_type(occasion_items, 'onepiece')
    outer_count = _count_type(occasion_items, 'outer')

    # In very cold/wet conditions, outerwear becomes required.
    outer_required = ((temp is not None and temp <= 5) or (str(condition).lower() in ('snow', 'rain')))

    missing_parts = []
    if shoes_count == 0:
        missing_parts.append('shoes')
    if onepiece_count == 0 and (top_count == 0 or bottom_count == 0):
        if top_count == 0:
            missing_parts.append('top')
        if bottom_count == 0:
            missing_parts.append('bottom')
    if outer_required and outer_count == 0:
        missing_parts.append('outerwear')

    if missing_parts:
        label = occasion_norm or 'selected'

        total_clean = len(clean_items)
        clean_for_label = len([i for i in clean_items if str(i.get('category', '')).strip().lower() == label.lower()]) if occasion_norm else total_clean

        # Build a friendly, concise message
        missing_text = ", ".join(missing_parts)
        
        # If occasion was chosen, give a hint if the user has items but in other categories.
        other_hint = ""
        if occasion_norm:
            other_clean = total_clean - clean_for_label
            if other_clean > 0:
                other_categories = {}
                for item in clean_items:
                    cat = str(item.get('category', '')).strip()
                    if cat.lower() != label.lower() and cat:
                        other_categories[cat] = other_categories.get(cat, 0) + 1
                
                if other_categories:
                    cat_list = [f"{count} {cat}" for cat, count in other_categories.items()]
                    other_hint = f"\n\n💡 Tip: You have {', '.join(cat_list)} items. Try changing the occasion!"

        # Simple, friendly message
        exclude_note = ""
        if exclude_set:
            exclude_note = "\n\n⚠️ Some items were excluded from the previous outfit. Add more items for variety!"

        return _error_with_weather(
            f"Can't create a {label} outfit right now.\n\n"
            f"Missing: {missing_text}\n"
            f"Fix: Add the missing items to your wardrobe or mark existing items as Clean."
            + other_hint
            + exclude_note
        )

    # Optionally use the LLM if requested and configured
    llm_enabled_env = os.getenv('USE_LLM_OUTFITS', '').lower() in ('1', 'true', 'yes')
    llm_only_mode = os.getenv('LLM_ONLY_MODE', '').lower() in ('1', 'true', 'yes')
    if (use_llm or llm_enabled_env or llm_only_mode):
        try:
            # generate_with_llm is implemented in this module (inlined from outfit_llm.py)
            weather_str = f"{condition}, {temp}°C"
            # Use the pre-filtered item pool so the LLM cannot "cheat" the occasion.
            # Also request more variety when we're regenerating.
            base_extra = None
            if exclude_set:
                base_extra = (
                    f"Avoid using these item ids (previous disliked outfit): {sorted(list(exclude_set))}. "
                    "Generate a different outfit if possible. If it's not possible with remaining items, return an 'error'."
                )
            llm_res = generate_with_llm(
                occasion_items,
                accessories_items,
                weather_str,
                occasion_norm,
                temperature=0.35 if exclude_set else 0.25,
                extra_instruction=base_extra,
            )

            # Validate the LLM output strictly against available wardrobe items
            def _validate_llm_output(llm_res):
                # AI-first behavior: keep validation minimal so the LLM can choose freely.
                # We validate that:
                # - schema is present
                # - suggested wardrobe item IDs exist
                # - suggested wardrobe items are clean
                # - the outfit includes shoes (type='shoes')

                # If the LLM adapter already returned an error, propagate it so the UI sees the
                # concrete failure (e.g., missing API key or JSON parse failure).
                if isinstance(llm_res, dict) and 'error' in llm_res:
                    return {"valid": False, "code": "llm_error", "message": f"LLM error: {llm_res.get('error')}", "normalized": None}

                if not isinstance(llm_res, dict) or 'outfit' not in llm_res or not isinstance(llm_res['outfit'], list):
                    return {"valid": False, "code": "invalid_schema", "message": 'LLM returned invalid schema: expected {"outfit": [...] }', "normalized": None}

                # Map wardrobe items by numeric id for quick lookup
                by_id = {i.get('id'): i for i in occasion_items if i.get('id') is not None}

                # Map accessories by string id for quick lookup
                acc_by_id = {}
                for a in accessories_items or []:
                    if not isinstance(a, dict):
                        continue
                    acc_id = a.get('_id')
                    if acc_id is None:
                        continue
                    acc_by_id[str(acc_id)] = a

                # Enforce: shoes must exist and must be included
                has_any_shoes = any((i.get('type') or '').lower() == 'shoes' for i in occasion_items)
                has_clean_shoes = any(
                    (i.get('type') or '').lower() == 'shoes' and str(i.get('status', '')).lower() == 'clean'
                    for i in occasion_items
                )

                if not has_any_shoes:
                    return {"valid": False, "code": "no_shoes", "message": 'No shoes found in wardrobe. Add shoes to your wardrobe first.', "normalized": None}
                if not has_clean_shoes:
                    return {"valid": False, "code": "no_clean_shoes", "message": 'No clean shoes available. Mark shoes as Clean first.', "normalized": None}

                enriched = []
                included_shoes = False
                included_accessory = False

                for entry in llm_res['outfit']:
                    if not isinstance(entry, dict):
                        return {"valid": False, "code": "invalid_entry", "message": 'LLM outfit entry is not an object', "normalized": None}

                    item_id = entry.get('id')
                    role = (entry.get('role') or entry.get('type') or '').lower().strip()

                    # Accessories: optional add-ons, validated against accessories list.
                    if role == 'accessory':
                        acc_id = None if item_id is None else str(item_id)
                        if not acc_id or acc_id not in acc_by_id:
                            return {"valid": False, "code": "unknown_accessory", "message": f"LLM suggested accessory id {item_id} not found", "normalized": None}
                        acc = acc_by_id[acc_id]
                        enriched.append({
                            'role': 'accessory',
                            'id': acc_id,
                            'name': acc.get('name') or 'Accessory',
                            'category': 'Accessory',
                            'color': '',
                            'icon': _accessory_icon(acc),
                            'reason': entry.get('reason')
                        })
                        included_accessory = True
                        continue

                    # Wardrobe items: must exist, be clean, and respect exclusions.
                    try:
                        item_id_int = int(item_id)
                    except Exception:
                        return {"valid": False, "code": "unknown_item", "message": f"LLM suggested item id {item_id} not found in wardrobe", "normalized": None}

                    if item_id_int not in by_id:
                        return {"valid": False, "code": "unknown_item", "message": f"LLM suggested item id {item_id} not found in wardrobe", "normalized": None}

                    if exclude_set and item_id_int in exclude_set:
                        return {"valid": False, "code": "used_excluded", "message": f"LLM reused an excluded item id {item_id}", "normalized": None}

                    item = by_id[item_id_int]

                    # item must be clean
                    if str(item.get('status', '')).lower() != 'clean':
                        return {"valid": False, "code": "dirty_item", "message": f"Item id {item_id} is not clean", "normalized": None}

                    item_type = (item.get('type') or '').lower()
                    if item_type == 'shoes':
                        included_shoes = True

                    enriched.append({
                        'role': role or item_type or 'item',
                        'id': item_id_int,
                        'name': item.get('name'),
                        'category': item.get('category'),
                        'color': item.get('color'),
                        'icon': item.get('icon'),
                        'reason': entry.get('reason')
                    })

                # require at least one item
                if len(enriched) == 0:
                    return {"valid": False, "code": "empty_outfit", "message": 'LLM returned empty outfit', "normalized": None}

                if not included_shoes:
                    return {"valid": False, "code": "missing_shoes", "message": 'LLM did not include shoes. Try again.', "normalized": None}

                return {"valid": True, "code": None, "message": None, "has_accessory": included_accessory, "normalized": {
                    'outfit': enriched,
                    'explanation': llm_res.get('explanation'),
                    'score': llm_res.get('score')
                }}

            validation = _validate_llm_output(llm_res)

            # If the model violates constraints (common on regenerate), auto-retry once with
            # a more explicit correction message so the UI doesn't show a confusing error.
            if not validation["valid"] and validation["code"] in (
                "missing_shoes",
                "unknown_accessory",
                "invalid_schema",
                "used_excluded",
            ):
                clean_shoe_ids = [
                    i.get('id')
                    for i in occasion_items
                    if (i.get('type') or '').lower() == 'shoes' and str(i.get('status', '')).lower() == 'clean'
                ]
                accessory_ids = [str(a.get('_id')) for a in (accessories_items or []) if isinstance(a, dict) and a.get('_id') is not None]
                correction = (
                    "Your previous response was invalid. Fix it and return ONLY valid JSON.\n"
                    "You MUST include exactly one shoes item (type='shoes') if any shoes exist.\n"
                    f"Choose the shoes item from these clean shoe ids: {clean_shoe_ids}.\n"
                )
                if exclude_set:
                    correction += f"Do NOT use these excluded ids: {sorted(list(exclude_set))}.\n"
                correction += "Do not invent items. Use only provided ids."
                llm_res_retry = generate_with_llm(
                    occasion_items,
                    accessories_items,
                    weather_str,
                    occasion_norm,
                    temperature=0.25,
                    extra_instruction=correction,
                )
                validation = _validate_llm_output(llm_res_retry)

            if not validation["valid"]:
                # If the LLM call itself failed (auth, rate limit, parsing, etc), surface that message directly.
                if validation.get("code") == "llm_error" and isinstance(llm_res, dict) and llm_res.get("error"):
                    err = _error_with_weather(str(llm_res.get("error")))
                    if llm_res.get("code"):
                        err["code"] = llm_res.get("code")
                    if llm_res.get("retry_after") is not None:
                        err["retry_after"] = llm_res.get("retry_after")
                    err['source'] = 'llm'
                    return err

                err = _error_with_weather(f'LLM failed validation: {validation["message"]}')
                err['source'] = 'llm'
                return err

            # Best-effort accessory inclusion: if the user has accessories and the occasion isn't Gym,
            # retry once asking for exactly one accessory. If the retry fails, keep the valid outfit.
            try:
                wants_accessory = (accessories_items or []) and (occasion_norm or '').strip().lower() != 'gym'
                if wants_accessory and not validation.get('has_accessory'):
                    accessory_ids = [
                        str(a.get('_id'))
                        for a in (accessories_items or [])
                        if isinstance(a, dict) and a.get('_id') is not None
                    ]
                    if accessory_ids:
                        accessory_instruction = (
                            "Return ONLY valid JSON. Keep the outfit weather/occasion appropriate.\n"
                            "Include exactly 1 accessory entry with role='accessory'.\n"
                            f"Choose the accessory id from this list: {accessory_ids}.\n"
                            "Do not invent items. Use only provided ids."
                        )
                        llm_res_accessory = generate_with_llm(
                            occasion_items,
                            accessories_items,
                            weather_str,
                            occasion_norm,
                            temperature=0.35 if exclude_set else 0.3,
                            extra_instruction=accessory_instruction,
                        )
                        validation2 = _validate_llm_output(llm_res_accessory)
                        if validation2.get('valid') and validation2.get('has_accessory'):
                            validation = validation2
            except Exception:
                pass

            normalized = validation["normalized"]

            # Keep API contract consistent for the frontend (weather + details)
            normalized.update({
                'weather': weather_str,
                'condition': condition,
                'temp': temp,
                'humidity': humidity,
                'wind': wind,
                'warning': None
            })
            normalized['source'] = 'llm'
            return normalized
        except Exception as e:
            err = _error_with_weather(f'LLM call failed: {str(e)}')
            err['source'] = 'llm'
            return err


    # NOTE: Rule-based generation has been removed — this project uses LLM-only outfit generation.
    # If execution reaches this point it's an unexpected code path; return an error.
    return _error_with_weather('Non-LLM outfit generation has been removed. Enable the LLM (set GROQ_API_KEY/USE_LLM_OUTFITS) and try again.')
