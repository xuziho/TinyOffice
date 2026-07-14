import { Hono } from "hono";

import { bindAuthenticatedRequest, TinyOfficeAuthenticationError } from "../auth/tinyoffice-session.js";
import { jsonError } from "./http.js";
import { registerAccessRoutes } from "./tinyoffice-api/access-routes.js";
import { registerAuthenticationRoutes } from "./tinyoffice-api/authentication-routes.js";
import { registerAttachmentRoutes } from "./tinyoffice-api/attachment-routes.js";
import { registerChatRoutes } from "./tinyoffice-api/chat-routes.js";
import { registerCapabilitiesRoutes } from "./tinyoffice-api/capabilities-routes.js";
import { registerBrandingRoutes } from "./tinyoffice-api/branding-routes.js";
import { registerBackupRoutes } from "./tinyoffice-api/backup-routes.js";
import { registerProfileRoutes } from "./tinyoffice-api/profile-routes.js";
import { registerCompanyRoutes } from "./tinyoffice-api/company-routes.js";
import { registerDirectoryRoutes } from "./tinyoffice-api/directory-routes.js";
import { registerDoctorRoutes } from "./tinyoffice-api/doctor-routes.js";
import { registerEmployeeRuntimeSummaryRoutes } from "./tinyoffice-api/employee-runtime-summary-routes.js";
import { registerIntakeRoutes } from "./tinyoffice-api/intake-routes.js";
import { registerMemberRuntimeRoutes } from "./tinyoffice-api/member-runtime-routes.js";
import { registerMemberDirectoryRoutes } from "./tinyoffice-api/member-directory-routes.js";
import { registerPromptPolicyRoutes } from "./tinyoffice-api/prompt-policy-routes.js";
import { registerRecruitmentRoutes } from "./tinyoffice-api/recruitment-routes.js";
import { registerRuntimeModelsRoutes } from "./tinyoffice-api/runtime-models-routes.js";
import { registerSessionRoutes } from "./tinyoffice-api/session-routes.js";
import { registerSessionsRoutes } from "./tinyoffice-api/sessions-routes.js";
import { registerTasksRoutes } from "./tinyoffice-api/tasks-routes.js";
import { registerUpdateRoutes } from "./tinyoffice-api/update-routes.js";
import { registerWorkRoutes } from "./tinyoffice-api/work-routes.js";
import type { TinyOfficeApiOptions } from "./tinyoffice-api/context.js";

export type {
  AccessApiService,
  AccessPreviewInput,
  ChatAttachmentApiService,
  CompanyLifecycleApiService,
  CompanyMemberDirectoryApiService,
  DoctorApiService,
  UpdateApiService,
  CreateCompanyInput,
  DeleteCompanyInput,
  IntakeEventApiService,
  MemberRuntimeApiService,
  MemberRuntimeReloadResult,
  MemberRuntimeSaveInput,
  RecruitmentApiService,
  RuntimeModelsApiService,
  PromptPolicyApiService,
  PromptPolicyBlockSaveInput,
  PromptPolicyTemplateSaveInput,
  SessionExplorerApiService,
  TasksRunActionApiService,
  TasksViewModelApiService,
  WorkCreationApiService,
  EmployeeRuntimeSummaryApiService,
  TinyOfficeApiOptions,
} from "./tinyoffice-api/context.js";

export function createTinyOfficeApi(options: TinyOfficeApiOptions): Hono {
  const app = new Hono();

  app.onError((error, c) => jsonError(c, error));

  registerAuthenticationRoutes(app, options);
  app.use("/api/*", async (c, next) => {
    const session = await options.auth.resolveCurrentUser(c.req.raw);
    if (!session) {
      throw new TinyOfficeAuthenticationError();
    }
    bindAuthenticatedRequest(c.req.raw, session);
    await next();
  });

  registerSessionRoutes(app, options);
  registerProfileRoutes(app, options);
  registerBackupRoutes(app, options);
  registerUpdateRoutes(app, options);
  registerCompanyRoutes(app, options);
  registerWorkRoutes(app, options);
  registerTasksRoutes(app, options);
  registerSessionsRoutes(app, options);
  registerEmployeeRuntimeSummaryRoutes(app, options);
  registerDirectoryRoutes(app, options);
  registerMemberDirectoryRoutes(app, options);
  registerMemberRuntimeRoutes(app, options);
  registerCapabilitiesRoutes(app, options);
  registerBrandingRoutes(app, options);
  registerRuntimeModelsRoutes(app, options);
  registerRecruitmentRoutes(app, options);
  registerPromptPolicyRoutes(app, options);
  registerAccessRoutes(app, options);
  registerDoctorRoutes(app, options);
  registerIntakeRoutes(app, options);
  registerAttachmentRoutes(app, options);
  registerChatRoutes(app, options);

  return app;
}
