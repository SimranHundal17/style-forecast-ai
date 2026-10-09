// Wait until the page is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  // Find the "Get Started" button on the page
  const btn = document.querySelector(".get-started-btn");

  // If button is not found, stop the script
  if (!btn) return;

  // Add click event to the button
  btn.addEventListener("click", (event) => {
    event.preventDefault(); // stop the default link behavior

    // Read the URL from the href attribute
    const targetUrl = btn.getAttribute("href");
    // Redirect the user to the login page
    window.location.href = targetUrl;
  });
});
