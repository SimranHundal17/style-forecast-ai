// ======================================================
// static/login.js — Login / Signup page client behavior
// ======================================================
// Purpose: manage the login/signup UI, validate input, and submit
// credentials to the server. Keep client validation minimal and
// rely on server-side checks for security.
document.addEventListener("DOMContentLoaded", () => {
  // Basic DOM elements
  const form = document.getElementById("loginForm");
  const title = document.querySelector(".auth-title");
  const subtitle = document.querySelector(".auth-subtitle");
  const submitBtn = document.getElementById("submitBtn");
  const footer = document.querySelector(".auth-footer");
  const successAlert = document.getElementById("loginSuccess");
  const loadingSpinner = document.getElementById("loginLoading");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");

  // Containers for signup-only fields
  const signupFields = document.getElementById("signupFields");
  const signupPasswordFields = document.getElementById("signupPasswordFields");
  const signupExtraFields = document.getElementById("signupExtraFields");

  // State: false = login mode, true = signup mode
  let isSignupMode = false;

  // ---------------------------
  // Helper functions
  // ---------------------------

  function showAlert(message, type = "success") {
    // type: success | danger | warning | info
    successAlert.textContent = message;
    successAlert.className = `alert alert-${type} text-center`;
    successAlert.classList.remove("d-none");
  }

  function hideAlert() {
    successAlert.classList.add("d-none");
  }

  // Toggle UI between loading and idle states. Disables the submit button
  // to prevent duplicate submissions and updates the label based on mode.
  function setLoading(isLoading) {
    if (isLoading) {
      loadingSpinner.classList.remove("d-none");
      submitBtn.disabled = true;
      submitBtn.textContent = isSignupMode ? "Creating Account..." : "Logging In...";
    } else {
      loadingSpinner.classList.add("d-none");
      submitBtn.disabled = false;
      submitBtn.textContent = isSignupMode ? "Sign Up" : "Login";
    }
  }

  // Toggle between login and signup modes
  function toggleForm(event) {
    if (event) event.preventDefault();

    isSignupMode = !isSignupMode;

    if (isSignupMode) {
      // Show signup-only fields
      signupFields.classList.remove("d-none");
      signupPasswordFields.classList.remove("d-none");
      signupExtraFields.classList.remove("d-none");

      title.textContent = "Create Account";
      subtitle.textContent = "Sign up for your new Style Forecast account";
      submitBtn.textContent = "Sign Up";

      footer.innerHTML =
        'Already have an account? <a href="#" class="switch-link">Login</a>';
    } else {
      // Hide signup-only fields
      signupFields.classList.add("d-none");
      signupPasswordFields.classList.add("d-none");
      signupExtraFields.classList.add("d-none");

      title.textContent = "Welcome Back";
      subtitle.textContent = "Log in to your Style Forecast account";
      submitBtn.textContent = "Login";

      footer.innerHTML =
        'Don’t have an account? <a href="#" class="switch-link">Sign Up</a>';
    }

    // Clear form and alerts
    form.reset();
    hideAlert();

    // Re-attach toggle listener to the new link
    attachToggleListener();
  }

  function attachToggleListener() {
    const switchLink = footer.querySelector(".switch-link");
    if (switchLink) {
      switchLink.addEventListener("click", toggleForm);
    }
  }

  // ---------------------------
  // Form submission handler
  // ---------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    hideAlert();
    setLoading(true);

    try {
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value.trim();

      if (!email || !password) {
        setLoading(false);
        showAlert("Please fill in email and password.", "warning");
        return;
      }

      // -----------------------------
      // SIGNUP MODE
      // -----------------------------
      if (isSignupMode) {
        const firstName = document.getElementById("first_name").value.trim();
        const lastName = document.getElementById("last_name").value.trim();
        const confirm = document
          .getElementById("confirm_password")
          .value.trim();
        const gender = document.getElementById("gender").value;
        const age = document.getElementById("age").value;
        const daysDirty = document.getElementById("days_until_dirty").value;

        if (!firstName || !lastName || !confirm || !gender || !age || !daysDirty) {
          setLoading(false);
          showAlert("Please fill in all signup fields.", "warning");
          return;
        }

        if (password !== confirm) {
          setLoading(false);
          showAlert("Passwords do not match.", "warning");
          return;
        }

        const signupData = {
          email,
          password,
          confirm_password: confirm,
          first_name: firstName,
          last_name: lastName,
          gender,
          age,
          days_until_dirty: daysDirty,
        };

        // Send JSON signup payload. Server should validate and return
        // { success: true } on success or { success: false, message } on failure.
        const response = await fetch("/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(signupData),
        });

        const data = await response.json();
        setLoading(false);

        if (data.success) {
          showAlert("🎉 Account created! You can now log in.", "success");

          // Switch back to login mode after short delay so the user can log in
          setTimeout(() => {
            toggleForm();
          }, 1500);
        } else {
          // Server-provided message is shown when available
          showAlert(data.message || "Registration failed. Please try again.", "danger");
        }

        return; // important: do NOT continue to login block
      }

      // -----------------------------
      // LOGIN MODE
      // -----------------------------
      // Post form-encoded credentials. The server typically sets a session cookie
      // or returns a token on success; the client then redirects to the protected page.
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, password }),
      });

      const data = await response.json();
      setLoading(false);

      if (data.success) {
        showAlert("✅ Login successful! Redirecting...", "success");
        setTimeout(() => {
          window.location.href = data.redirect_url || "/wardrobe";
        }, 1500);
      } else {
        showAlert(data.message || "Invalid email or password.", "danger");
      }
    } catch (err) {
      console.error("Auth error:", err);
      setLoading(false);
      showAlert("Something went wrong. Please try again.", "danger");
    }
  });

  // Expose toggleForm to window for any inline onclick links in the template.
  // This keeps the template simple (anchors can call `toggleForm()`); in a larger app
  // you'd wire events purely via JS to avoid global namespace pollution.
  window.toggleForm = toggleForm;

  // Initial listeners
  attachToggleListener();

  // Auto-focus email
  if (emailInput) {
    emailInput.focus();
  }
});
