# model/wardrobe_model.py
"""
Wardrobe Model

Handles all database operations for wardrobe items including:
- CRUD operations (Create, Read, Update, Delete)
- Item status management (Clean, Needs Wash, etc.)
- Wear history tracking (last_worn_at, wear_count)
- Laundry cycle management

Database Structure:
- wardrobe_items: Main collection storing all user clothing items
- dirty_items: Tracks items marked for washing
"""

from datetime import datetime
from utils.db import db, laundry_db  # main DB and laundry DB

# Main collection where all wardrobe items are stored
wardrobe_col = db["wardrobe_items"]

# Separate collection for items that need wash
dirty_col = laundry_db["dirty_items"]

# =====================================================
# UTILITY FUNCTIONS
# =====================================================

def _to_dict(doc):
    """
    Convert MongoDB document to clean Python dictionary.
    
    This removes MongoDB-specific fields (_id) and ensures
    all fields have safe defaults before sending to frontend.
    Converts datetime objects to ISO format strings for JSON serialization.
    """
    if not doc:
        return None
    last_worn_at = doc.get("last_worn_at")
    if isinstance(last_worn_at, datetime):
        last_worn_at = last_worn_at.isoformat()
    # Use safe defaults if some fields are missing
    return {
        "id": doc.get("id"),
        "name": doc.get("name", ""),
        "category": doc.get("category", ""),
        "type": doc.get("type", ""),
        "color": doc.get("color", ""),
        "status": doc.get("status", "Clean"),
        "wear_count": doc.get("wear_count", 0),
        "last_worn_at": last_worn_at,
        "icon": doc.get("icon", "👚"),
    }

# Generate a numeric ID similar to SQL auto-increment
def _get_next_id():
    """
    Generate next auto-increment ID for new wardrobe items.
    
    Similar to SQL auto-increment. Finds the highest existing ID
    and returns the next sequential number.
    """
    last = wardrobe_col.find_one(sort=[("id", -1)])
    if last and "id" in last:
        return int(last["id"]) + 1
    return 1

# =====================================================
# MAIN API FUNCTIONS
# =====================================================

# Return all wardrobe items, sorted by ID (newest first)
def get_all_items(user_email: str = None):
    """
    Retrieve all wardrobe items from database for a specific user.
    
    Returns items sorted by ID in descending order (newest items first).
    This ensures newly added items appear at the top of the list.
    If user_email is provided, only returns items for that user.
    """
    query = {"user_email": user_email} if user_email else {}
    docs = wardrobe_col.find(query).sort("id", -1)
    return [_to_dict(d) for d in docs]

def get_items_by_filter(filter_value, user_email: str = None):
    """
    Filter items by status or category for a specific user.
    
    Special cases:
    - None or 'all': Returns all items
    - 'needs wash': Returns items marked for laundry
    - Other values: Treated as category names (case-insensitive)
    """
    # Build base query with user_email filter
    base_query = {"user_email": user_email} if user_email else {}
    
    if not filter_value or filter_value.lower() == "all":
        return get_all_items(user_email)

    filter_lower = filter_value.lower()

    # Special handling for "Needs Wash" status
    if filter_lower in ["needs wash", "needs", "needswash"]:
        query = {**base_query, "status": {"$regex": "^needs wash$", "$options": "i"}}
        docs = wardrobe_col.find(query)
        return [_to_dict(d) for d in docs]

    # Category filter (case-insensitive exact match)
    query = {**base_query, "category": {"$regex": f"^{filter_lower}$", "$options": "i"}}
    docs = wardrobe_col.find(query)
    return [_to_dict(d) for d in docs]

# Get items by status using case-insensitive regex match
def get_items_by_status(status):
    docs = wardrobe_col.find(
        {"status": {"$regex": f"^{status}$", "$options": "i"}}
    )
    return [_to_dict(d) for d in docs]

# Find item by numeric id (for a specific user)
def get_item_by_id(item_id: int, user_email: str = None):
    query = {"id": int(item_id)}
    if user_email:
        query["user_email"] = user_email
    doc = wardrobe_col.find_one(query)
    return _to_dict(doc)

# Add a new wardrobe item
## If item is created as 'Needs Wash', also store it in dirty_items collection.
def add_item(name: str, category: str, status: str, color: str, item_type: str, user_email: str = None):
    if not isinstance(user_email, str) or not user_email.strip():
        raise ValueError("User email is required for wardrobe items")
    # Validate that color is provided and not just whitespace
    if not color or not color.strip():
        raise ValueError("Color is required for wardrobe item")
    color = color.strip()

    # Validate item type
    allowed = {"top", "bottom", "onepiece", "outer", "shoes"}
    if not item_type or item_type.strip().lower() not in allowed:
        raise ValueError(f"Type is required and must be one of: {', '.join(sorted(allowed))}")
    item_type = item_type.strip().lower()

    default_icons = {
        "casual": "👕",
        "formal": "👔",
        "sports": "🏃",
        "gym": "🏋️",
        "party": "🎉",
        "outdoor": "🥾",
    }
    # Pick icon based on category (fallback icon if no match)
    icon = default_icons.get(category.lower(), "👚")
    new_id = _get_next_id()
    # Build new item document
    doc = {
        "id": new_id,
        "name": name,
        "category": category,
        "type": item_type,
        "color": color,
        "status": status,
        "wear_count": 0,
        "last_worn_at": None,
        "icon": icon,
        "user_email": user_email,  # Associate item with user
    }

# Insert into main wardrobe collection
    wardrobe_col.insert_one(doc)

# If item is created as "Needs Wash" -> add to dirty collection
    if str(status).lower() == "needs wash":
        dirty_col.update_one(
            {"item_id": new_id, "user_email": user_email},
            {
                "$set": {
                    "item_id": new_id,
                    "user_email": user_email,
                    "marked_at": datetime.utcnow(),
                }
            },
            upsert=True,   # create new doc if it does not exist
        )

    return _to_dict(doc)

# Update item status between 'Clean' and 'Needs Wash'
## Also keep dirty_items collection in sync
def update_item_status(item_id: int, user_email: str = None):
    if not isinstance(user_email, str) or not user_email.strip():
        return None
# Find item in main collection
    query = {"id": int(item_id), "user_email": user_email}
    
    doc = wardrobe_col.find_one(query)
    if not doc:
        return None
# Normalize current status to lower-case string
    current_status = str(doc.get("status", "Clean")).lower()
    wear_count = int(doc.get("wear_count", 0))
    
    # Initialize wear_count if missing (for items added before this feature)
    if "wear_count" not in doc:
        wardrobe_col.update_one(query, {"$set": {"wear_count": 0}})

    if current_status == "clean":
# Mark item as dirty
        new_status = "Needs Wash"
        # Track last worn timestamp for day-based auto-dirtying
        last_worn_at = datetime.utcnow()

# Add or update record in dirty_items
        dirty_col.update_one(
            {"item_id": int(item_id), "user_email": user_email},
            {
                "$set": {
                    "item_id": int(item_id),
                    "user_email": user_email,
                    "marked_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
    else:
# Mark item as clean
        new_status = "Clean"
        # When an item is cleaned/washed, reset counters/timestamps.
        wear_count = 0
        last_worn_at = None

# Remove item from dirty_items when it becomes clean
        dirty_col.delete_one({"item_id": int(item_id), "user_email": user_email})

# Update status and wear_count in main wardrobe collection
    wardrobe_col.update_one(
        query,
        {"$set": {"status": new_status, "wear_count": wear_count, "last_worn_at": last_worn_at}},
    )

# Read back updated document to return fresh data
    updated = wardrobe_col.find_one(query)
    return _to_dict(updated)


def record_outfit_worn(outfit_items, user_email: str = None):
    """Record that the user wore an entire outfit now.

    Stores timestamps so items can be auto-marked as "Needs Wash" after N days.
    Only updates items belonging to the specified user (if user_email provided).
    """
    if not isinstance(outfit_items, list):
        return

    now = datetime.utcnow()

    # Deduplicate ids so we don't double-update if the LLM repeats something.
    seen = set()
    ids = []
    for x in outfit_items:
        if not isinstance(x, dict):
            continue
        item_id = x.get("id")
        if item_id is None:
            continue
        try:
            item_id_int = int(item_id)
        except Exception:
            continue
        if item_id_int in seen:
            continue
        seen.add(item_id_int)
        ids.append(item_id_int)

    for item_id_int in ids:
        # Only update timestamp for items that currently exist and belong to user.
        # Also increment wear_count to track how many times worn since last wash
        query = {"id": int(item_id_int)}
        if user_email:
            query["user_email"] = user_email
        
        wardrobe_col.update_one(
            query,
            {
                "$set": {"last_worn_at": now},
                "$inc": {"wear_count": 1}  # Increment wear_count by 1
            },
        )


def refresh_dirty_items_by_days(days_until_dirty: int, user_email: str):
    """Auto-mark items as "Needs Wash" when last_worn_at is older than the threshold.

    Called opportunistically (e.g., when loading wardrobe or generating an outfit)
    so the UI stays in sync without a background scheduler.
    """
    if not isinstance(user_email, str) or not user_email.strip():
        raise ValueError("A valid user_email is required")

    try:
        threshold_days = int(days_until_dirty)
    except Exception:
        return

    if threshold_days <= 0:
        return

    now = datetime.utcnow()
    wardrobe_query = {
        "user_email": user_email,
        "status": {"$regex": "^clean$", "$options": "i"},
    }
    docs = list(wardrobe_col.find(wardrobe_query))

    for doc in docs:
        last = doc.get("last_worn_at")
        if not last:
            continue

        # Some Mongo drivers may return strings; ignore those for simplicity.
        if not isinstance(last, datetime):
            continue

        age_days = (now - last).days
        if age_days >= threshold_days:
            item_id = int(doc.get("id"))
            item_query = {"id": item_id, "user_email": user_email}
            wardrobe_col.update_one(
                item_query,
                {"$set": {"status": "Needs Wash"}},
            )
            dirty_col.update_one(
                {"item_id": item_id, "user_email": user_email},
                {
                    "$set": {
                        "item_id": item_id,
                        "user_email": user_email,
                        "marked_at": now,
                    }
                },
                upsert=True,
            )


# Update a wardrobe item fields
def update_item(item_id: int, data: dict, user_email: str = None):
    """Update mutable fields of a wardrobe item. Accepts name, category, type, color, status."""
    allowed_fields = {"name", "category", "type", "color", "status"}
    update = {k: v for k, v in data.items() if k in allowed_fields}

    if "type" in update:
        allowed_types = {"top", "bottom", "onepiece", "outer", "shoes"}
        type_val = str(update.get("type") or "").strip().lower()
        if type_val not in allowed_types:
            raise ValueError(f"Type must be one of: {', '.join(sorted(allowed_types))}")
        update["type"] = type_val

    if "color" in update:
        if not str(update.get("color") or "").strip():
            raise ValueError("Color is required for wardrobe item")
        update["color"] = str(update["color"]).strip()

    if not update:
        return None

    query = {"id": int(item_id)}
    if user_email:
        query["user_email"] = user_email
    
    wardrobe_col.update_one(query, {"$set": update})
    updated = wardrobe_col.find_one(query)
    return _to_dict(updated)
# Delete item from wardrobe (and dirty_items if applicable)
def delete_item(item_id: int, user_email: str = None) -> bool:
    """Delete a wardrobe item for a specific user."""
    if not isinstance(user_email, str) or not user_email.strip():
        return False
    query = {"id": int(item_id), "user_email": user_email}
    
# Remove item from main collection
    result = wardrobe_col.delete_one(query)
# Also clean up from dirty_items (if it was marked as dirty)
    dirty_col.delete_one({"item_id": int(item_id), "user_email": user_email})
# Return True if something was actually deleted
    return result.deleted_count > 0
