// static/profile.js

// Colors used for avatar backgrounds
const avatarColors = ["#6366F1", "#EC4899", "#F59E0B", "#10B981", "#3B82F6"];

// Returns initials from full name
function getInitials(fullName) {
  if (!fullName) return "?";
  const trimmed = fullName.trim();
  if (!trimmed) return "?";

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Picks stable color based on name hash
function pickColorFromName(name) {
  if (!name) return avatarColors[0];

  let sum = 0;
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i);
  }
  return avatarColors[sum % avatarColors.length];
}

// Updates avatar circle UI and name display
function updateProfileAvatar() {
  const firstNameInput = document.getElementById("firstName");
  const lastNameInput = document.getElementById("lastName");
  const fullNameInput = document.getElementById("fullName");
  const avatarEl = document.getElementById("profileAvatar");
  const nameDisplayEl = document.getElementById("profileNameDisplay");

  // If something is really missing - just exit silently
  if (!firstNameInput || !lastNameInput || !fullNameInput || !avatarEl) {
    return;
  }

  const first = firstNameInput.value || "";
  const last = lastNameInput.value || "";
  const fullName = `${first} ${last}`.trim();

  // Sync full name readonly field
  fullNameInput.value = fullName;

  // Update avatar text and color
  const initials = getInitials(fullName || "User");
  const color = pickColorFromName(fullName || "User");

  avatarEl.textContent = initials;
  avatarEl.style.backgroundColor = color;

  // Update name in header
  if (nameDisplayEl) {
    nameDisplayEl.textContent = fullName || "Your Name";
  }
}

// Handles profile form submit
async function handleProfileSubmit(event) {
  event.preventDefault();

  const firstNameInput = document.getElementById("firstName");
  const lastNameInput = document.getElementById("lastName");
  const genderSelect = document.getElementById("gender");
  const ageInput = document.getElementById("age");
  const daysUntilDirtyInput = document.getElementById("daysUntilDirty");
  const passwordInput = document.getElementById("password");
  const confirmPasswordInput = document.getElementById("confirmPassword");

  // Minimal sanity check
  if (!firstNameInput || !lastNameInput || !genderSelect || !ageInput || !daysUntilDirtyInput) {
    alert("Profile form is not configured correctly.");
    return;
  }

  const firstName = firstNameInput.value.trim();
  const lastName = lastNameInput.value.trim();
  const gender = genderSelect.value;
  const ageRaw = ageInput.value;
  const daysRaw = daysUntilDirtyInput.value;
  const password = passwordInput ? passwordInput.value : "";
  const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : "";

  // Simple password check on frontend
  if (password || confirmPassword) {
    if (password !== confirmPassword) {
      alert("Password and password confirmation do not match.");
      return;
    }
  }

  const payload = {
    first_name: firstName,
    last_name: lastName,
    gender: gender || "",
    age: ageRaw ? Number(ageRaw) : null,
    days_until_dirty: daysRaw ? Number(daysRaw) : null,
  };

  if (password && confirmPassword) {
    payload.password = password;
    payload.confirm_password = confirmPassword;
  }

  try {
    const response = await fetch("/profile/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      const message = (result && result.message) || "Failed to update profile.";
      alert(message);
      return;
    }

    // Clear password fields after successful update
    if (passwordInput) passwordInput.value = "";
    if (confirmPasswordInput) confirmPasswordInput.value = "";

    // Refresh avatar and name display with new data
    updateProfileAvatar();

    alert("Profile updated successfully.");
  } catch (error) {
    console.error("Error updating profile:", error);
    alert("Error updating profile. Please try again.");
  }
}

// Init on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  // Initial avatar render
  updateProfileAvatar();

  const firstNameInput = document.getElementById("firstName");
  const lastNameInput = document.getElementById("lastName");

  if (firstNameInput) firstNameInput.addEventListener("input", updateProfileAvatar);
  if (lastNameInput) lastNameInput.addEventListener("input", updateProfileAvatar);

  const form = document.getElementById("profileForm") || document.querySelector("form");
  if (form) {
    form.addEventListener("submit", handleProfileSubmit);
  }
});
