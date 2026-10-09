// ======================================================
// static/get_outfit.js — Client-side behavior for the Get Outfit page
// ======================================================
// Purpose: handle location autocomplete, optional browser geolocation,
// outfit generation via server API, preview rendering, and saving to history.
// Key DOM IDs: `locationInput`, `locationSuggestions`, `generateOutfitBtn`,
// `loadingSpinner`, `outfitPreview`, `feedbackButtons`, `likeBtn`, `dislikeBtn`.


// ======================================================
// DOM ELEMENTS
// ======================================================
const locationInput = document.getElementById("locationInput");
const suggestionsBox = document.getElementById("locationSuggestions");
const spinner = document.getElementById("loadingSpinner");
const previewBox = document.getElementById("outfitPreview");
const generateBtn = document.getElementById("generateOutfitBtn");
const resultsWrap = document.getElementById("outfitResults");
const outfitSource = document.getElementById("outfitSource");

const feedbackButtons = document.getElementById("feedbackButtons");

const likeBtn = document.getElementById("likeBtn");
const dislikeBtn = document.getElementById("dislikeBtn");

// These variables hold the selected coordinates and the last generated outfit
let selectedLat = null;
let selectedLon = null;
let lastGenerated = null;
// When the user clicks Dislike, we regenerate while avoiding the previous outfit IDs.
let excludeIdsNext = null;
// Track whether the next generation is a regenerate (Dislike) vs first generate.
let generationMode = "generate";
// Used by the autocomplete debounce; cleared on subsequent keystrokes
let autocompleteTimeout = null;


// ======================================================
// OUTFIT ITEM LABELING (consistent across pages)
// ======================================================
// AI-generated outfits return objects like { name, color, icon, role, category }.
// For consistency with Plan Ahead + History, we display items as "Color Name".
function formatOutfitItemTitle(item) {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return String(item ?? '');

    const colorRaw = item.color ? String(item.color).trim() : '';
    const name = item.name ? String(item.name).trim() : (item.role ? String(item.role).trim() : 'Item');

    if (!colorRaw) return name;
    if (name.toLowerCase().startsWith(colorRaw.toLowerCase())) return name;
    return `${colorRaw} ${name}`.trim();
}


// ======================================================
// FETCH AND DISPLAY WEATHER
// ======================================================
async function updateWeatherDisplay(lat, lon) {
    try {
        // Call the backend to get weather for the selected location
        const url = `/get_outfit/api/location/reverse?lat=${lat}&lon=${lon}`;
        const response = await fetch(url, { credentials: "include" });
        const data = await response.json();

        if (data && (data.temp !== undefined || data.condition || data.weather)) {
            // Update weather display
            if (data.temp !== undefined) document.getElementById("weatherTemp").textContent = `${data.temp}°C`;
            if (data.condition) document.getElementById("weatherDesc").textContent = data.condition;
            document.getElementById("weatherLocation").textContent = locationInput.value || "📍 Select location";
            
            // Update weather icon based on condition
            let icon = "☁️";
            if (String(data.condition || '').includes("Rain")) icon = "🌧️";
            if (String(data.condition || '').includes("Clear")) icon = "☀️";
            if (String(data.condition || '').includes("Snow")) icon = "❄️";
            document.getElementById("weatherIcon").textContent = icon;
        }
    } catch (err) {
        console.log("Error fetching weather:", err);
        // Silently fail - weather will be shown when outfit is generated
    }
}


// ======================================================
// AUTOCOMPLETE
// ======================================================
locationInput.addEventListener("input", () => {
    const query = locationInput.value.trim();
    suggestionsBox.innerHTML = "";

    // Reset selected coordinates when the text changes — user must click an autocomplete item
    selectedLat = null;
    selectedLon = null;
    generateBtn.disabled = true;

    // Debounce: clear any pending request and schedule a new one after 250ms.
    // This prevents excessive server calls while the user is still typing.
    clearTimeout(autocompleteTimeout);
    if (!query) return;

    autocompleteTimeout = setTimeout(async () => {
        const url = `/get_outfit/api/location/autocomplete?q=${encodeURIComponent(query)}`;

        // Use credentials to ensure session auth (cookies/JWT) is sent with the request.
        const response = await fetch(url, { credentials: "include" });
        const results = await response.json();

        suggestionsBox.innerHTML = "";

        if (!Array.isArray(results) || results.length === 0) {
            const div = document.createElement("div");
            div.className = "autocomplete-item text-danger";
            div.textContent = "Location not found";
            suggestionsBox.appendChild(div);
            return;
        }

        // Each result is expected to be like { label, lat, lon }
        results.forEach(item => {
            const div = document.createElement("div");
            div.className = "autocomplete-item";
            div.textContent = item.label;

            div.addEventListener("click", () => {
                // Selecting an item fills the input and stores coordinates for generation
                locationInput.value = item.label;
                selectedLat = item.lat;
                selectedLon = item.lon;

                suggestionsBox.innerHTML = "";
                generateBtn.disabled = false;
                
                // Immediately fetch and display weather for the selected location
                updateWeatherDisplay(item.lat, item.lon);
            });

            suggestionsBox.appendChild(div);
        });
    }, 250); // 250ms debounce window
});


// Close dropdown when clicking outside the input/suggestions area
document.addEventListener("click", e => {
    if (!locationInput.contains(e.target)) {
        suggestionsBox.innerHTML = "";
    }
});


// ======================================================
// AUTO-DETECT LOCATION
// ======================================================
window.addEventListener("DOMContentLoaded", () => {
    // Try to auto-detect user's location (permission may be denied)
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(async pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        // reverse geocode via server endpoint to get a human-readable label
        const url = `/get_outfit/api/location/reverse?lat=${lat}&lon=${lon}`;
        const response = await fetch(url, { credentials: "include" });
        const data = await response.json();

        // Expect { label, lat, lon } or an { error } object
        if (!data.error) {
            locationInput.value = data.label;
            selectedLat = data.lat;
            selectedLon = data.lon;
            generateBtn.disabled = false;
            
            // Immediately fetch and display weather for the auto-detected location
            updateWeatherDisplay(data.lat, data.lon);
        }
    }, err => {
        // If geolocation fails (permission denied or timeout), do nothing — user can type a location
        // No action required here, but this is where you'd handle errors if desired.
    });
});


// ======================================================
// GENERATE OUTFIT
// ======================================================
generateBtn.addEventListener("click", async () => {
    // Ensure coordinates are available (user must select an autocomplete item or allow geolocation)
    if (!selectedLat || !selectedLon) return;

    // Lock the button while generating to prevent double-clicks
    generateBtn.disabled = true;

    const occasion = document.getElementById("occasionInput").value;

    // Show spinner (in results area) and clear previous preview/state
    previewBox.innerHTML = "";
    if (resultsWrap) resultsWrap.style.display = "block";
    if (outfitSource) outfitSource.style.display = "none";

    // Set spinner text immediately (before the request)
    const spinnerText = spinner ? spinner.querySelector('p') : null;
    if (spinnerText) {
        spinnerText.textContent = (generationMode === "regenerate")
            ? 'Regenerating outfit with AI...'
            : 'Generating outfit with AI...';
    }
    spinner.classList.remove("d-none");

    // Avoid duplicate spinners: the page already shows the main results spinner.

    feedbackButtons.style.display = "none";

    // Disable feedback while request is in flight
    likeBtn.disabled = true;
    dislikeBtn.disabled = true;

    // Call server API to generate an outfit using the LLM.
    const payload = {
        lat: selectedLat,
        lon: selectedLon,
        occasion: occasion || "Casual"
    };
    
    // Add exclude_ids if available BEFORE resetting
    if (Array.isArray(excludeIdsNext) && excludeIdsNext.length) {
        payload.exclude_ids = excludeIdsNext;
    }

    // Reset after consuming so normal Generate isn't permanently constrained.
    excludeIdsNext = null;
    
    console.log("Sending outfit request with payload:", payload);
    console.log("lat:", selectedLat, "lon:", selectedLon, "occasion:", occasion);

    try {
        // Add a 45-second timeout (longer than backend's 30s, but catches hanging requests)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        const response = await fetch("/get_outfit/api/get_outfit", {
            method: "POST",
            credentials: "include", // important to include auth cookies/session
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        let data;
        try {
            data = await response.json();
        } catch (parseErr) {
            console.error("Failed to parse JSON response:", parseErr);
            throw new Error("Invalid response from server");
        }
        
        console.log("Response status:", response.status);
        console.log("Outfit data received:", data);
        
        // Check if response has an error (even if status is 200)
        if (!response.ok || data.error) {
            throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Stop spinner after response received
        spinner.classList.add("d-none");

        // Re-enable only if location is still valid (input change resets coords)
        generateBtn.disabled = !(selectedLat && selectedLon);

        // If the server included weather fields (even on error), update the weather card.
        if (data && typeof data === 'object' && (data.temp !== undefined || data.condition || data.weather)) {
            if (data.temp !== undefined) document.getElementById("weatherTemp").textContent = `${data.temp}°C`;
            if (data.condition) document.getElementById("weatherDesc").textContent = data.condition;
            document.getElementById("weatherLocation").textContent = locationInput.value || "📍 Select location";
            if (data.weather) document.getElementById("weatherFull").textContent = data.weather;

            let icon = "☁️";
            if (String(data.condition || '').includes("Rain")) icon = "🌧️";
            if (String(data.condition || '').includes("Clear")) icon = "☀️";
            if (String(data.condition || '').includes("Snow")) icon = "❄️";
            document.getElementById("weatherIcon").textContent = icon;
        }

        // Server can return { error } on failure
        if (data.error) {
            if (resultsWrap) resultsWrap.style.display = "block";
            if (outfitSource) outfitSource.style.display = "none";
            previewBox.innerHTML = "";
            const err = document.createElement('div');
            err.className = 'alert alert-danger outfit-alert';
            err.textContent = data.error;
            previewBox.appendChild(err);

            // Restore feedback state
            likeBtn.disabled = false;
            dislikeBtn.disabled = false;
            generationMode = "generate";
            return;
        }

        // --- Outfit preview ---
        previewBox.innerHTML = "";

        // Show warning if model suggests it
        if (data.warning) {
            const warn = document.createElement('div');
            warn.className = 'alert alert-warning outfit-alert';
            warn.textContent = data.warning;
            previewBox.appendChild(warn);
        }

        if (resultsWrap) resultsWrap.style.display = "block";

        // Show AI source badge when present
        if (outfitSource) {
            outfitSource.style.display = (data.source && data.source === 'llm') ? "inline-flex" : "none";
        }

        // Show AI explanation when present
        const aiEl = document.getElementById('aiExplanation');
        if (aiEl) {
            if (data.explanation) {
                aiEl.style.display = '';
                aiEl.classList.remove('is-empty');
                aiEl.textContent = data.explanation;
            } else {
                // Keep space reserved to avoid layout shift between generations.
                aiEl.style.display = '';
                aiEl.classList.add('is-empty');
                aiEl.textContent = '';
            }
        }

        (data.outfit || []).forEach(item => {
            const div = document.createElement("div");
            div.className = "outfit-item d-flex align-items-center gap-3 p-2";

            if (typeof item === 'string') {
                div.textContent = item;
            } else {
                const icon = document.createElement('div');
                icon.className = 'outfit-item-icon fs-3';
                icon.textContent = item.icon || '👗';

                const info = document.createElement('div');
                info.className = 'outfit-item-info';

                const name = document.createElement('div');
                name.className = 'fw-semibold';
                name.textContent = formatOutfitItemTitle(item);

                const meta = document.createElement('div');
                meta.className = 'text-muted small';
                const parts = [];
                if (item.role) parts.push(item.role);
                if (item.category) parts.push(item.category);
                meta.textContent = parts.join(' • ');

                info.appendChild(name);
                info.appendChild(meta);
                div.appendChild(icon);
                div.appendChild(info);
            }

            previewBox.appendChild(div);
        });

        // Save the relevant metadata locally so the Like button can save it later
        lastGenerated = {
            location: locationInput.value,
            weather: data.weather,
            occasion,
            outfit: data.outfit
        };

        // Show like/dislike controls to gather quick feedback
        feedbackButtons.style.display = "block";

        // Flash to show something changed after regeneration
        if (generationMode === "regenerate") {
            previewBox.classList.add("outfit-updated-flash");
            setTimeout(() => previewBox.classList.remove("outfit-updated-flash"), 700);
        }

        // Restore buttons
        likeBtn.disabled = false;
        dislikeBtn.disabled = false;
        generationMode = "generate";
    } catch (error) {
        console.error("Outfit generation error:", error);
        spinner.classList.add("d-none");
        generateBtn.disabled = !(selectedLat && selectedLon);
        
        // Handle timeout or network error
        if (resultsWrap) resultsWrap.style.display = "block";
        if (outfitSource) outfitSource.style.display = "none";
        previewBox.innerHTML = "";
        const err = document.createElement('div');
        err.className = 'alert alert-danger outfit-alert';
        
        if (error.name === 'AbortError') {
            err.textContent = 'Request took too long. The AI server is slow right now. Please try again in a moment.';
        } else {
            err.textContent = `Error: ${error.message || 'Failed to generate outfit'}`;
        }
        previewBox.appendChild(err);
        
        // Restore feedback state
        likeBtn.disabled = false;
        dislikeBtn.disabled = false;
        generationMode = "generate";
    }
});


// ======================================================
// DISLIKE → regenerate
dislikeBtn.addEventListener("click", () => {
    // UX: mark next generation as a regenerate
    generationMode = "regenerate";

    // Exclude previous outfit IDs so the backend can force a different combination.
    const prev = (lastGenerated && Array.isArray(lastGenerated.outfit)) ? lastGenerated.outfit : [];
    const ids = prev
        .map(x => (x && typeof x === 'object') ? x.id : null)
        .filter(x => Number.isFinite(x));
    excludeIdsNext = ids.length ? ids : null;
    generateBtn.click();
});


// ======================================================
// LIKE → save immediately
// ======================================================
// Like saves the currently shown outfit to the user's history. The server expects
// a payload like { location, weather, occasion, outfit, rating } — here `rating` is
// set to null to indicate a positive save without an explicit numeric score.
likeBtn.addEventListener("click", async () => {
    if (!lastGenerated) return;

    const res = await fetch("/get_outfit/api/save_outfit", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ...lastGenerated,
            rating: null
        })
    });

    const result = await res.json();

    // Show a confirmation message on successful save
    if (result.success) {
        alert("Outfit saved to history!");
    }
});

