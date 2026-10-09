# Style Forecast

Style Forecast is a Flask web application for organizing a digital wardrobe and generating outfit suggestions from a user's clean clothing items, selected occasion, and local weather. Users can also manage accessories, save outfit history, and plan outfits for upcoming dates or trips. The project combines a server-rendered web interface with MongoDB persistence and external weather and language-model APIs.

## Key Features

- **Accounts and profiles:** Sign up and log in; profile fields and passwords can be updated. Passwords are hashed with bcrypt, and protected routes validate a JWT stored in the Flask session.
- **Digital wardrobe:** Add, edit, filter, and remove clothing items. Track item type, category, color, clean/wash status, and wear history.
- **Accessories:** Add, edit, filter, and remove accessories. Accessories can be included as optional outfit suggestions.
- **Outfit generation:** Choose an occasion and location; the app uses weather and the user's clean, occasion-matched wardrobe items to request a recommendation from Groq. The response is checked against available wardrobe and accessory IDs. Users can request another suggestion or save one to history.
- **Weather and location:** Browser geolocation is optional. OpenWeather geocoding supports location lookup, current weather informs outfit generation, and forecast data is used for planning.
- **Plan Ahead:** View a calendar, generate a plan for one day or a date range, review multi-day plans, and manage saved plans.
- **Outfit history:** Save generated outfits and view or delete saved entries. Past plans with outfits are archived into history when plans are loaded.
- **Laundry status updates:** Item wear timestamps are recorded when an outfit is saved. Status refreshes are performed when wardrobe data is loaded or outfit generation runs, using the user's configured day threshold.

## How It Works

1. The browser renders Jinja templates and uses page-specific JavaScript to call Flask endpoints.
2. Flask blueprints handle authentication and feature requests; model modules perform MongoDB reads and writes.
3. For outfit generation, the server retrieves the user's clean wardrobe, filters it by the selected occasion, obtains current weather (or accepts a forecast/weather override), and sends the available items and context to Groq. The response is validated before it is returned to the browser.
4. OpenWeather provides geocoding, current weather, and a five-day/three-hour forecast. Plan Ahead can also accept a manually selected weather condition when a forecast is unavailable.
5. Saved wardrobes, accessories, plans, users, and outfit history are stored in MongoDB.

## Technology Stack

- **Backend:** Python, Flask 3.0.3, Flask Blueprints, Jinja2
- **Database:** MongoDB through PyMongo 4.15.4
- **Frontend:** HTML, CSS, vanilla JavaScript, Bootstrap 5.3.3 (loaded from jsDelivr)
- **Authentication:** PyJWT-based JWTs and bcrypt password hashing
- **External services:** OpenWeather API and Groq's OpenAI-compatible chat completions API
- **Configuration:** `python-dotenv` 1.0.1 and environment variables

## Project Structure

```text
.
├── app.py                    # Flask application setup and local entry point
├── requirements.txt          # Declared Python dependencies
├── model/                    # MongoDB access and outfit-generation logic
├── routes/                   # Feature blueprints and HTTP endpoints
├── templates/                # Jinja HTML pages
├── static/                   # Page-specific CSS and JavaScript
├── utils/
│   ├── auth.py               # JWT validation and route decorator
│   ├── db.py                 # MongoDB connections
│   └── db_seed.py            # Lookup collection seed script
├── .gitignore                # Ignores .env files and common local artifacts
└── .vscode/settings.json     # Workspace Python settings
```

## Setup and Installation

### Prerequisites

- Python 3.9 or newer
- A reachable MongoDB deployment (local or hosted)
- An OpenWeather API key for location and weather features
- A Groq API key for outfit generation

Create and activate a virtual environment from the project root. On Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

On macOS or Linux, activate it with:

```sh
source .venv/bin/activate
```

Install the project dependencies:

```sh
python -m pip install -r requirements.txt
```

Create a `.env` file in the project root. `app.py` loads it relative to its own location. Do not commit this file.

## Environment Variables and API Keys

Set these values in `.env` for full local use:

```dotenv
MONGO_URI=<MongoDB connection string>
SECRET_KEY=<long random Flask session secret>
JWT_SECRET_KEY=<different long random JWT signing secret>
OPENWEATHER_API_KEY=<OpenWeather API key>
GROQ_API_KEY=<Groq API key>
```

Optional configuration supported by the code:

```dotenv
DATABASE_NAME=styleforecast
LAUNDRY_DATABASE_NAME=styleforecast_laundry
GROQ_API_URL=https://api.groq.com
GROQ_MODEL=llama-3.1-8b-instant
USE_LLM_OUTFITS=1
LLM_ONLY_MODE=1
FLASK_DEBUG=0
```

`LLM_ONLY_MODE` is read by the outfit model, but it does not bypass the route's LLM feature gate; outfit generation still requires a Groq key, and the route gate also accepts `USE_LLM_OUTFITS`.

`MONGO_URI`, `SECRET_KEY`, and `JWT_SECRET_KEY` are required. The app refuses to start if either signing secret is missing, shorter than 32 characters, or identical to the other. Use distinct, randomly generated values. The OpenWeather key enables geocoding and weather features; the Groq key is required to generate outfits. Keep credentials in the ignored local `.env` or a secrets manager, and rotate any credential that has ever been committed or shared. PyMongo uses `dnspython` for `mongodb+srv://` connection strings.

## Run the Application

From the project root, with the virtual environment active and `.env` configured:

```sh
python app.py
```

The local server uses Flask's default address and port: <http://127.0.0.1:5000/>. Debug mode is off by default; set `FLASK_DEBUG=1` only for local troubleshooting. The root URL redirects to the intro page. Create an account or log in to use the protected features.

## Screenshots

No screenshots are included yet. Add verified screenshots here when available.

## Known Limitations and Future Improvements

- Automated behavior and integration tests are not currently included.
- Existing `dirty_items` records created before ownership scoping may not contain `user_email`; the current code will not match or migrate those records. No migration is included, and ownership should not be guessed.
- The `app.py` development server is not a production deployment server. Keep debug mode off outside local troubleshooting.
- Plan Ahead uses OpenWeather's five-day/three-hour forecast endpoint, so forecast-backed planning is limited by that provider's available forecast window. Manual weather selection is available when a forecast is not returned.
- External API availability, rate limits, valid credentials, network access, and a reachable MongoDB instance are required for the corresponding features.
