import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  loadEmployeeRuntimeConfig,
  type EmployeeRuntimeConfig,
} from "../company-config/employees-admin.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../company-config/postgres-runtime-connection.js";
import type {
  CompanyPromptBlock,
  EmployeeInstructionFile,
  PromptBlockScene,
} from "./persistent-pi-employee-agent-contracts.js";
import {
  companyScopeFromEmployeeHome,
  readOptionalTextFile,
  repoRootFromEmployeeHome,
} from "./persistent-pi-employee-agent-paths.js";

const EMPLOYEE_INSTRUCTIONS_FILE_NAME = "AGENTS.md";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function derivePromptBlockSceneType(sessionKey: string): PromptBlockScene {
  if (sessionKey.includes("|dm_thread|")) {
    return "dm_thread";
  }
  if (sessionKey.includes("|chat_direct_room|")) {
    return "dm_thread";
  }
  if (sessionKey.includes("|work_run_execution|")) {
    return "work_run_execution";
  }
  if (sessionKey.includes("|intake_event|")) {
    return "intake_event";
  }
  return "channel_thread";
}
export function assertExplicitEmployeeRuntimeModel(
  employeeId: string,
  runtimeConfig: EmployeeRuntimeConfig,
): { provider: string; id: string } {
  if (!runtimeConfig.modelProvider || !runtimeConfig.modelId) {
    throw new Error(
      `configure-runtime-model-first: Employee ${employeeId} runtime model is required. Set runtime.modelProvider and runtime.modelId in Employee Config before starting the PI session.`,
    );
  }
  return {
    provider: runtimeConfig.modelProvider,
    id: runtimeConfig.modelId,
  };
}

export async function loadCompanyPromptBlocks(input: {
  employeeHomePath: string;
  sessionKey: string;
}): Promise<CompanyPromptBlock[]> {
  const { repoRoot, companyId } = companyScopeFromEmployeeHome(input.employeeHomePath);
  const sceneType = derivePromptBlockSceneType(input.sessionKey);
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("Prompt Policy requires PostgreSQL runtime configuration.");
  }
  try {
    const rows = await postgres.client.query<{
      mount_kind: "always" | "scene";
      block_id: string;
      content: string;
      content_sha256: string;
    }>(
      `
SELECT bindings.mount_kind, blocks.block_id, blocks.content, blocks.content_sha256
FROM prompt_policy_bindings bindings
JOIN prompt_policy_blocks blocks ON blocks.company_id = bindings.company_id AND blocks.block_id = bindings.block_id
WHERE bindings.company_id = $2
  AND (
    bindings.mount_kind = 'always'
    OR (bindings.mount_kind = 'scene' AND bindings.scene_type = $1)
  )
ORDER BY
  CASE WHEN bindings.mount_kind = 'always' THEN 0 ELSE 1 END,
  bindings.position ASC,
  blocks.block_id ASC
`,
      [sceneType, companyId],
    );
    const blockRows = [...rows.rows];
    if (!blockRows.some((row) => row.mount_kind === "scene")) {
      throw new Error(`Prompt Policy scene ${sceneType} has no configured prompt block.`);
    }
    const seen = new Set<string>();
    return blockRows
      .map((row) => {
        if (seen.has(row.block_id)) {
          return undefined;
        }
        seen.add(row.block_id);
        const trimmed = row.content.trim();
        return trimmed
          ? {
            path: row.block_id,
            sha256: row.content_sha256 || sha256(trimmed),
            content: trimmed,
          }
          : undefined;
      })
      .filter((block): block is CompanyPromptBlock => Boolean(block));
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export async function loadEmployeeInstructionFiles(input: {
  employeeHomePath: string;
  workspacePath: string;
}): Promise<EmployeeInstructionFile[]> {
  const filePath = path.join(input.employeeHomePath, EMPLOYEE_INSTRUCTIONS_FILE_NAME);
  const content = await readOptionalTextFile(filePath);
  return content === undefined ? [] : [{ path: filePath, content }];
}

async function pathIsDirectory(directoryPath: string): Promise<boolean> {
  return stat(directoryPath)
    .then((entry) => entry.isDirectory())
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    });
}

export async function loadEmployeeSkillPaths(input: {
  employeeHomePath: string;
}): Promise<string[]> {
  const companyHomePath = path.dirname(path.dirname(input.employeeHomePath));
  const candidatePaths = [
    path.join(companyHomePath, "skills"),
    path.join(input.employeeHomePath, "skills"),
  ];

  const existingPaths: string[] = [];
  for (const skillPath of candidatePaths) {
    if (await pathIsDirectory(skillPath)) {
      existingPaths.push(skillPath);
    }
  }
  return existingPaths;
}

export function formatEmployeeInstructionAppend(files: EmployeeInstructionFile[]): string[] {
  return files.map((file) =>
    [
      `Employee-specific instructions from ${file.path}:`,
      file.content.trim(),
    ].join("\n"),
  );
}

export function formatCompanyPromptBlocks(blocks: CompanyPromptBlock[] | undefined): string[] {
  return (blocks || []).map((block) =>
    [
      `Company prompt block from ${block.path}:`,
      block.content,
    ].join("\n"),
  );
}

