import type { Hono } from "hono";

import { capabilityRegistry } from "../../runtime/capabilities/capability-registry.js";
import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerCapabilitiesRoutes(app: Hono, _options: TinyOfficeApiOptions): void {
  app.get("/api/companies/:companyId/capabilities", (c) => {
    api.companyIdFromContext(c);
    return api.jsonResponse(c, {
      schema: "tinyoffice-capability-registry-view",
      version: 1,
      capabilities: capabilityRegistry.capabilities,
    });
  });
}
