### Database connection setup for MongoDB using env. variables.
## This module connects to two separate databases: the main application database
## and a secondary database for managing laundry items.

from pymongo import MongoClient
import os

# Main DB
MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = os.getenv("DATABASE_NAME", "styleforecast")

# Second DB for dirty clothes
LAUNDRY_DB_NAME = os.getenv("LAUNDRY_DATABASE_NAME", "styleforecast_laundry")

if not MONGO_URI:
    raise Exception("❌ MONGO_URI missing in .env")

# Create client connection to MongoDB server
client = MongoClient(MONGO_URI)

# Main application database connection 
db = client[DB_NAME]

# Second database used for items needing washing
laundry_db = client[LAUNDRY_DB_NAME]

print(f"✅ Connected to MongoDB main DB: {DB_NAME}")
print(f"🧺 Connected to Laundry DB: {LAUNDRY_DB_NAME}")
