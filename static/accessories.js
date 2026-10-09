/*
  static/accessories.js

  Handles the Accessories page UI:
  - Loads accessories from the backend and renders the grid
  - Provides simple client-side filtering by type
  - Adds and removes accessories via API calls

*/

document.addEventListener("DOMContentLoaded", () => {
    const grid = document.getElementById("accessories-grid");
    const empty = document.getElementById("empty-accessories");
    const form = document.getElementById("addAccessoryForm");
    const editForm = document.getElementById("editAccessoryForm");

    // Track current filter so edits/deletes keep the same view
    let currentFilter = "all";

    // Load accessories from server and render them.
    // - `filter` is a type string (or "all") used to show a subset.
    async function loadAccessories(filter = "all") {
        currentFilter = filter;
        // `credentials: 'include'` ensures session cookie is sent with the request.
        const res = await fetch("/accessories/api/accessories", { credentials: "include" });
        const accessories = await res.json(); // parse JSON response into array

        // Filter client-side for simplicity (server returns all accessories)
        let filtered = filter === "all" ? accessories : accessories.filter(a => a.type === filter);

        // Clear the grid before re-rendering
        grid.innerHTML = "";

        // Show empty state if nothing to display
        if (filtered.length === 0) {
            empty.style.display = "block";
            return;
        }
        empty.style.display = "none";

        // Render each accessory as a card
        filtered.forEach(acc => {
            const card = document.createElement("div");
            card.className = "col-md-4";

            // Simple mapping from type → emoji icon for a friendly UI
            let icons = {
                "Jewellery": "📿",
                "Purse": "👜",
                "Hat": "🎩",
                "Utility": "☂️",
                "Belt": "🧷",
                "Watch": "⌚",
                "Scarf": "🧣",
                "Sunglasses": "🕶️"
            };

            const icon = icons[acc.type] || "👜"; // default icon fallback

            card.innerHTML = `
                <div class="wardrobe-item-card">
                    <div class="wardrobe-item-image">${icon}</div>
                    <div class="wardrobe-item-title">${acc.name}</div>
                    <div class="wardrobe-item-meta">${acc.type}</div>
                    <div class="d-flex gap-2 mt-2 wardrobe-item-actions">
                        <button class="wardrobe-item-btn js-edit" data-id="${acc._id}">Edit</button>
                        <button class="wardrobe-item-btn js-remove" data-id="${acc._id}">Remove</button>
                    </div>
                </div>
            `;

            // Edit handler opens modal and pre-fills fields
            card.querySelector(".js-edit").addEventListener("click", () => {
                const modalEl = document.getElementById("editAccessoryModal");
                if (!modalEl) return;

                document.getElementById("editAccId").value = acc._id;
                document.getElementById("editAccName").value = acc.name || "";
                document.getElementById("editAccType").value = acc.type || "Jewellery";

                const modal = new bootstrap.Modal(modalEl);
                modal.show();
            });

            // Delete handler
            card.querySelector(".js-remove").addEventListener("click", async () => {
                await fetch(`/accessories/api/accessories/${acc._id}`, {
                    method: "DELETE",
                    credentials: "include"
                });
                loadAccessories(currentFilter);
            });

            grid.appendChild(card);
        });
    }

    // Filters: toggle active chip and reload with selected filter
    document.querySelectorAll(".filter-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            // Remove the active class from the currently active chip
            const active = document.querySelector(".filter-chip.filter-active");
            if (active) active.classList.remove("filter-active");

            // Mark clicked chip as active and load with its filter
            btn.classList.add("filter-active");
            loadAccessories(btn.dataset.filter);
        });
    });

    // Add accessory form submission
    form.addEventListener("submit", async e => {
        e.preventDefault(); // prevent full page submit

        const name = document.getElementById("accName").value;
        const type = document.getElementById("accType").value;

        // POST new accessory as JSON; server adds it to DB and returns created item
        await fetch("/accessories/api/accessories", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, type })
        });

        // Close modal (Bootstrap) and reset the form
        const modal = document.getElementById("addAccessoryModal");
        if (bootstrap.Modal.getInstance(modal)) {
            bootstrap.Modal.getInstance(modal).hide();
        }
        form.reset();

        // Refresh the list to show the new accessory
        loadAccessories(currentFilter);
    });

    // Edit accessory submission
    if (editForm) {
        editForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const id = document.getElementById("editAccId").value;
            const name = document.getElementById("editAccName").value;
            const type = document.getElementById("editAccType").value;

            if (!id) return;

            await fetch(`/accessories/api/accessories/${id}`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, type })
            });

            const modal = document.getElementById("editAccessoryModal");
            if (modal && bootstrap.Modal.getInstance(modal)) {
                bootstrap.Modal.getInstance(modal).hide();
            }

            loadAccessories(currentFilter);
        });
    }

    // Initial load
    loadAccessories();
});
