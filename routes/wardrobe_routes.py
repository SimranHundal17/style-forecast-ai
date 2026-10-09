# routes/wardrobe_routes.py
"""
Wardrobe Routes

HTTP endpoints for managing user wardrobe:
- GET /wardrobe/: Render wardrobe UI page
- GET /wardrobe/data: Retrieve items as JSON (with optional filter)
- POST /wardrobe/add-item: Create new wardrobe item
- PUT /wardrobe/update-item: Update item details
- POST /wardrobe/mark-status: Change item status (Clean/Needs Wash)
- DELETE /wardrobe/delete-item: Delete a wardrobe item

Key Features:
- Automatic status refresh: Items worn N+ days ago become "Needs Wash"
- Filtering by category or status
- All responses include icons for UI rendering
- JWT authentication on all routes via @token_required
"""

from flask import render_template, request, jsonify
from functools import wraps

# Import blueprint from routes/__init__.py
from routes import wardrobe_bp

# Import Model functions
from model.wardrobe_model import (
    get_all_items,
    get_items_by_filter,
    add_item,
    update_item,
    update_item_status,
    get_item_by_id,
    delete_item as delete_item_model,
    refresh_dirty_items_by_days,
)

from model.login_model import get_user_by_email

# Fallback auth decorator (used only if utils.auth is not available)
try:
    from utils.auth import token_required
except ImportError:
    # Simple fake decorator for local testing
    def token_required(f):
        @wraps(f)
        def wrapper(*a, **kw):
            # Pass a dummy user if real auth is missing
            return f(current_user="Guest", *a, **kw)
        return wrapper

# =====================================================
# PAGE RENDER
# =====================================================

# Wardrobe page route
@wardrobe_bp.route("/")
@token_required
def wardrobe(current_user):
    """Render the wardrobe management UI page."""
    return render_template("wardrobe.html", current_user=current_user)

# =====================================================
# DATA RETRIEVAL
# =====================================================

# Create wardrobe items as JSON
@wardrobe_bp.route("/data")
@token_required
def wardrobe_data(current_user):
    """
    Retrieve wardrobe items as JSON with optional filtering.
    
    Query parameters:
    - filter: "all", category name, or "Needs Wash"
    
    Automatically refreshes item statuses based on user's laundry preferences.
    If an item was worn N+ days ago, it's marked "Needs Wash".
    """

    # Opportunistically refresh wardrobe statuses based on the user's preference.
    # If an item was worn N+ days ago, it becomes "Needs Wash" automatically.
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

    filter_value = request.args.get("filter", "all")
    items = get_items_by_filter(filter_value, current_user)
    return jsonify(items)

# =====================================================
# CREATE
# =====================================================

# Add new wardrobe item
@wardrobe_bp.route("/add-item", methods=["POST"])
@token_required
def add_item_route(current_user):
    """
    Create a new wardrobe item.
    
    Required fields:
    - name: Item name (e.g., "Blue T-Shirt")
    - color: Color of the item
    
    Optional fields:
    - category: Category (default: "Casual")
    - type: Type (e.g., "top", "bottom")
    - status: Initial status (default: "Clean")
    
    Returns: Created item object with auto-generated ID
    """

    try:
        # Read form fields from the request
        name = request.form.get("name", "").strip()
        category = request.form.get("category", "Casual")
        status = request.form.get("status", "Clean")
        color = request.form.get("color", "").strip()
        item_type = request.form.get("type", "").strip()

        # Name is required
        if not name:
            return jsonify({"error": "Name is required"}), 400

        # Color is required
        if not color:
            return jsonify({"error": "Color is required"}), 400

        # Type is required
        if not item_type:
            return jsonify({"error": "Type is required"}), 400

        # Call model function to insert item into MongoDB
        # Pass current_user email so item is associated with this user
        new_item = add_item(name, category, status, color, item_type, user_email=current_user)
        # Return created item and HTTP 201 status
        return jsonify(new_item), 201
    
    except Exception as e:
        # Print error for debugging and return 500
        print(f"Error adding item: {e}")
        return jsonify({"error": str(e)}), 500

# Update an existing wardrobe item
@wardrobe_bp.route('/edit-item', methods=['POST'])
@token_required
def edit_item_route(current_user):
    try:
        data = request.get_json() or {}
        item_id = data.get('id')
        if not item_id:
            return jsonify({'error': 'ID is required'}), 400

        # Only allow certain fields to be updated
        fields = {k: data.get(k) for k in ['name', 'category', 'type', 'color', 'status'] if k in data}

        if not fields:
            return jsonify({'error': 'No updatable fields provided'}), 400

        updated = update_item(int(item_id), fields, current_user)
        if not updated:
            return jsonify({'error': 'Failed to update item'}), 500

        return jsonify(updated), 200
    except Exception as e:
        print(f"Error editing item: {e}")
        return jsonify({'error': str(e)}), 500

# Update item status Clean <-> Needs Wash
@wardrobe_bp.route("/update", methods=["POST"])
@token_required
def wardrobe_update(current_user):

    try:
# Read JSON body (or empty dict if no JSON)
        data = request.get_json() or {}
        item_id = data.get("id")

# id is required to update an item
        if not item_id:
            return jsonify({"error": "ID is required"}), 400

# Call model function to update status in MongoDB
        updated_item = update_item_status(int(item_id), current_user)

# If item does not exist
        if not updated_item:
            return jsonify({"error": "Item not found"}), 404

# Return updated item in JSON
        return jsonify({"ok": True, "item": updated_item}), 200

    except Exception as e:
# Print error for debugging and return 500
        print(f"Error updating item: {e}")
        return jsonify({"error": str(e)}), 500

# Delete item from wardrobe (and from dirty_items in model)
@wardrobe_bp.route("/api/items/<int:item_id>", methods=["DELETE"])
@token_required
def delete_item_route(current_user, item_id):

    try:
# Call model function to delete item from MongoDB
        ok = delete_item_model(item_id, current_user)

        if ok:
# Successfully deleted
            return jsonify({"ok": True}), 200

# Item not found in database
        return jsonify({"ok": False, "error": "not found"}), 404

    except Exception as e:
# Print error for debugging and return 500
        print(f"Error deleting item: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500
