// Load and render outfit history cards
async function loadHistory() {
  try {
    const res = await fetch("/outfit_history/data");
    const history = await res.json();

    const grid = document.getElementById("history-grid") || document.querySelector(".history-items-section .row");
    const empty = document.getElementById("empty-state") || document.querySelector(".empty-state");

    if (!grid) return;
    grid.innerHTML = "";

    if (!Array.isArray(history) || history.length === 0) {
      if (empty) empty.classList.remove("d-none");
      return;
    }
    if (empty) empty.classList.add("d-none");

    const occasionEmoji = {
      Casual: "👕",
      Formal: "👔",
      Party: "🎉",
      Gym: "🏋️",
      Rainy: "☔",
    };

    const roleOrder = { top: 1, onepiece: 2, bottom: 3, outer: 4, shoes: 5 };

    const escapeHtml = (value) => {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    const stripLeadingEmoji = (text) => {
      const s = String(text ?? "").trim();
      // Remove leading emoji/symbols until the first alphanumeric character.
      return s.replace(/^[^A-Za-z0-9]+\s*/, "");
    };

    const formatItemLabel = (it) => {
      if (typeof it === "string") {
        return stripLeadingEmoji(it);
      }

      const nameRaw = it?.name || it?.role || "";
      const name = stripLeadingEmoji(nameRaw);
      const color = String(it?.color || "").trim();

      if (!name) return "";
      if (!color) return name;

      const lowerName = name.toLowerCase();
      const lowerColor = color.toLowerCase();
      if (lowerName.startsWith(lowerColor + " ")) return name;

      return `${color} ${name}`;
    };

    const formatOutfitText = (entry) => {
      if (!Array.isArray(entry?.outfit)) return entry?.outfit || "";

      const items = entry.outfit
        .slice()
        .sort((a, b) => {
          const ra = typeof a === "object" && a ? String(a.role || "").toLowerCase() : "";
          const rb = typeof b === "object" && b ? String(b.role || "").toLowerCase() : "";
          return (roleOrder[ra] || 99) - (roleOrder[rb] || 99);
        })
        .map(formatItemLabel)
        .filter(Boolean);

      return items.join(", ");
    };

    history.forEach((entry) => {
      const outfitText = formatOutfitText(entry);
      const occ = String(entry.occasion || "—");
      const occIcon = occasionEmoji[occ] || "✨";
      const weatherText = entry.weather ? ` • ${entry.weather}` : "";

      grid.insertAdjacentHTML(
        "beforeend",
        `
        <div class="col-md-4">
          <div class="history-item-card">
            <div class="history-item-body">
              <div class="history-item-date">
                ${escapeHtml(entry.date || "")} • ${escapeHtml(entry.location || "")}${escapeHtml(weatherText)}
              </div>
              <div class="history-item-outfit">${escapeHtml(outfitText)}</div>
              <div class="history-item-meta">Occasion: ${escapeHtml(occIcon)} ${escapeHtml(occ)}</div>
            </div>
            <div class="history-item-footer">
              <button class="history-item-btn" data-id="${escapeHtml(entry.id)}">Remove</button>
            </div>
          </div>
        </div>
        `
      );
    });

    // attach click handlers for remove buttons
    const removeButtons = grid.querySelectorAll(".history-item-btn");
    removeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        deleteHistoryEntry(id);
      });
    });
  } catch (e) {
    console.error("Failed to load history:", e);
  }
}

// Call API to delete one history entry
async function deleteHistoryEntry(id) {
  try {
    const res = await fetch(`/outfit_history/api/delete/${id}`, {
      method: "DELETE",
    });

    const data = await res.json();

    if (!data.ok) {
      console.error("Failed to delete history entry");
      return;
    }

    // reload list after delete
    await loadHistory();
  } catch (e) {
    console.error("Failed to delete history entry:", e);
  }
}

// Init on DOM ready
document.addEventListener("DOMContentLoaded", loadHistory);
