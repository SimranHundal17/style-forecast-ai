/* ============================================================
   static/plan_ahead.js — Plan-Ahead page client behavior
   ===========================================================
   Purpose: Allow users to plan outfits across single or multi-day ranges.
   - Server endpoints used by this file (examples):
     * GET /plan/plans -> [ { date, id, outfit, weather, ... } ]
     * POST /plan/create -> returns created plan(s) array
     * POST /plan/update -> accepts { id, outfit }
     * POST /plan/delete -> accepts { id }
   Notes: This file intentionally separates temp/saved state to avoid overwriting
   backend truth until the user explicitly saves. Do not change savedPlans
   directly when a plan is still temporary.
============================================================ */

/* -------------------- GLOBAL STATE ---------------------- */
let savedPlans = {};          // Real saved plans from backend
let tempPlans = {};          // Unsaved temporary plans during generation
let selectedDates = [];       // User-picked date range
let sliderDates = [];         // Used ONLY during generating
let currentSlideIndex = 0;

let selectedLat = null;
let selectedLon = null;
let userManuallySelectedLocation = false;

// For Dislike/regenerate variety: store the most recently shown outfit ids per date.
// We send these as `exclude_ids` so the backend tries a different combination.
let excludeIdsByDate = {};

function syncInputsFromPlan(p) {
    if (!p) return;

    if (typeof p.location === "string" && p.location.trim()) {
        locationInput.value = p.location;
    }

    // Backend may serialize numbers as strings; normalize.
    const latNum = Number(p.lat);
    const lonNum = Number(p.lon);
    if (!Number.isNaN(latNum)) selectedLat = latNum;
    if (!Number.isNaN(lonNum)) selectedLon = lonNum;

    if (typeof p.occasion === "string" && p.occasion.trim()) {
        occasionInput.value = p.occasion;
    }
}

// Keep occasion options consistent across pages
const OCCASION_OPTIONS = ["Casual", "Formal", "Party", "Gym", "Rainy"];

const today = new Date();

/* -------------------- DOM ---------------------- */
const planType = document.getElementById("planType");
const yearSelect = document.getElementById("yearSelect");
const monthSelect = document.getElementById("monthSelect");
const calendar = document.getElementById("calendar");
const planModalEl = document.getElementById("planModal");
const planModal = new bootstrap.Modal(planModalEl);

// Ensure modal can receive focus so we can blur dropdowns cleanly during slide nav
if (planModalEl && !planModalEl.hasAttribute("tabindex")) {
    planModalEl.setAttribute("tabindex", "-1");
}

const planInputSection = document.getElementById("planInputSection");
const singleDayContainer = document.getElementById("singleDayContainer");

const sliderContainer = document.getElementById("sliderContainer");
const slider = document.getElementById("slider");
const sliderDots = document.getElementById("sliderDots");
const loadingSpinner = document.getElementById("loadingSpinner");
const prevSlideBtn = document.getElementById("prevSlide");
const nextSlideBtn = document.getElementById("nextSlide");

const locationInput = document.getElementById("locationInput");
const suggestionsBox = document.getElementById("locationSuggestions");
const occasionInput = document.getElementById("occasionInput");
const weatherInput = document.getElementById("weatherInput");
const weatherAlert = document.getElementById("weatherAlert");
const generateBtn = document.getElementById("generateBtn");

const planDateHeading = document.getElementById("planDateHeading");
const planErrorAlert = document.getElementById("planErrorAlert");

function setMultiDayLoading(isLoading) {
    if (!sliderContainer) return;

    // Important: clear any previously forced height from a prior slider run.
    // Otherwise the empty slider can reserve a large height, leaving big blank space
    // under the spinner while outfits are generating.
    if (slider) {
        slider.style.removeProperty("height");
    }

    if (isLoading) {
        if (loadingSpinner) loadingSpinner.classList.remove("d-none");
        if (slider) slider.classList.add("d-none");
        if (sliderDots) sliderDots.classList.add("d-none");
        if (prevSlideBtn) prevSlideBtn.classList.add("d-none");
        if (nextSlideBtn) nextSlideBtn.classList.add("d-none");
    } else {
        if (loadingSpinner) loadingSpinner.classList.add("d-none");
        if (slider) slider.classList.remove("d-none");
        if (sliderDots) sliderDots.classList.remove("d-none");
        if (prevSlideBtn) prevSlideBtn.classList.remove("d-none");
        if (nextSlideBtn) nextSlideBtn.classList.remove("d-none");
    }
}

/* ============================================================
   OUTFIT RENDERING HELPERS (AI + legacy-safe)
============================================================ */
function escapeHtml(input) {
    return String(input ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatOutfitItemLabel(item) {
    // Legacy history sometimes stores strings; AI stores objects.
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return String(item ?? "");

    const icon = item.icon ? String(item.icon) : "";
    const color = item.color ? `${item.color} ` : "";
    const name = item.name ? String(item.name) : "Item";

    return `${icon ? icon + " " : ""}${color}${name}`.trim();
}

function renderOutfitPreview(outfit, errorMessage) {
    if (errorMessage) {
        return `<div class="alert alert-danger w-100">${escapeHtml(errorMessage)}</div>`;
    }

    const list = Array.isArray(outfit) ? outfit : [];
    if (!list.length) {
        return `<div class="alert alert-warning w-100">No outfit generated.</div>`;
    }

    return list
        .map(i => `<div class="outfit-item">${escapeHtml(formatOutfitItemLabel(i))}</div>`)
        .join("");
}

function renderOutfitLoading(message) {
    return `
        <div class="outfit-loading-inline w-100">
            <div class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></div>
            <span>${escapeHtml(message || "Regenerating outfit")}</span>
        </div>
    `;
}

function setButtonLoading(btn, isLoading, label) {
    if (!btn) return;
    if (isLoading) {
        if (!btn.dataset.originalHtml) {
            btn.dataset.originalHtml = btn.innerHTML;
        }
        btn.disabled = true;
        btn.innerHTML = `
            <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            ${escapeHtml(label || "Generating...")}
        `;
    } else {
        if (btn.dataset.originalHtml) {
            btn.innerHTML = btn.dataset.originalHtml;
            delete btn.dataset.originalHtml;
        }
        btn.disabled = false;
    }
}

let flashNextSingleDate = null;
let flashNextSliderDate = null;

function getNumericOutfitIds(outfit) {
    const list = Array.isArray(outfit) ? outfit : [];
    return list
        .map(x => (x && typeof x === "object") ? x.id : null)
        .map(x => {
            const n = Number(x);
            return Number.isFinite(n) ? n : null;
        })
        .filter(x => x !== null);
}

function getCurrentOutfitForDate(dateStr) {
    // Prefer temp session state; fall back to saved state.
    const p = tempPlans[dateStr] || savedPlans[dateStr];
    if (!p) return [];
    return p.tempOutfit || p.outfit || [];
}

function getOtherDaysOutfitIds(dateStr) {
    // Used for multi-day variety: prefer not to reuse the same wardrobe items
    // across different days in the same slider.
    const ids = new Set();
    const dates = Array.isArray(sliderDates) ? sliderDates : [];
    for (const d of dates) {
        if (d === dateStr) continue;
        const p = tempPlans[d];
        if (!p) continue;
        for (const id of getNumericOutfitIds(p.tempOutfit || p.outfit || [])) {
            ids.add(id);
        }
    }
    return Array.from(ids);
}

function mergeExcludeIds(...lists) {
    const out = new Set();
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const x of list) {
            const n = Number(x);
            if (Number.isFinite(n)) out.add(n);
        }
    }
    return Array.from(out);
}

function buildOccasionSelectHtml(selectedValue) {
    const selected = String(selectedValue || "");
    return `
        <select class="form-select occasion-select mx-auto" style="max-width:250px;">
            ${OCCASION_OPTIONS.map(o => {
                const isSel = o === selected ? "selected" : "";
                return `<option value="${escapeHtml(o)}" ${isSel}>${escapeHtml(o)}</option>`;
            }).join("")}
        </select>
    `;
}

async function regenerateMultiDayWithOccasion(dateStr, slideElement) {
    const p = tempPlans[dateStr];
    if (!p) {
        alert("Something went wrong. Please try again.");
        return;
    }

    const host = slideElement || slider.children[currentSlideIndex];
    const sel = host ? host.querySelector(".occasion-select") : null;
    const chosenOccasion = sel ? sel.value : p.occasion;

    // UX: show spinner and disable button
    if (host) {
        const preview = host.querySelector(".outfit-preview");
        if (preview) preview.innerHTML = renderOutfitLoading("Generating outfit");
        const btn = host.querySelector(".regen-btn");
        if (btn) btn.disabled = true;
    }

    // Exclude previously shown items for variety (if any), and also avoid items
    // used on other days in this slider when possible.
    const prevIds = getNumericOutfitIds(getCurrentOutfitForDate(dateStr));
    const otherIds = getOtherDaysOutfitIds(dateStr);
    const excludeIds = mergeExcludeIds(prevIds, otherIds);
    excludeIdsByDate[dateStr] = excludeIds;

    const makeReq = (ids) => fetch("/get_outfit/api/get_outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            lat: p.lat,
            lon: p.lon,
            occasion: chosenOccasion,
            weather: p.weather,
            temp: p.temp,
            exclude_ids: Array.isArray(ids) && ids.length ? ids : undefined
        })
    }).then(r => r.json());

    // Try with cross-day exclusions; if too restrictive, fall back to just prevIds,
    // then to no exclusions (allows repeats when wardrobe is limited).
    let outfitData = await makeReq(excludeIds);
    if (outfitData?.error && otherIds.length) {
        outfitData = await makeReq(prevIds);
    }
    if (outfitData?.error && prevIds.length) {
        outfitData = await makeReq([]);
    }

    // Update temp plan for this day
    p.occasion = chosenOccasion;
    p.tempOutfit = outfitData.outfit || [];
    p.outfitError = outfitData.error || null;

    flashNextSliderDate = dateStr;
    buildSlider();
    openSliderOn(dateStr);
}

function setPlanInputHeadingFromSelectedDates() {
    if (!planDateHeading) return;
    if (!Array.isArray(selectedDates) || selectedDates.length === 0) {
        planDateHeading.textContent = "";
        return;
    }
    if (selectedDates.length === 1) {
        planDateHeading.textContent = selectedDates[0];
        return;
    }
    planDateHeading.textContent = `${selectedDates[0]} → ${selectedDates[selectedDates.length - 1]}`;
}

function clearPlanInputAlerts() {
    if (planErrorAlert) {
        planErrorAlert.classList.add("d-none");
        planErrorAlert.textContent = "";
    }
    if (weatherAlert) {
        weatherAlert.classList.add("d-none");
    }
}

function showPlanInputError(message) {
    if (!planErrorAlert) return;
    planErrorAlert.textContent = String(message || "Something went wrong. Please try again.");
    planErrorAlert.classList.remove("d-none");
}

/* ============================================================
   INITIAL LOAD
============================================================ */
async function loadSavedPlans() {
    // Fetch all saved plans from the server. Expected response is an array of
    // plan objects like { date: 'YYYY-MM-DD', id, outfit, weather, ... }.
    // Note: if your server requires cookies/session, you may need to include
    // `{ credentials: 'include' }` depending on auth setup.
    const res = await fetch("/plan/plans");
    const list = await res.json();

    // Rebuild savedPlans map for quick lookup by date
    savedPlans = {};
    list.forEach(p => savedPlans[p.date] = p);

    generateCalendar();
}

// Load saved plans on page load
loadSavedPlans();

/* ============================================================
   YEAR / MONTH OPTIONS
============================================================ */
for (let y = today.getFullYear(); y <= today.getFullYear() + 2; y++) {
    yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
}
yearSelect.value = today.getFullYear();

[
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
].forEach((m, i) => {
    monthSelect.innerHTML += `<option value="${i}">${m}</option>`;
});
monthSelect.value = today.getMonth();

yearSelect.addEventListener("change", generateCalendar);
monthSelect.addEventListener("change", generateCalendar);

/* ============================================================
   BUILD CALENDAR
============================================================ */
function generateCalendar() {
    calendar.innerHTML = "";

    const y = parseInt(yearSelect.value);
    const m = parseInt(monthSelect.value);

    // getDay(): 0 = Sunday, 1 = Monday, ...
    // We transform so Monday is the first column (0 = Monday)
    // (firstDay === 0 ? 6 : firstDay - 1) maps Sunday -> 6 and shifts others down.
    // Note: constructing `new Date(y, m, d)` uses local timezone; be careful with
    // comparisons if your backend stores dates in UTC.
    let firstDay = new Date(y, m, 1).getDay();
    firstDay = firstDay === 0 ? 6 : firstDay - 1;
    const lastDate = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        calendar.appendChild(document.createElement("div"));
    }

    for (let d = 1; d <= lastDate; d++) {
        const div = document.createElement("div");
        div.className = "calendar-day";

        const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const dateObj = new Date(dateStr + "T00:00:00");
        const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        div.textContent = d;

        if (dateObj < todayDateOnly) {
            div.classList.add("disabled");
        }

        /* Highlight saved future/today outfits */
        if (
            savedPlans[dateStr]?.outfit?.length > 0 &&
            dateObj >= todayDateOnly
        ) {
            div.classList.add("selected");
        }

        /* 🔥 Highlight TODAY always (even if selected) */
        if (
            dateObj.getTime() === todayDateOnly.getTime()
        ) {
            div.classList.add("today");
        }

        div.addEventListener("click", () => {
            if (!div.classList.contains("disabled")) onCalendarClick(dateStr);
        });

        calendar.appendChild(div);
    }
}

/* ============================================================
   DATE CLICK LOGIC — NO TRIP REOPENING
============================================================ */
function onCalendarClick(dateStr) {

    // 🔥 If this date already has a saved outfit (persisted in DB), always
    // open the saved single-day view (never re-open as a multi-day slider).
    // This preserves backend truth and prevents accidental overwrites.
    if (savedPlans[dateStr] && savedPlans[dateStr].id && savedPlans[dateStr].outfit?.length > 0) {
        openSavedSingleDay(dateStr);
        return;
    }

    // NEW SINGLE DAY
    if (planType.value === "one") {
        selectedDates = [dateStr];
        openModalForNew();
        return;
    }

    // MULTI-DAY: select start → end
    if (selectedDates.length === 0) {
        selectedDates = [dateStr];
        highlightRange();
        return;
    }

    if (selectedDates.length === 1) {
        const start = new Date(selectedDates[0]);
        const end = new Date(dateStr);

        selectedDates = [];
        let cur = new Date(Math.min(start, end));
        const fin = new Date(Math.max(start, end));

        while (cur <= fin) {
            selectedDates.push(cur.toISOString().split("T")[0]);
            cur.setDate(cur.getDate() + 1);
        }

        highlightRange();
        openModalForNew();
        return;
    }

    selectedDates = [dateStr];
    highlightRange();
}

/* ============================================================
   HIGHLIGHT TEMPORARY RANGE
============================================================ */
function highlightRange() {
    generateCalendar();

    document.querySelectorAll(".calendar-day").forEach(day => {
        const y = yearSelect.value;
        const m = monthSelect.value;
        const d = day.textContent;

        // Some cells are empty placeholders (no day text); skip them safely
        if (!d) return;

        // Build an ISO-style date string for comparison
        const dateStr = `${y}-${String(parseInt(m) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

        if (selectedDates.includes(dateStr)) {
            day.classList.add("range");
        }
    });
}

/* ============================================================
   OPEN NEW PLAN INPUT
============================================================ */
function openModalForNew() {
    tempPlans = {};
    sliderDates = [];
    currentSlideIndex = 0;
    excludeIdsByDate = {};

    planInputSection.classList.remove("d-none");
    singleDayContainer.classList.add("d-none");
    sliderContainer.classList.add("d-none");

    locationInput.value = "";
    suggestionsBox.innerHTML = "";
    generateBtn.disabled = true;

    setPlanInputHeadingFromSelectedDates();
    clearPlanInputAlerts();

    // Reset coordinates & trigger auto-detect (unless user types their own location)
    selectedLat = selectedLon = null;
    userManuallySelectedLocation = false;

    autoDetectLocation();
    planModal.show();
}

/* ============================================================
   AUTO-DETECT LOCATION
============================================================ */
async function autoDetectLocation() {
    if (userManuallySelectedLocation) return;

    // Try to use browser geolocation; user may deny permission or it may fail.
    navigator.geolocation.getCurrentPosition(async pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        // Server reverse-geocoding endpoint should return { label, lat, lon } or { error }
        const res = await fetch(`/get_outfit/api/location/reverse?lat=${lat}&lon=${lon}`);
        const data = await res.json();

        if (!data.error) {
            locationInput.value = data.label;
            selectedLat = lat;
            selectedLon = lon;
            generateBtn.disabled = false;
        }
    });
}

/* ============================================================
   AUTOCOMPLETE LOCATION
============================================================ */
let autocompleteTimeout = null;

locationInput.addEventListener("input", () => {
    userManuallySelectedLocation = true;
    suggestionsBox.innerHTML = "";
    selectedLat = selectedLon = null;
    generateBtn.disabled = true;

    const q = locationInput.value.trim();
    clearTimeout(autocompleteTimeout);

    if (!q) return;

    // Debounced autocomplete (250ms) to reduce server load while typing.
    autocompleteTimeout = setTimeout(async () => {
        const res = await fetch(`/get_outfit/api/location/autocomplete?q=${encodeURIComponent(q)}`);
        const list = await res.json();

        suggestionsBox.innerHTML = "";

        if (!list.length) {
            suggestionsBox.innerHTML = `<div class="autocomplete-item text-danger">Not found</div>`;
            return;
        }

        // Each item is expected to have { label, lat, lon }
        list.forEach(item => {
            const div = document.createElement("div");
            div.className = "autocomplete-item";
            div.textContent = item.label;

            div.onclick = () => {
                // Selecting a suggestion stores coordinates used for generation
                locationInput.value = item.label;
                selectedLat = item.lat;
                selectedLon = item.lon;
                suggestionsBox.innerHTML = "";
                generateBtn.disabled = false;
            };

            suggestionsBox.appendChild(div);
        });
    }, 250);
});

/* ============================================================
   GENERATE BUTTON
============================================================ */
generateBtn.addEventListener("click", () => {

    if (!selectedLat || !selectedLon) {
        alert("Please select location first.");
        return;
    }

    if (planType.value === "one") {
        generateSingleDay();
        return;
    }

    generateMultiDay();
});

/* ============================================================
   GET WEATHER
============================================================ */
async function getWeatherFor(dateStr) {
    const res = await fetch(`/plan_ahead/api/weather_for_date?lat=${selectedLat}&lon=${selectedLon}&date=${dateStr}`);
    return await res.json();
}

/* ============================================================
   GENERATE SINGLE DAY — CLEAN TEMP BEFORE GENERATING
============================================================ */
async function generateSingleDay(excludeIds) {

    const date = selectedDates[0];

    // 🔥 Remove any transient fields from a previously saved plan so that
    // re-generation starts from a clean slate (prevents showing stale temp data).
    if (savedPlans[date]) {
        delete savedPlans[date].tempOutfit;
        delete savedPlans[date].outfit;
        delete savedPlans[date].weather;
        delete savedPlans[date].temp;
        delete savedPlans[date].description;
        delete savedPlans[date].missingWeather;
    }

    clearPlanInputAlerts();

    // UX: On single-day generation (input modal), show spinner while generating.
    const showButtonSpinner = planInputSection && !planInputSection.classList.contains("d-none");
    if (showButtonSpinner) setButtonLoading(generateBtn, true, "Generating outfit...");

    // If the user manually entered a weather override, we skip the getWeatherFor API
    // and pass the provided weather string to the get_outfit generation endpoint.

    const p = {
        date,
        location: locationInput.value,
        lat: selectedLat,
        lon: selectedLon,
        occasion: occasionInput.value
    };

    try {
        let weatherData;

        if (weatherInput.value) {
            weatherData = { weather: weatherInput.value, temp: null, description: null };
        } else {
            weatherData = await getWeatherFor(date);
        }

        if (weatherData.error) {
            weatherAlert.classList.remove("d-none");

            // If this was triggered via Dislike/regenerate, restore buttons so user can retry.
            try {
                const dislikeBtn = document.querySelector(".sd-dislike");
                const likeBtn = document.querySelector(".sd-like");
                if (dislikeBtn) dislikeBtn.disabled = false;
                if (likeBtn) likeBtn.disabled = false;
            } catch (e) {
                // no-op
            }
            return;
        }

        const outfitData = await fetch("/get_outfit/api/get_outfit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                lat: selectedLat,
                lon: selectedLon,
                occasion: p.occasion,
                weather: weatherData.weather,
                temp: weatherData.temp,
                exclude_ids: Array.isArray(excludeIds) && excludeIds.length ? excludeIds : undefined
            })
        }).then(r => r.json());

    p.weather = weatherData.weather;
    p.temp = weatherData.temp;
    p.description = weatherData.description;
    p.tempOutfit = outfitData.outfit || [];
    p.outfitError = outfitData.error || null;

    // Record the last shown ids for this date so Dislike can exclude them next time.
    excludeIdsByDate[date] = getNumericOutfitIds(p.tempOutfit);

        // If the outfit couldn't be generated (e.g., not enough items), keep the user
        // in the editable input modal so they can change location/occasion and retry.
        if (p.outfitError) {
            tempPlans[date] = p;
            planInputSection.classList.remove("d-none");
            singleDayContainer.classList.add("d-none");
            sliderContainer.classList.add("d-none");
            setPlanInputHeadingFromSelectedDates();
            showPlanInputError(p.outfitError);
            return;
        }

        tempPlans[date] = p;
        showGeneratedSingle(date);
    } finally {
        if (showButtonSpinner) setButtonLoading(generateBtn, false);
    }
}

/* ============================================================
   SHOW GENERATED SINGLE DAY
============================================================ */
function showGeneratedSingle(dateStr) {

    sliderContainer.classList.add("d-none");
    planInputSection.classList.add("d-none");
    singleDayContainer.classList.remove("d-none");

    const p = tempPlans[dateStr];

    document.querySelector(".sd-date").textContent = dateStr;
    document.querySelector(".sd-location").textContent = p.location;
    document.querySelector(".sd-occasion").textContent = p.occasion;
    document.querySelector(".sd-weather").textContent =
        `${p.weather}${p.temp ? ` (${p.temp}°C)` : ""}`;

    document.querySelector(".sd-outfit").innerHTML =
        renderOutfitPreview(p.tempOutfit, p.outfitError);

    if (flashNextSingleDate && flashNextSingleDate === dateStr) {
        const outfitEl = document.querySelector(".sd-outfit");
        if (outfitEl) {
            outfitEl.classList.add("outfit-updated-flash");
            setTimeout(() => outfitEl.classList.remove("outfit-updated-flash"), 700);
        }
        flashNextSingleDate = null;
    }

    document.getElementById("singleBtnsNew").classList.remove("d-none");
    document.getElementById("singleBtnsSaved").classList.add("d-none");
    document.querySelectorAll(".sd-delete").forEach(b => b.classList.add("d-none"));

    const canSaveSingle = Array.isArray(p.tempOutfit) && p.tempOutfit.length > 0 && !p.outfitError;
    const likeBtn = document.querySelector(".sd-like");
    likeBtn.disabled = !canSaveSingle;
    likeBtn.onclick = () => {
        if (!canSaveSingle) return;
        saveFinalOutfit(dateStr);
    };

    const dislikeBtn = document.querySelector(".sd-dislike");
    if (dislikeBtn) {
        // Always allow Dislike to retry (even if outfit had an error)
        dislikeBtn.disabled = false;
        dislikeBtn.onclick = () => regenerateSingleDay(dateStr);
    }

    bindDeleteButtons(dateStr);
}

/* ============================================================
   OPEN A SAVED SINGLE DAY
============================================================ */
function openSavedSingleDay(dateStr) {
    const p = savedPlans[dateStr];

    // Keep hidden generation inputs in sync with the saved plan.
    // Otherwise the "Regenerate" button can accidentally use a stale/default
    // occasion (e.g., Casual) even though the saved plan is Formal.
    syncInputsFromPlan(p);

    sliderContainer.classList.add("d-none");
    planInputSection.classList.add("d-none");
    singleDayContainer.classList.remove("d-none");

    document.querySelector(".sd-date").textContent = dateStr;
    document.querySelector(".sd-location").textContent = p.location;
    document.querySelector(".sd-occasion").textContent = p.occasion;
    document.querySelector(".sd-weather").textContent =
        `${p.weather}${p.temp ? ` (${p.temp}°C)` : ""}`;

    document.querySelector(".sd-outfit").innerHTML =
        renderOutfitPreview(p.outfit, null);

    document.getElementById("singleBtnsNew").classList.add("d-none");
    document.getElementById("singleBtnsSaved").classList.remove("d-none");

    document.querySelectorAll(".sd-delete").forEach(b => b.classList.remove("d-none"));

    document.querySelector(".sd-regenerate").onclick =
        () => regenerateSingleDay(dateStr);

    bindDeleteButtons(dateStr);

    planModal.show();
}

/* ============================================================
   REGENERATE = DELETE + GENERATE (CLEAN RESET)
============================================================ */
async function regenerateSingleDay(dateStr) {

    // Capture the currently shown outfit ids BEFORE we clear any state.
    // Otherwise `exclude_ids` becomes empty and the backend can return the same outfit again.
    const prevIds = getNumericOutfitIds(getCurrentOutfitForDate(dateStr));

    // UX: show a spinner so the user can see regeneration is happening
    try {
        const dislikeBtn = document.querySelector(".sd-dislike");
        const likeBtn = document.querySelector(".sd-like");
        if (dislikeBtn) dislikeBtn.disabled = true;
        if (likeBtn) likeBtn.disabled = true;
        const outfitEl = document.querySelector(".sd-outfit");
        if (outfitEl) outfitEl.innerHTML = renderOutfitLoading("Generating a new outfit");
    } catch (e) {
        // no-op
    }

    const saved = savedPlans[dateStr];

    // Ensure regeneration uses the saved plan context (occasion/location/coords)
    // instead of whatever is currently selected in the input modal.
    syncInputsFromPlan(saved || tempPlans[dateStr]);

    // 1️⃣ If it exists in DB → delete it (same as delete button)
    if (saved?.id) {
        await fetch("/plan/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: saved.id })
        });
    }

    // 2️⃣ Remove from savedPlans → calendar unhighlights
    delete savedPlans[dateStr];
    generateCalendar();

    // 3️⃣ Treat as brand-new generation
    selectedDates = [dateStr];
    tempPlans = {};
    sliderDates = [];

    // 4️⃣ Re-generate like new, excluding the previous outfit ids for variety
    excludeIdsByDate[dateStr] = prevIds;
    flashNextSingleDate = dateStr;
    await generateSingleDay(prevIds);
}

/* ============================================================
   GENERATE MULTI-DAY — wipe temp before generating
============================================================ */
async function generateMultiDay() {

    slider.innerHTML = "";
    sliderDots.innerHTML = "";
    sliderContainer.classList.add("d-none");

    // Clear any fixed height from a previous run before we show loading.
    slider.style.removeProperty("height");

    tempPlans = {};
    sliderDates = [];
    currentSlideIndex = 0;
    excludeIdsByDate = {};

    // 🔥 REMOVE ANY OLD TEMPORARY DATA
    sliderDates.forEach(d => {
        if (savedPlans[d]) {
            delete savedPlans[d].tempOutfit;
            delete savedPlans[d].outfit;
            delete savedPlans[d].weather;
            delete savedPlans[d].temp;
            delete savedPlans[d].description;
            delete savedPlans[d].missingWeather;
        }
    });

    sliderDates = [...selectedDates];
    planInputSection.classList.add("d-none");
    singleDayContainer.classList.add("d-none");
    sliderContainer.classList.remove("d-none");

    setMultiDayLoading(true);

    const results = {};
    const occasion = occasionInput.value;
    const usedAcrossDays = new Set();

    // Helper function to add delay between API calls to avoid rate limiting
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // For each day in the slider, attempt to obtain weather and then an outfit.
    for (let i = 0; i < sliderDates.length; i++) {
        const d = sliderDates[i];
        
        // Add delay between days (except for the first day) to avoid rate limiting
        if (i > 0) {
            await delay(8000); // 8 second delay to stay under rate limits
        }

        let weatherData;

        // Allow manual weather override for all generated days
        if (weatherInput.value) {
            weatherData = { weather: weatherInput.value, temp: null, description: null };
        } else {
            weatherData = await getWeatherFor(d);
        }

        let outfit = [];
        let missing = false;
        let outfitError = null;

        // If the weather API couldn't provide a forecast for this date, mark it missing
        if (weatherData.error) {
            missing = true;
        } else {
            // Call outfit-generation endpoint with lat/lon and the chosen weather
            const makeReq = async (ids, retryCount = 0) => {
                try {
                    const response = await fetch("/get_outfit/api/get_outfit", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            lat: selectedLat,
                            lon: selectedLon,
                            occasion,
                            weather: weatherData.weather,
                            temp: weatherData.temp,
                            exclude_ids: Array.isArray(ids) && ids.length ? ids : undefined
                        })
                    });
                    const data = await response.json();
                    
                    // If we hit rate limit, retry after delay
                    if (data.error && data.error.includes("rate limit") && retryCount < 3) {
                        await delay(10000); // Wait 10 seconds before retry
                        return makeReq(ids, retryCount + 1);
                    }
                    
                    return data;
                } catch (err) {
                    console.error("Error generating outfit:", err);
                    return { error: "Failed to generate outfit. Please try again." };
                }
            };

            // First try: avoid reusing items already used on earlier days.
            const excludeIds = Array.from(usedAcrossDays);
            let outfitData = await makeReq(excludeIds);

            // If the exclusion makes it impossible, fall back to allowing repeats.
            if (outfitData?.error && !outfitData.error.includes("rate limit") && excludeIds.length) {
                await delay(2000); // Small delay between attempts
                outfitData = await makeReq([]);
            }

            outfit = outfitData.outfit || [];
            outfitError = outfitData.error || null;

            // Track used items only when we successfully generated an outfit.
            if (!outfitError) {
                for (const id of getNumericOutfitIds(outfit)) {
                    usedAcrossDays.add(id);
                }
            }
        }

        // Store results for later building of tempPlans and slider
        results[d] = {
            missingWeather: missing,
            weather: weatherData.weather,
            temp: weatherData.temp,
            description: weatherData.description,
            outfit,
            outfitError
        };
    }

    sliderDates.forEach(date => {
        const r = results[date];

        tempPlans[date] = {
            date,
            location: locationInput.value,
            lat: selectedLat,
            lon: selectedLon,
            occasion,
            weather: r.weather,
            temp: r.temp,
            description: r.description,
            tempOutfit: r.outfit,
            outfitError: r.outfitError,
            missingWeather: r.missingWeather,
            id: null,
        };

        // Seed per-date exclude cache for later Dislike/regenerate.
        excludeIdsByDate[date] = getNumericOutfitIds(r.outfit);
    });

    setMultiDayLoading(false);
    buildSlider();
    openSliderOn(sliderDates[0]);
}

/* ============================================================
   BUILD SLIDER — ONLY DURING GENERATION
============================================================ */
function buildSlider() {

    slider.innerHTML = "";
    sliderDots.innerHTML = "";

    sliderDates.forEach((date, idx) => {

        const p = tempPlans[date];
        const slide = document.createElement("div");
        slide.className = "slider-slide text-center";

        if (!p) {
            slide.innerHTML = `
            <h4>${date}</h4>
            <p class="text-success fw-bold">✔ Outfit saved</p>
            <p>You can continue to the next day.</p>
        `;
            slider.appendChild(slide);
        }
        else if (p.missingWeather) {
            // When weather is missing for a date, let the user pick weather manually
            // and re-generate for just that day via `regenerateMissing`.
            slide.innerHTML = `
            <h4>${date}</h4>
            <p class="text-danger fw-bold">Weather missing. Select manually:</p>
            <select class="form-select weather-select mx-auto" style="max-width:250px;">
                <option value="">Select Weather</option>
                <option value="Clear">Clear</option>
                <option value="Clouds">Clouds</option>
                <option value="Rain">Rain</option>
                <option value="Snow">Snow</option>
            </select>
            <button class="btn btn-primary regen-btn mt-2">Generate</button>
            <div class="outfit-preview justify-content-center mt-3"></div>
        `;
            slide.querySelector(".regen-btn").onclick =
                () => regenerateMissing(date, slide);
            slider.appendChild(slide);
        }
        else if (p.outfitError) {
            // Outfit generation failed (e.g., not enough items). Allow the user to
            // change the occasion for this date and try again, without leaving the slider.
            slide.innerHTML = `
            <h4>${date}</h4>
            <p><b>Location:</b> ${escapeHtml(p.location)}</p>
            <div class="alert alert-danger mx-auto" style="max-width: 760px; white-space: pre-line; text-align: left;">
                ${escapeHtml(p.outfitError)}
            </div>
            <p class="fw-bold mb-1">Try a different occasion:</p>
            ${buildOccasionSelectHtml(p.occasion)}
            <button class="btn btn-primary regen-btn mt-2">Generate</button>
            <div class="outfit-preview justify-content-center mt-3"></div>
        `;
            slide.querySelector(".regen-btn").onclick = () => regenerateMultiDayWithOccasion(date, slide);
            slider.appendChild(slide);
        }
        else {
            // Normal generated slide: shows preview and provides Like/Dislike actions
            // Like saves this date's outfit to the backend (via saveFinalOutfit)
            // Dislike regenerates this single day (non-destructive to other days)
            const flashClass = (flashNextSliderDate && flashNextSliderDate === date) ? "outfit-updated-flash" : "";
            slide.innerHTML = `
            <h4>${date}</h4>
            <p><b>Location:</b> ${p.location}</p>
            <p><b>Occasion:</b> ${p.occasion}</p>
            ${(!p.outfitError && Array.isArray(p.tempOutfit) && p.tempOutfit.length > 0)
                ? `<p><b>Weather:</b> ${p.weather}${p.temp ? ` (${p.temp}°C)` : ""}</p>`
                : ""}
            <div class="outfit-preview justify-content-center ${flashClass}">
                ${renderOutfitPreview(p.tempOutfit, p.outfitError)}
            </div>
            <div class="text-center mt-3">
                <button class="btn btn-success likeBtn me-2">👍 Like</button>
                <button class="btn btn-danger dislikeBtn me-2">👎 Dislike</button>
            </div>
        `;
            const canSave = Array.isArray(p.tempOutfit) && p.tempOutfit.length > 0 && !p.outfitError;
            const likeButton = slide.querySelector(".likeBtn");
            likeButton.disabled = !canSave;
            likeButton.onclick = () => {
                if (!canSave) return;
                saveFinalOutfit(date);
            };
            slide.querySelector(".dislikeBtn").onclick = () => regenerateMultiDayOne(date, slide);
            slider.appendChild(slide);

            if (flashClass) {
                flashNextSliderDate = null;
            }
        }

        const dot = document.createElement("span");
        dot.className = "slider-dot";
        dot.textContent = "•";
        dot.onclick = () => {
            currentSlideIndex = idx;
            updateSliderPosition();
        };
        sliderDots.appendChild(dot);
    });


    updateSliderPosition();
    requestAnimationFrame(syncSliderHeightToActiveSlide);
}

/* ============================================================
   REGENERATE MISSING WEATHER (MULTI-DAY SLIDER)
============================================================ */
async function regenerateMissing(dateStr, slideElement) {

    // ✅ This must operate on tempPlans (ephemeral) — do NOT modify savedPlans here
    const p = tempPlans[dateStr];

    if (!p) {
        alert("Something went wrong. Please try again.");
        return;
    }

    const sel = slideElement.querySelector(".weather-select");
    const chosen = sel.value;

    if (!chosen) {
        alert("Select weather first.");
        return;
    }

    // UX: show regeneration feedback
    const preview = slideElement.querySelector(".outfit-preview");
    if (preview) preview.innerHTML = renderOutfitLoading("Generating outfit");
    const regenBtn = slideElement.querySelector(".regen-btn");
    if (regenBtn) regenBtn.disabled = true;

    // Request a fresh outfit for the manually chosen weather and update temp-only state.
    // Exclude previous items for this date and (when possible) items used on other days.
    const prevIds = getNumericOutfitIds(getCurrentOutfitForDate(dateStr));
    const otherIds = getOtherDaysOutfitIds(dateStr);
    const excludeIds = mergeExcludeIds(prevIds, otherIds);
    excludeIdsByDate[dateStr] = excludeIds;

    const makeReq = (ids) => fetch("/get_outfit/api/get_outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            lat: p.lat,
            lon: p.lon,
            occasion: p.occasion,
            weather: chosen,
            temp: null,
            exclude_ids: Array.isArray(ids) && ids.length ? ids : undefined
        })
    }).then(r => r.json());

    let outfitData = await makeReq(excludeIds);
    if (outfitData?.error && otherIds.length) {
        outfitData = await makeReq(prevIds);
    }
    if (outfitData?.error && prevIds.length) {
        outfitData = await makeReq([]);
    }

    // ✅ Update TEMP plan only
    p.weather = chosen;
    p.tempOutfit = outfitData.outfit || [];
    p.outfitError = outfitData.error || null;
    p.missingWeather = false;

    // 🔄 Rebuild slider UI and remain on the same date so the user can review
    flashNextSliderDate = dateStr;
    buildSlider();
    openSliderOn(dateStr);
}

/* ============================================================
   REGENERATE ONE SLIDER DAY
============================================================ */
async function regenerateMultiDayOne(dateStr, slideElement) {

    // Support both generation-session slides (tempPlans) and saved plans.
    const p = tempPlans[dateStr] || savedPlans[dateStr];
    if (!p) {
        alert("Something went wrong. Please try again.");
        return;
    }

    // UX: show spinner + disable buttons so it's obvious something changed
    const host = slideElement || slider.children[currentSlideIndex];
    if (host) {
        const preview = host.querySelector(".outfit-preview");
        if (preview) preview.innerHTML = renderOutfitLoading("Generating a new outfit");
        const likeBtn = host.querySelector(".likeBtn");
        const dislikeBtn = host.querySelector(".dislikeBtn");
        if (likeBtn) likeBtn.disabled = true;
        if (dislikeBtn) dislikeBtn.disabled = true;
    }

    // Exclude the previously shown items for this date and, if possible, avoid
    // items used on other days in this slider.
    const prevIds = getNumericOutfitIds(getCurrentOutfitForDate(dateStr));
    const otherIds = getOtherDaysOutfitIds(dateStr);
    const excludeIds = mergeExcludeIds(prevIds, otherIds);
    excludeIdsByDate[dateStr] = excludeIds;

    const makeReq = (ids) => fetch("/get_outfit/api/get_outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            lat: p.lat,
            lon: p.lon,
            occasion: p.occasion,
            weather: p.weather,
            temp: p.temp,
            exclude_ids: Array.isArray(ids) && ids.length ? ids : undefined
        })
    }).then(r => r.json());

    let outfitData = await makeReq(excludeIds);
    if (outfitData?.error && otherIds.length) {
        outfitData = await makeReq(prevIds);
    }
    if (outfitData?.error && prevIds.length) {
        outfitData = await makeReq([]);
    }

    // Apply regenerated outfit to the tempOutfit field so UI reflects the change
    p.tempOutfit = outfitData.outfit || [];
    p.outfitError = outfitData.error || null;

    // Update last shown ids after regeneration
    excludeIdsByDate[dateStr] = getNumericOutfitIds(p.tempOutfit);

    flashNextSliderDate = dateStr;
    buildSlider();
    openSliderOn(dateStr);
}

/* ============================================================
   OPEN SLIDER ON SPECIFIC DATE (GEN ONLY)
============================================================ */
function openSliderOn(dateStr) {
    currentSlideIndex = sliderDates.indexOf(dateStr);
    updateSliderPosition();
}

function syncSliderHeightToActiveSlide() {
    try {
        const active = slider && slider.children ? slider.children[currentSlideIndex] : null;
        if (!active) return;
        // Use offsetHeight to include padding. This keeps the modal compact
        // even if other (off-screen) slides are taller.
        const h = active.offsetHeight;
        if (h && Number.isFinite(h)) {
            slider.style.height = `${h}px`;
        }
    } catch (e) {
        // no-op
    }
}

/* ============================================================
   UPDATE SLIDER POSITION
============================================================ */
function updateSliderPosition() {

    // Ensure any open native dropdowns are closed when switching slides
    closeAllNativeSelects();

    slider.style.transform = `translateX(-${currentSlideIndex * 100}%)`;

    // After moving slides, resize the slider to match the active slide.
    requestAnimationFrame(syncSliderHeightToActiveSlide);

    [...sliderDots.children].forEach((dot, i) => {
        dot.style.color = (i === currentSlideIndex) ? "black" : "#bbb";
    });

    // Aggressively hide selects on non-active slides to prevent native dropdowns from lingering
    const slides = slider ? Array.from(slider.children) : [];
    const active = slides[currentSlideIndex];
    slides.forEach(slide => {
        const selects = slide.querySelectorAll("select");
        selects.forEach(sel => {
            const isActive = slide === active;
            sel.disabled = !isActive;
            sel.style.visibility = isActive ? "visible" : "hidden";
        });
    });
    // Restore active selects on the next frame so they remain usable
    requestAnimationFrame(() => {
        if (active) {
            active.querySelectorAll("select").forEach(sel => {
                sel.disabled = false;
                sel.style.visibility = "visible";
            });
        }
    });
}

// Keep height correct when the viewport changes (responsive modal sizing)
window.addEventListener("resize", () => {
    requestAnimationFrame(syncSliderHeightToActiveSlide);
});

// Close any open native selects before moving slides to avoid dropdowns staying on screen
function closeAllNativeSelects() {
    const selList = planModalEl
        ? Array.from(planModalEl.querySelectorAll("select"))
        : Array.from(document.querySelectorAll("select"));

    // Temporarily disable selects to force-close any open native dropdown, then re-enable.
    selList.forEach(sel => {
        sel.blur();
        sel.disabled = true;
    });

    // Re-enable on next frame to keep the UI usable.
    requestAnimationFrame(() => {
        selList.forEach(sel => {
            sel.disabled = false;
        });
    });

    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) {
        document.activeElement.blur();
    }

    // Shift focus to the modal container to fully dismiss native dropdown UI
    if (planModalEl && planModalEl.focus) {
        planModalEl.focus({ preventScroll: true });
    }
}

prevSlideBtn.onclick = () => {
    closeAllNativeSelects();
    if (currentSlideIndex > 0) {
        currentSlideIndex--;
        updateSliderPosition();
    }
};

nextSlideBtn.onclick = () => {
    closeAllNativeSelects();
    if (currentSlideIndex < sliderDates.length - 1) {
        currentSlideIndex++;
        updateSliderPosition();
    }
};

/* ============================================================
   SAVE OUTFIT (SINGLE OR MULTI)
============================================================ */
async function saveFinalOutfit(dateStr) {

    const p = tempPlans[dateStr];
    const finalOutfit = p.tempOutfit;

    // ---------- CREATE PLAN IF NEEDED ----------
    // If the server hasn't created a plan entry yet, create one first
    if (!p.id) {
        const res = await fetch("/plan/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                start: dateStr,
                end: dateStr,
                location: p.location,
                lat: p.lat,
                lon: p.lon,
                occasion: p.occasion,
                weather: p.weather,
                temp: p.temp,
                description: p.description
            })
        });

        // The create endpoint returns an array of created plan objects (hence created[0].id)
        const created = await res.json();
        p.id = created[0].id;
    }

    // Save the outfit to the plan record
    await fetch("/plan/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            id: p.id,
            outfit: finalOutfit
        })
    });

    // 🔥 Move the plan from temp -> saved and update the calendar so the day shows as persisted
    savedPlans[dateStr] = {
        ...p,
        outfit: finalOutfit
    };

    // 🔥 Remove temporary entry and refresh calendar UI
    delete tempPlans[dateStr];

    generateCalendar();

    /* =====================================================
       MULTI-DAY SLIDER LOGIC
    ===================================================== */
    if (sliderDates.length > 1) {

        if (currentSlideIndex < sliderDates.length - 1) {
            currentSlideIndex++;
            updateSliderPosition();
            return;
        }

        alert("Trip saved!");
        planModal.hide();
        return;
    }

    /* =====================================================
       SINGLE DAY LOGIC
    ===================================================== */
    alert("Saved!");
    planModal.hide();

}

/* ============================================================
   DELETE ONE DAY
============================================================ */
async function deletePlan(dateStr) {
    const p = savedPlans[dateStr];

    if (p?.id) {
        await fetch("/plan/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: p.id })
        });
    }

    delete savedPlans[dateStr];

    alert("Deleted.");
    planModal.hide();
    loadSavedPlans();
}

function bindDeleteButtons(dateStr) {
    document.querySelectorAll(".sd-delete").forEach(btn => {
        btn.onclick = () => deletePlan(dateStr);
    });
}

/* ============================================================
   ON MODAL CLOSE → CLEAN ALL TEMPORARY UNSAVED DATA
============================================================ */
document.getElementById("planModal").addEventListener("hidden.bs.modal", () => {

    // 🔥 Only clear UNSAVED temporary data — this prevents losing persisted plans
    tempPlans = {};

    // 🔥 Do NOT modify `savedPlans` here — backend is the truth of persisted plans
    // 🔥 Avoid forcing a full reload; saved operations already kept the UI in sync

    selectedDates = [];
    sliderDates = [];
    currentSlideIndex = 0;

    // Reset exclusions for a fresh session next time
    excludeIdsByDate = {};
});


