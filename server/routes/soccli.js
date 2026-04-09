import { setupSoccliRoutes } from "../../engine/index.js";

export function registerSoccliRoutes(app, options = {}) {
  setupSoccliRoutes(app, options);
}
