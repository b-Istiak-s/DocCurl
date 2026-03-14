export function inferBasePathFromPathname(pathname) {
  const cleanPath = String(pathname || "/").split(/[?#]/, 1)[0];
  const normalized = cleanPath.replace(/\/+$/, "") || "/";

  if (normalized === "/") {
    return "";
  }

  return normalized;
}

export function createWithBasePath(basePath) {
  return (requestPath) => {
    const normalizedPath = `/${String(requestPath || "").replace(/^\/+/, "")}`;
    return `${basePath}${normalizedPath}`;
  };
}
