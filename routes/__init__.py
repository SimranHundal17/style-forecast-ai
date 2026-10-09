# routes/__init__.py
from flask import Blueprint

# Public landing page (intro)
intro_bp = Blueprint("intro", __name__)

# Auth (login, signup, logout)
auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

# Wardrobe page + wardrobe APIs
wardrobe_bp = Blueprint("wardrobe", __name__, url_prefix="/wardrobe")

# Outfit generation page
outfit_bp = Blueprint("outfit", __name__, url_prefix="/get_outfit")

# Outfit history page + APIs
history_bp = Blueprint("history", __name__, url_prefix="/outfit_history")

# Accessories page
accessories_bp = Blueprint("accessories", __name__, url_prefix="/accessories")

# Plan Ahead page
plan_bp = Blueprint("plan", __name__, url_prefix="/plan_ahead")

# Profile page + JSON profile API
profile_bp = Blueprint("profile", __name__, url_prefix="/profile")
