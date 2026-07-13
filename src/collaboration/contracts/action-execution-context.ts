import type { ChannelTopicServices } from "../../channel-topics/services/channel-topic-service.js";
import type { CompanyGovernanceServices } from "../../governance/services/company-governance-services.js";
import type { OperatingLogService } from "../../operating-log/operating-log-service.js";
import type { WorkService } from "../../work/work-service.js";

export interface OperatingLogActionServices {
  operatingLogService: Pick<OperatingLogService, "recordEvent">;
}

export interface WorkActionServices {
  workService: Pick<
    WorkService,
    "createWork" | "moveWorkRun"
  >;
  validateEmployeeId?: (employeeId: string) => Promise<boolean> | boolean;
}

export interface ActionExecutionContext {
  channelTopics?: ChannelTopicServices;
  governance?: CompanyGovernanceServices;
  work?: WorkActionServices;
  operatingLog?: OperatingLogActionServices;
}
