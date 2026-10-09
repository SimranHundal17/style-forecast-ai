"""
auth_routes.py

Authentication routes for the app: login (GET), login (POST), signup (POST), and logout (GET).

"""

from flask import render_template, request, redirect, url_for, session, jsonify
import jwt
from datetime import datetime, timedelta
from routes import auth_bp

from model.login_model import (
    verify_user,
    create_user,
    get_user_by_email
)

from utils.auth import JWT_SECRET_KEY, JWT_ALGORITHM

# Why these imports matter (brief):
# - verify_user: validate email/password and return user record on success.
# - create_user: persist a new user to the DB (recommended to hash passwords here).
# - get_user_by_email: check for existing accounts to prevent duplicates.
# - JWT_SECRET_KEY/JWT_ALGORITHM: used to sign/verify JWTs via PyJWT.


@auth_bp.route('/login', methods=['GET'])
def login():
    """
    Render the login form page.

    Returns the `login.html` template so the user can input credentials.
    """
    return render_template('login.html')


@auth_bp.route("/login", methods=["POST"])
def login_post():
    """
    Handle login submissions (form-encoded).

    Expects `email` and `password` fields in `request.form`.
    On success: creates a JWT with `email`, `user_id`, and `exp` (24h), stores
    it in `session['token']`, and returns JSON with a redirect URL.
    On failure: returns 401 and an error message.
    """
    # request.form.get returns None if the field is missing (safer than [] access)
    email = request.form.get("email")  # raw string input from the form (or None)
    password = request.form.get("password")  # raw string input from the form (or None)

    # authenticate the user via model layer (returns user dict or None)
    user = verify_user(email, password)

    if user:
        # Build JWT payload. Each claim is chosen for efficient server-side checks:
        token_payload = {
            "email": user["email"],   # include email so templates/clients can show user
            "user_id": user["id"],    # include numeric id to query DB without email lookup
            # `exp` claim: UTC datetime indicating when the token expires
            "exp": datetime.utcnow() + timedelta(hours=24)
        }

        # Encode the JWT. PyJWT may return bytes (older versions) or str (>=2.0).
        token = jwt.encode(token_payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
        # Normalize to str so the session (cookie) stores a predictable type
        if isinstance(token, bytes):
            token = token.decode("utf-8")  # decode bytes to UTF-8 string

        # Store auth state in Flask `session` (signed cookie by default):
        session["token"] = token          # the JWT used for authenticating future requests
        session["email"] = user["email"]  # convenience value for templates

        # Respond with JSON containing the client redirect URL on success
        return {"success": True, "redirect_url": url_for("wardrobe.wardrobe")}

    # Authentication failed: return JSON and 401 status for the frontend to display.
    return {"success": False, "message": "Invalid email or password"}, 401


@auth_bp.route("/signup", methods=["POST"])
def signup():
    """
    Create a new user account from JSON payload.

    Expected JSON keys: email, password, confirm_password, first_name,
    last_name, gender, age, days_until_dirty.
    Validates presence, password confirmation, and uniqueness of email.
    Returns 201 on success or 400 with an error message on invalid input.
    """
    # request.json returns None if body is not valid JSON
    data = request.json
    if not data:
        return jsonify({"success": False, "message": "Invalid JSON payload."}), 400

    # Extract fields from JSON; `.get` returns None if key missing
    email = data.get("email")
    password = data.get("password")
    confirm = data.get("confirm_password")
    first = data.get("first_name")
    last = data.get("last_name")
    gender = data.get("gender")
    age = data.get("age")
    days_dirty = data.get("days_until_dirty")

    # Ensure all fields are provided; `all` treats empty strings as False too.
    if not all([email, password, confirm, first, last, gender, age, days_dirty]):
        return jsonify({"success": False, "message": "Please fill all fields."}), 400

    # Password confirmation prevents user typos
    if password != confirm:
        return jsonify({"success": False, "message": "Passwords do not match."}), 400

    # Prevent duplicate accounts
    if get_user_by_email(email):
        return jsonify({"success": False, "message": "Email already registered."}), 400

    # Validate/cast numeric fields explicitly and return clear 400 on failure
    try:
        age_int = int(age)
        days_dirty_int = int(days_dirty)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Age and days_until_dirty must be valid integers."}), 400

    new_user = {
        "email": email,
        "password": password,  # create_user is expected to hash the password
        "first_name": first,
        "last_name": last,
        "gender": gender,
        "age": age_int,
        "days_until_dirty": days_dirty_int,
    }

    # Persist the new user via the model layer (which handles hashing)
    create_user(new_user)

    return jsonify({"success": True, "message": "Account created successfully!"}), 201


@auth_bp.route("/logout")
def logout():
    """
    Log out the user by clearing session data and redirecting to login.

    session.clear() removes all stored session keys including the JWT.
    """
    session.clear()
    return redirect(url_for("auth.login"))
