import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerRuntimeModelsRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { jsonResponse, resolveRuntimeModelsService } = api;

  app.get("/api/runtime/models", async (c) => {
    return jsonResponse(c, await resolveRuntimeModelsService(options).loadRuntimeModels());
  });
}
