// static/wardrobe.js

// Current filter state
let currentFilter = 'all';

// Icon mapping by category
function getIconByCategory(category) {
  const icons = {
    'Casual': '👕',
    'Formal': '👔',
    'Sports': '🏃',
    'Gym': '🏋️',
    'Party': '🎉',
    'Outdoor': '🥾'
  };
  return icons[category] || '👚';
}

// Create a single card element
function createCardElement(item) {
  const col = document.createElement('div');
  col.className = 'col-md-4';

  const card = document.createElement('div');
  card.className = 'wardrobe-item-card';

  const icon = document.createElement('div');
  icon.className = 'wardrobe-item-image';
  icon.textContent = item.icon || getIconByCategory(item.category);

  const title = document.createElement('div');
  title.className = 'wardrobe-item-title';
  title.textContent = item.name;

  const meta = document.createElement('div');
  meta.className = 'wardrobe-item-meta';
  const parts = [];
  if (item.category) parts.push(item.category);
  if (item.status) parts.push(item.status);
  if (item.color) parts.push(item.color);
  meta.textContent = parts.join(' • ');

  // Button row container
  const btnRow = document.createElement('div');
  btnRow.className = 'd-flex gap-2 mt-2 wardrobe-item-actions';

  // Toggle status button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'wardrobe-item-btn';
  toggleBtn.textContent = (item.status || '').toLowerCase() === 'clean'
    ? 'Mark as Worn'
    : 'Mark as Clean';

  toggleBtn.addEventListener('click', async () => {
    await updateItemStatus(item.id);
  });

  // Edit button
  const editBtn = document.createElement('button');
  editBtn.className = 'wardrobe-item-btn';
  editBtn.textContent = 'Edit';

  editBtn.addEventListener('click', () => {
    // Prefill modal fields and show modal
    const modalEl = document.getElementById('editItemModal');
    if (!modalEl) return;
    
    // Clear form first
    const form = document.getElementById('editItemForm');
    if (form) form.reset();
    
    // Helper to capitalize first letter
    const capitalize = (str) => {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1);
    };
    
    // Now populate with item data
    document.getElementById('editItemId').value = item.id;
    document.getElementById('editItemName').value = item.name || '';
    document.getElementById('editItemCategory').value = item.category || '';
    document.getElementById('editItemType').value = (item.type || '').toLowerCase() || 'top';
    document.getElementById('editItemColor').value = item.color || '';
    document.getElementById('editItemStatus').value = capitalize(item.status) || 'Clean';

    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  });

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'wardrobe-item-btn';
  removeBtn.textContent = 'Remove';

  removeBtn.addEventListener('click', async () => {
    await removeItem(item.id);
  });

  // Assemble buttons row
  btnRow.appendChild(toggleBtn);
  btnRow.appendChild(editBtn);
  btnRow.appendChild(removeBtn);

  // Assemble card
  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(btnRow);
  col.appendChild(card);

  return col;
}

// Load items for a given filter and render the grid
async function loadWardrobe(filter = 'all') {
  currentFilter = filter;

  const grid = document.getElementById('wardrobe-grid');
  const empty = document.getElementById('empty-state');
  
  if (!grid) return;

  // Clear grid
  grid.innerHTML = '';

  try {
    const res = await fetch(`/wardrobe/data?filter=${encodeURIComponent(filter)}`);
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const items = await res.json();

    if (!items || items.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }

    if (empty) empty.style.display = 'none';

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      fragment.appendChild(createCardElement(item));
    });
    
    grid.appendChild(fragment);
    
  } catch (error) {
    console.error('Failed to load wardrobe:', error);
    if (empty) {
      empty.querySelector('.empty-state-desc').textContent = 'Failed to load items. Please try again.';
      empty.style.display = '';
    }
  }
}

// Toggle status and reload with the same filter
async function updateItemStatus(id) {
  try {
    const res = await fetch('/wardrobe/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    await loadWardrobe(currentFilter);
    
  } catch (error) {
    console.error('Failed to update item status:', error);
    alert('Failed to update item. Please try again.');
  }
}

// Remove item and reload with the same filter
async function removeItem(id) {
  try {
    const res = await fetch(`/wardrobe/api/items/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    await loadWardrobe(currentFilter);
  } catch (error) {
    console.error('Failed to remove item:', error);
    alert('Failed to remove item. Please try again.');
  }
}

// Setup filter chips
function setupFilters() {
  const chips = document.querySelectorAll('.filter-chip');
  
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      // Remove active class from all chips
      chips.forEach(c => c.classList.remove('filter-active'));
      
      // Add active class to clicked chip
      chip.classList.add('filter-active');

      const filter = chip.dataset.filter || 'all';
      loadWardrobe(filter);
    });
  });
}

// Add Item form via fetch
function setupAddForm() {
  const form = document.getElementById('addItemForm');
  const modalEl = document.getElementById('addItemModal');

  if (!form || !modalEl) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous server error
    const errorEl = document.getElementById('addItemError');
    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }

    // Client-side validity check
    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }

    const formData = new FormData(form);
    
    // Disable submit button to prevent double submission
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';

    try {
      const res = await fetch('/wardrobe/add-item', {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) {
        // Try to parse JSON error from server
        let errMsg = `HTTP error! status: ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson && errJson.error) errMsg = errJson.error;
        } catch (parseErr) {
          // ignore JSON parse errors
        }

        // Show server validation message inline and re-enable submit button
        if (errorEl) {
          errorEl.textContent = errMsg;
          errorEl.style.display = '';
        } else {
          alert(errMsg);
        }

        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
      }

      // Get modal instance
      const modal = bootstrap.Modal.getInstance(modalEl);
      
      if (modal) {
        // Close modal
        modal.hide();
        
        // Reset form after modal is hidden
        modalEl.addEventListener('hidden.bs.modal', function cleanup() {
          form.reset();
          form.classList.remove('was-validated');
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          modalEl.removeEventListener('hidden.bs.modal', cleanup);
        }, { once: true });
      } else {
        // Fallback if no instance
        form.reset();
        form.classList.remove('was-validated');
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }

      // Reload wardrobe with current filter
      await loadWardrobe(currentFilter);
      
    } catch (error) {
      console.error('Failed to add item:', error);

      if (errorEl) {
        errorEl.textContent = 'Failed to add item. Please try again.';
        errorEl.style.display = '';
      } else {
        alert('Failed to add item. Please try again.');
      }
      
      // Re-enable button on error
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// Setup edit form submission handler
function setupEditForm() {
  const form = document.getElementById('editItemForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('editItemId').value;
    const payload = {
      id: id,
      name: document.getElementById('editItemName').value,
      category: document.getElementById('editItemCategory').value,
      type: document.getElementById('editItemType').value,
      color: document.getElementById('editItemColor').value,
      status: document.getElementById('editItemStatus').value
    };

    try {
      const res = await fetch('/wardrobe/edit-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to update item');
        return;
      }

      // Close modal and reload wardrobe
      const modalEl = document.getElementById('editItemModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
      
      // Reload wardrobe to show updated item
      await loadWardrobe(currentFilter);
    } catch (err) {
      console.error('Failed to update item:', err);
      alert('Failed to update item. Please try again.');
    }
  });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setupFilters();
  setupAddForm();
  setupEditForm();
  loadWardrobe('all');
});