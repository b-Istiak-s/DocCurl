export function createAuthRequiredMiddleware({ authEnabled, isAuthenticated }) {
  return (req, res, next) => {
    if (!authEnabled) {
      return next();
    }

    if (req.path === "/auth/status" || req.path === "/auth/login" || req.path === "/auth/logout") {
      return next();
    }

    if (!isAuthenticated(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return next();
  };
}
