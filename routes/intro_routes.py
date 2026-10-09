# routes/intro_routes.py
## Routes for the public landing (intro) page
from flask import render_template
from routes import intro_bp

# Render landing page (public page, no authentication)
@intro_bp.route("/intro")
def intro():
    return render_template("index.html")
