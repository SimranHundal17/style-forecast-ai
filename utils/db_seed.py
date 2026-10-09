### Utility script to seed lookup collections in MongoDB
## This script populates the 'lookup_categories' and 'lookup

from utils.db import db
   
# Collection for wardrobe categories (Casual, Formal, etc.)
def seed_lookup_categories():

    col = db["lookup_categories"]

    categories = [
        {"key": "Casual", "label": "Casual", "icon": "👕", "active": True},
        {"key": "Formal", "label": "Formal", "icon": "👔", "active": True},
        {"key": "Sports", "label": "Sports", "icon": "🏃", "active": True},
        {"key": "Gym", "label": "Gym", "icon": "🏋️", "active": True},
        {"key": "Party", "label": "Party", "icon": "🎉", "active": True},
        {"key": "Outdoor", "label": "Outdoor", "icon": "🥾", "active": True},
    ]

    inserted = 0
    updated = 0
       
# Upsert = update if exists, create if not exists
    for item in categories:
 
        result = col.update_one(
            {"key": item["key"]},
            {"$set": item},
            upsert=True
        )
# If upsert happened, Mongo gives upserted_id
        if result.upserted_id is not None:
            inserted += 1
        else:
            updated += 1

    print(f"✅ lookup_categories: inserted {inserted}, updated {updated}")

# Collection for gender values (used in Profile settings)
def seed_lookup_genders():

    col = db["lookup_genders"]

    genders = [
        {"key": "male", "label": "Male", "active": True},
        {"key": "female", "label": "Female", "active": True},
        {"key": "other", "label": "Other", "active": True},
        {"key": "prefer_not_to_say", "label": "Prefer not to say", "active": True},
    ]

    inserted = 0
    updated = 0

    for item in genders:
        result = col.update_one(
            {"key": item["key"]},
            {"$set": item},
            upsert=True
        )
        if result.upserted_id is not None:
            inserted += 1
        else:
            updated += 1

    print(f"✅ lookup_genders: inserted {inserted}, updated {updated}")

def main():
# Run both seed functions
    seed_lookup_categories()
    seed_lookup_genders()
    print("🎉 Done! Lookup collections are ready.")

# This makes the script runnable with: python utils/db_seed.py
if __name__ == "__main__":
    main()
