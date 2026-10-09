# model/outfit_history_model.py
from utils.db import db

# Mongo collection
history_col = db["outfit_history"]

# Convert Mongo document to dictionary
def _to_dict(doc):
    if not doc:
        return None

    return {
        "id": doc.get("id"),
        "date": doc.get("date", ""),
        "location": doc.get("location", ""),
        "weather": doc.get("weather", ""),
        "outfit": doc.get("outfit", []),
        "occasion": doc.get("occasion", ""),
        "liked": doc.get("liked", False),
    }

# Generate numeric ID like in wardrobe
def _get_next_id():
    last = history_col.find_one(sort=[("id", -1)])
    if last:
        return int(last["id"]) + 1
    return 1

# Get all history entries sorted by newest first
def get_all_history(user_email: str = None):
    query = {"user_email": user_email} if user_email else {}
    docs = history_col.find(query).sort("id", -1)
    return [_to_dict(d) for d in docs]

# Add a new history entry to MongoDB
## ID is generated manually using _get_next_id()
def add_history_entry(entry, user_email: str = None):
    new_id = _get_next_id()

    doc = {
        "id": new_id,
        "date": entry.get("date"),
        "location": entry.get("location"),
        "weather": entry.get("weather"),
        "outfit": entry.get("outfit", []),
        "occasion": entry.get("occasion", ""),
        "liked": entry.get("liked", False),
        "user_email": user_email,
    }
# Add document into the collection
    history_col.insert_one(doc)
# Return normalized dict
    return _to_dict(doc)

# Delete history entry by ID
def delete_history_entry(entry_id, user_email: str = None):
    query = {"id": int(entry_id)}
    if user_email:
        query["user_email"] = user_email
    res = history_col.delete_one(query)
    return res.deleted_count > 0
