import { inferBasePathFromPathname, createWithBasePath } from "./base-path.js";
import { createApiClient } from "./api.js";
import { createAuthController } from "./auth.js";
import { createEnvManager } from "./env.js";
import { createPlaygroundSystem } from "./playground.js";
import { createDocsTreeSystem } from "./tree.js";

export async function bootstrapApp() {
  const docList = document.getElementById("docList");
  const docContent = document.getElementById("docContent");
  const mobileMenuButton = document.getElementById("mobileMenuButton");
  const mobileResetButton = document.getElementById("mobileResetButton");
  const sidebarCloseButton = document.getElementById("sidebarCloseButton");
  const sidebarResetButton = document.getElementById("sidebarResetButton");
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");
  const fullscreenModal = document.getElementById("fullscreenModal");
  const fullscreenMount = document.getElementById("fullscreenMount");
  const fullscreenCloseButton = document.getElementById(
    "fullscreenCloseButton",
  );
  const authModal = document.getElementById("authModal");
  const authForm = document.getElementById("authForm");
  const authPasswordInput = document.getElementById("authPasswordInput");
  const authError = document.getElementById("authError");

  let authEnabled = false;
  let featureFlags = {
    contentCollapse: false,
  };

  function setSidebarOpen(isOpen) {
    document.body.classList.toggle("sidebar-open", isOpen);
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function openSidebar() {
    setSidebarOpen(true);
  }

  const docsBasePath = inferBasePathFromPathname(window.location.pathname);
  const withBasePath = createWithBasePath(docsBasePath);
  const authController = createAuthController({
    authModal,
    authForm,
    authPasswordInput,
    authError,
  });

  const apiClient = createApiClient({
    withBasePath,
    getAuthEnabled: () => authEnabled,
    onUnauthorized: authController.handleUnauthorized,
  });

  const envManager = createEnvManager({});

  const playgroundSystem = createPlaygroundSystem({
    docContent,
    fullscreenModal,
    fullscreenMount,
    apiFetch: apiClient.apiFetch,
    parseJsonSafe: apiClient.parseJsonSafe,
    withBasePath,
    envManager,
  });

  const docsTreeSystem = createDocsTreeSystem({
    docList,
    docContent,
    apiFetch: apiClient.apiFetch,
    parseJsonSafe: apiClient.parseJsonSafe,
    withBasePath,
    envManager,
    playgroundSystem,
    closeSidebar,
    getFeatures: () => featureFlags,
  });

  authController.bindSubmit({
    apiFetch: apiClient.apiFetch,
    parseJsonSafe: apiClient.parseJsonSafe,
    withBasePath,
    onAuthorized: docsTreeSystem.loadDocsTree,
  });

  mobileMenuButton.addEventListener("click", () => {
    if (document.body.classList.contains("sidebar-open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  [mobileResetButton, sidebarResetButton].forEach((button) => {
    button.addEventListener("click", () => {
      playgroundSystem.resetAllDocuments();
    });
  });

  sidebarCloseButton.addEventListener("click", closeSidebar);
  sidebarBackdrop.addEventListener("click", closeSidebar);

  fullscreenCloseButton.addEventListener(
    "click",
    playgroundSystem.closeFullscreen,
  );
  fullscreenModal.addEventListener("click", (event) => {
    if (event.target === fullscreenModal) {
      playgroundSystem.closeFullscreen();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!authModal.hidden) {
        return;
      }
      if (playgroundSystem.hasFullscreenOpen()) {
        playgroundSystem.closeFullscreen();
        return;
      }
      if (document.body.classList.contains("sidebar-open")) {
        closeSidebar();
      }
    }
  });

  try {
    const status = await apiClient.fetchAuthStatus();
    authEnabled = Boolean(status.authEnabled);
    featureFlags = {
      contentCollapse: Boolean(status.features?.contentCollapse),
    };

    if (authEnabled && !status.authenticated) {
      authController.showAuthModal("Enter password to unlock this project.");
      return;
    }

    authController.hideAuthModal();
    await docsTreeSystem.loadDocsTree();
  } catch (error) {
    docList.innerHTML = '<li class="errorText">Failed to initialize</li>';
    docContent.innerHTML =
      '<p class="errorText">Unable to initialize app. Please refresh.</p>';
    console.error("Bootstrap error:", error);
  }
}
