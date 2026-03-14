export function createAuthController({ authModal, authForm, authPasswordInput, authError }) {
  function showAuthModal(message = "") {
    if (!authModal) {
      return;
    }

    authModal.hidden = false;
    authModal.classList.add("is-open");
    document.body.classList.add("auth-locked");
    if (authError) {
      authError.textContent = message;
    }
    if (authPasswordInput) {
      authPasswordInput.value = "";
      requestAnimationFrame(() => authPasswordInput.focus());
    }
  }

  function hideAuthModal() {
    if (!authModal) {
      return;
    }

    authModal.classList.remove("is-open");
    authModal.hidden = true;
    document.body.classList.remove("auth-locked");
    if (authError) {
      authError.textContent = "";
    }
  }

  function handleUnauthorized() {
    showAuthModal("Session expired. Enter password to continue.");
  }

  function bindSubmit({ apiFetch, parseJsonSafe, withBasePath, onAuthorized }) {
    if (!authForm) {
      return;
    }

    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = authPasswordInput ? authPasswordInput.value : "";

      try {
        const response = await apiFetch(
          withBasePath("/api/auth/login"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          },
          { allowUnauthorized: true },
        );

        const data = await parseJsonSafe(response);
        if (!response.ok) {
          if (authError) {
            authError.textContent = data.error || "Invalid password";
          }
          return;
        }

        hideAuthModal();
        await onAuthorized();
      } catch (error) {
        if (authError) {
          authError.textContent = "Unable to verify password. Try again.";
        }
        console.error("Authentication error:", error);
      }
    });
  }

  return {
    showAuthModal,
    hideAuthModal,
    handleUnauthorized,
    bindSubmit,
  };
}
