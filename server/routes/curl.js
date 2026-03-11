import { setupCurlRoutes } from "../../engine/index.js";

export function registerCurlRoutes(app, options = {}) {
  setupCurlRoutes(app, options);
}
