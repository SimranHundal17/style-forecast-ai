"""
login_model.py

This file handles all database operations related to users and authentication.
It is responsible for creating users, verifying login credentials, and
fetching user data from the database.

This file belongs to the Model layer and does not handle routing or UI logic.
"""

from utils.db import db
import bcrypt

# MongoDB collection for storing user information
users = db["users"]


def get_user_by_email(email: str):
    """
    Fetch a user document from the database using email.
    """
    return users.find_one({"email": email})


def get_all_users():
    """
    Return all users from the database excluding password field.
    This is useful for admin or debugging purposes.
    """
    return list(users.find({}, {"password": 0}))


def verify_user(email: str, password: str):
    """
    Verify user login credentials using bcrypt.

    Returns the user document if authentication is successful,
    otherwise returns None.
    """

    # Fetch user document using email
    user = users.find_one({"email": email})
    if not user:
        return None

    # Retrieve stored password hash from database
    stored_hash = user.get("password")
    if not stored_hash:
        return None

    # Convert stored hash back to bytes if it is stored as string
    if isinstance(stored_hash, str):
        stored_hash = stored_hash.encode("utf-8")

    # Compare provided password with stored hashed password
    if bcrypt.checkpw(password.encode("utf-8"), stored_hash):
        return user

    return None


def create_user(data: dict):
    """
    Create a new user account.

    Password is hashed using bcrypt before saving.
    A numeric user ID is auto-generated.
    """

    raw_password = data.get("password")

    # Ensure password exists before creating user
    if not raw_password:
        raise ValueError("Password is required for user creation")

    # Hash password with bcrypt (salt is automatically included)
    hashed = bcrypt.hashpw(raw_password.encode("utf-8"), bcrypt.gensalt())

    # Store hashed password as string for MongoDB compatibility
    data["password"] = hashed.decode("utf-8")

    # Generate auto-increment numeric ID
    last = users.find_one(sort=[("id", -1)])
    data["id"] = (last["id"] + 1) if last else 1

    users.insert_one(data)
    return data
