"""
accessories_model.py

This file handles all database operations related to accessories in the
StyleForecast application. It follows the Model layer and only deals
with data storage and retrieval.
"""

from utils.db import db
from bson.objectid import ObjectId

# MongoDB collection for storing accessories
accessories = db["accessories"]


def get_all_accessories(user_email=None):
    """
    Retrieve all accessories from the database for a specific user.

    Converts MongoDB ObjectId to string so the data can be sent
    to the frontend as JSON.
    Returns items in reverse chronological order (newest first).
    If user_email is provided, only returns accessories for that user.
    """

    items = []
    query = {"user_email": user_email} if user_email else {}

    # Loop through all documents in the accessories collection
    # Sort by _id descending so newest items appear first
    for item in accessories.find(query).sort("_id", -1):
        item["_id"] = str(item["_id"])
        items.append(item)

    return items


def add_accessory(name, type_, user_email=None):
    """
    Add a new accessory to the database.

    Stores basic information like name and type, then returns
    the newly created accessory with its generated ID.
    Accessory is associated with a specific user.
    """

    item = {
        "name": name,
        "type": type_,
        "user_email": user_email,  # Associate accessory with user
    }

    result = accessories.insert_one(item)

    # Convert generated ObjectId to string for consistency
    item["_id"] = str(result.inserted_id)

    return item


def remove_accessory(accessory_id, user_email=None):
    """
    Remove an accessory using its unique ID.
    Only deletes if it belongs to the current user (if user_email provided).
    """
    query = {"_id": ObjectId(accessory_id)}
    if user_email:
        query["user_email"] = user_email
    
    return accessories.delete_one(query)


def update_accessory(accessory_id, name=None, type_=None, user_email=None):
    """Update accessory fields (name, type) and return updated doc.
    Only updates if it belongs to the current user (if user_email provided).
    """
    update = {}
    if name is not None:
        update['name'] = name
    if type_ is not None:
        update['type'] = type_
    if not update:
        return None

    query = {'_id': ObjectId(accessory_id)}
    if user_email:
        query['user_email'] = user_email
    
    accessories.update_one(query, {'$set': update})
    doc = accessories.find_one(query)
    if not doc:
        return None
    doc['_id'] = str(doc['_id'])
    return doc
