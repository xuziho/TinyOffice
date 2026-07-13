import type { RuntimeModelsResponse } from "../../api/contracts/tinyoffice-api-contracts.js";
import type { TinyOfficeUpdateStatus } from "../../api/contracts/tinyoffice-frontend-api-contracts.js";
import type { DoctorApiService } from "../../api/tinyoffice-api/contracts.js";
import type { ToolSafetyViewModel } from "../company-config/tool-guard-admin.js";
import type { CompaniesAdminViewModel } from "../company-config/companies-admin.js";
import type { EmployeesAdminState } from "../company-config/employees-admin.js";
import {
  buildTinyOfficeDoctorReport,
  type TinyOfficeDoctorCheck,
  type TinyOfficeDoctorReport,
  type TinyOfficeDoctorSectionInput,
} from "./tinyoffice-doctor.js";

export type TinyOfficeDoctorServiceLoaders = {
  loadCompanies?: () => Promise<CompaniesAdminViewModel>;
  loadMemberRuntime?: (companyId: string) => Promise<EmployeesAdminState>;
  loadRuntimeModels?: () => Promise<RuntimeModelsResponse>;
  loadAccess?: (companyId: string) => Promise<ToolSafetyViewModel>;
  loadUpdateStatus?: () => Promise<TinyOfficeUpdateStatus>;
};

export type CreateTinyOfficeDoctorServiceInput = TinyOfficeDoctorServiceLoaders & {
  now?: () => string;
};

async function checkFromLoader(
  id: string,
  label: string,
  run: () => Promise<TinyOfficeDoctorCheck>,
): Promise<TinyOfficeDoctorCheck> {
  try {
    return await run();
  } catch (error) {
    return {
      id,
      label,
      status: "fail",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

function missingLoaderCheck(id: string, label: string): TinyOfficeDoctorCheck {
  return {
    id,
    label,
    status: "fail",
    summary: `${label} check is not configured.`,
  };
}

function employeeRuntimeCheck(state: EmployeesAdminState): TinyOfficeDoctorCheck {
  const employees = state.employees;
  const missingRuntime = employees.filter((employee) =>
    !employee.runtime.modelProvider || !employee.runtime.modelId
  );
  if (employees.length === 0) {
    return {
      id: "employees.runtime",
      label: "Employee runtime",
      status: "warn",
      summary: "No runtime-capable employees are configured.",
      action: {
        label: "Create an employee",
        href: "/employees",
      },
    };
  }
  if (missingRuntime.length > 0) {
    return {
      id: "employees.runtime",
      label: "Employee runtime",
      status: "warn",
      summary: `${missingRuntime.length} of ${employees.length} employees have no saved runtime model.`,
      details: missingRuntime.map((employee) => employee.employeeId),
      action: {
        label: "Review employees",
        href: "/employees",
      },
    };
  }
  return {
    id: "employees.runtime",
    label: "Employee runtime",
    status: "ok",
    summary: `${employees.length} runtime-capable employees are configured.`,
  };
}

function employeeAssetsCheck(state: EmployeesAdminState): TinyOfficeDoctorCheck {
  const missingInstructions = state.employees.filter((employee) =>
    !(employee.localAssets?.instructionFiles || []).some((file) => file.name === "AGENTS.md" && file.exists)
  );
  if (missingInstructions.length === 0) {
    return {
      id: "employees.instructions",
      label: "Employee instructions",
      status: "ok",
      summary: "Employee instruction files are present where configured.",
    };
  }
  return {
    id: "employees.instructions",
    label: "Employee instructions",
    status: "info",
    summary: `${missingInstructions.length} employees have no AGENTS.md yet.`,
    details: missingInstructions.map((employee) => employee.employeeId),
  };
}

function runtimeModelsCheck(models: RuntimeModelsResponse): TinyOfficeDoctorCheck {
  if (models.availableModels.length === 0) {
    return {
      id: "runtime.models",
      label: "Runtime models",
      status: "fail",
      summary: "No PI runtime models are available.",
      action: {
        label: "Configure runtime models",
        href: "/employees",
      },
    };
  }
  return {
    id: "runtime.models",
    label: "Runtime models",
    status: "ok",
    summary: `${models.availableModels.length} runtime models are available.`,
  };
}

function accessPolicyCheck(_viewModel: ToolSafetyViewModel): TinyOfficeDoctorCheck {
  return {
    id: "access.policy",
    label: "Access policy",
    status: "ok",
    summary: "Access policy loaded.",
  };
}

function runtimeCompatibilityCheck(status: TinyOfficeUpdateStatus): TinyOfficeDoctorCheck {
  return status.runtime.compatible
    ? {
      id: "runtime.node",
      label: "Node runtime compatibility",
      status: "ok",
      summary: `Node ${status.runtime.nodeVersion} satisfies the required ${status.runtime.minimumNodeVersion}.`,
    }
    : {
      id: "runtime.node",
      label: "Node runtime compatibility",
      status: "warn",
      summary: `Node ${status.runtime.nodeVersion} is installed, but ${status.runtime.minimumNodeVersion} or newer is required.`,
      action: { label: "Review updates", href: "/settings" },
    };
}

function approvalManifestCheck(status: TinyOfficeUpdateStatus): TinyOfficeDoctorCheck {
  return status.sources.approvalManifestSource === "remote"
    ? {
      id: "runtime.update-approval",
      label: "Update approval source",
      status: "ok",
      summary: "TinyOffice stable approval manifest refreshed successfully.",
    }
    : {
      id: "runtime.update-approval",
      label: "Update approval source",
      status: "warn",
      summary: "The remote stable approval manifest is unavailable; the bundled fallback is read-only guidance and cannot authorize an install.",
      details: status.sources.warnings,
      action: { label: "Review updates", href: "/settings" },
    };
}

export function createTinyOfficeDoctorService(input: CreateTinyOfficeDoctorServiceInput): DoctorApiService {
  return {
    async loadDoctorReport(companyId: string): Promise<TinyOfficeDoctorReport> {
      const companyChecks = [
        input.loadCompanies
          ? await checkFromLoader("company.record", "Company record", async () => {
            const viewModel = await input.loadCompanies!();
            const company = viewModel.companies.find((item) => item.companyId === companyId);
            return company
              ? {
                id: "company.record",
                label: "Company record",
                status: "ok",
                summary: `${company.displayName} is registered.`,
              }
              : {
                id: "company.record",
                label: "Company record",
                status: "fail",
                summary: `Company ${companyId} is not registered.`,
              };
          })
          : missingLoaderCheck("company.record", "Company record"),
      ];

      const employeeSections = input.loadMemberRuntime
        ? await (async (): Promise<TinyOfficeDoctorCheck[]> => {
          try {
            const state = await input.loadMemberRuntime!(companyId);
            return [
              employeeRuntimeCheck(state),
              employeeAssetsCheck(state),
            ];
          } catch (error) {
            return [{
              id: "employees.runtime",
              label: "Employee runtime",
              status: "fail",
              summary: error instanceof Error ? error.message : String(error),
            }, {
              id: "employees.instructions",
              label: "Employee instructions",
              status: "info",
              summary: "Employee instruction check skipped because employee runtime could not be loaded.",
            }];
          }
        })()
        : [
          missingLoaderCheck("employees.runtime", "Employee runtime"),
          missingLoaderCheck("employees.instructions", "Employee instructions"),
        ];

      const updateChecks = input.loadUpdateStatus
        ? await (async () => {
          try {
            const status = await input.loadUpdateStatus!();
            return [runtimeCompatibilityCheck(status), approvalManifestCheck(status)];
          } catch (error) {
            return [{
              id: "runtime.update-status",
              label: "Update diagnostics",
              status: "warn" as const,
              summary: error instanceof Error ? error.message : String(error),
              action: { label: "Review updates", href: "/settings" },
            }];
          }
        })()
        : [];

      const sections: TinyOfficeDoctorSectionInput[] = [{
        id: "company",
        label: "Company",
        checks: companyChecks,
      }, {
        id: "employees",
        label: "Employees",
        checks: employeeSections,
      }, {
        id: "runtime",
        label: "Runtime",
        checks: [
          input.loadRuntimeModels
            ? await checkFromLoader("runtime.models", "Runtime models", async () =>
              runtimeModelsCheck(await input.loadRuntimeModels!())
            )
            : missingLoaderCheck("runtime.models", "Runtime models"),
          ...updateChecks,
        ],
      }, {
        id: "access",
        label: "Access",
        checks: [
          input.loadAccess
            ? await checkFromLoader("access.policy", "Access policy", async () =>
              accessPolicyCheck(await input.loadAccess!(companyId))
            )
            : missingLoaderCheck("access.policy", "Access policy"),
        ],
      }];

      return buildTinyOfficeDoctorReport({
        companyId,
        generatedAt: input.now?.(),
        sections,
      });
    },
  };
}
