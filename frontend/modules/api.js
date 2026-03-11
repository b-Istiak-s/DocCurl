export function createUnauthorizedError() {
  const error = new Error("Unauthorized");
  error.code = "UNAUTHORIZED";
  return error;
}

export async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function createApiClient({ withBasePath, getAuthEnabled, onUnauthorized }) {
  async function apiFetch(url, options = {}, { allowUnauthorized = false } = {}) {
    const response = await fetch(url, options);

    if (
      getAuthEnabled() &&
      !allowUnauthorized &&
      (response.status === 401 || response.status === 403)
    ) {
      onUnauthorized();
      throw createUnauthorizedError();
    }

    return response;
  }

  async function fetchAuthStatus() {
    const response = await fetch(withBasePath("/api/auth/status"));
    if (!response.ok) {
      throw new Error("Failed to load auth status");
    }
    return parseJsonSafe(response);
  }

  return {
    apiFetch,
    fetchAuthStatus,
    parseJsonSafe,
  };
}
