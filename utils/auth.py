"""
Authentication utilities including JWT token management and decorators.
"""

from flask import request, redirect, url_for, session, jsonify
from functools import wraps
import jwt
import os

# JWT secret key
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')
if not JWT_SECRET_KEY or len(JWT_SECRET_KEY) < 32:
    raise RuntimeError("JWT_SECRET_KEY must be set to at least 32 characters")
JWT_ALGORITHM = 'HS256'


def token_required(f):
    """
    Decorator to protect routes that require JWT authentication.
    Passes current_user (email) to the route.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = session.get("token")

        if not token:
            return redirect(url_for("auth.login"))

        try:
            # Decode token
            data = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
            current_user = data.get("email")
            if not current_user:
                session.pop("token", None)
                return redirect(url_for("auth.login"))
        except jwt.ExpiredSignatureError:
            session.pop("token", None)
            return redirect(url_for("auth.login"))
        except jwt.InvalidTokenError:
            session.pop("token", None)
            return redirect(url_for("auth.login"))

        # Token is valid → pass current_user to route
        return f(current_user, *args, **kwargs)

    return decorated
