import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "./postgres-runtime-connection.js";
import {
  DEFAULT_PROMPT_BLOCKS_BY_SCENE,
  DEFAULT_PROMPT_POLICY_BLOCKS,
  DEFAULT_PROMPT_POLICY_TEMPLATES,
  TEMPLATE_IDS,
  emptyPromptBlocksConfig,
  SCENES,
  type AvailablePromptBlock,
  type PromptBlockScene,
  type PromptBlocksAdminState,
  type PromptBlocksConfig,
  type PromptPolicyCompanyOptions,
  type PromptPolicyTemplateId,
  type PromptPolicyTemplateViewModel,
} from "./prompt-policy-model.js";
import {
  buildPreview,
  normalizePromptBlockTitle,
  normalizePromptBlocksConfig,
  resolvePromptPolicyCompanyId,
  sha256,
  validatePromptBlockId,
  validatePromptBlocksConfig,
  validatePromptPolicyTemplateId,
} from "./prompt-policy-format.js";

export async function loadPromptBlocksConfig(
  repoRoot: string,
  options: PromptPolicyCompanyOptions,
): Promise<PromptBlocksConfig> {
  const companyId = resolvePromptPolicyCompanyId(options);
  await ensurePromptPolicyDefaults(repoRoot, { companyId });
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("Prompt Policy requires PostgreSQL runtime configuration.");
  }
  try {
    const rows = await postgres.client.query<{
      mount_kind: "always" | "scene";
      scene_type: PromptBlockScene | null;
      block_id: string;
    }>(`
SELECT mount_kind, scene_type, block_id
FROM prompt_policy_bindings
WHERE company_id = $1
ORDER BY position ASC, block_id ASC
`, [companyId]);
    const config = emptyPromptBlocksConfig();
    for (const row of rows.rows) {
      if (row.mount_kind === "always") {
        config.always.push(row.block_id);
      } else if (row.scene_type && SCENES.includes(row.scene_type)) {
        config.scenes[row.scene_type].push(row.block_id);
      }
    }
    return config;
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export async function listAvailablePromptBlocks(
  repoRoot: string,
  options: PromptPolicyCompanyOptions,
): Promise<AvailablePromptBlock[]> {
  const companyId = resolvePromptPolicyCompanyId(options);
  await ensurePromptPolicyDefaults(repoRoot, { companyId });
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("Prompt Policy requires PostgreSQL runtime configuration.");
  }
  try {
    const rows = await postgres.client.query<{
      block_id: string;
      title: string | null;
      content: string;
      content_sha256: string;
    }>(`
SELECT block_id, title, content, content_sha256
FROM prompt_policy_blocks
WHERE company_id = $1
ORDER BY block_id ASC
`, [companyId]);
    return rows.rows.map((row) => ({
      path: row.block_id,
      title: row.title || row.block_id,
      sha256: row.content_sha256 || sha256(row.content.trim()),
      preview: buildPreview(row.content),
      content: row.content,
    }));
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export async function listPromptPolicyTemplates(
  repoRoot: string,
  options: PromptPolicyCompanyOptions,
): Promise<PromptPolicyTemplateViewModel[]> {
  const companyId = resolvePromptPolicyCompanyId(options);
  await ensurePromptPolicyDefaults(repoRoot, { companyId });
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("Prompt Policy requires PostgreSQL runtime configuration.");
  }
  try {
    const rows = await postgres.client.query<{
      template_id: PromptPolicyTemplateId;
      content: string;
    }>(`
SELECT template_id, content
FROM prompt_policy_templates
WHERE company_id = $1
ORDER BY template_id ASC
`, [companyId]);
    const contentById = new Map(rows.rows.map((row) => [row.template_id, row.content]));
    return TEMPLATE_IDS.map((id) => {
      const defaults = DEFAULT_PROMPT_POLICY_TEMPLATES[id];
      const content = contentById.get(id);
      if (content === undefined) {
        throw new Error(`Prompt Policy template ${id} is missing for company ${companyId}.`);
      }
      return {
        id,
        label: defaults.label,
        description: defaults.description,
        variableHints: defaults.variableHints,
        content,
        defaultContent: defaults.content,
      };
    });
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

async function ensurePromptPolicyDefaults(
  repoRoot: string,
  options: PromptPolicyCompanyOptions,
): Promise<void> {
  const companyId = resolvePromptPolicyCompanyId(options);
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("Prompt Policy requires PostgreSQL runtime configuration.");
  }
  try {
    const existing = await postgres.client.query<{ count: string }>(
      `
SELECT COUNT(*)::text AS count
FROM (
  SELECT company_id FROM prompt_policy_blocks WHERE company_id = $1
  UNION ALL
  SELECT company_id FROM prompt_policy_templates WHERE company_id = $1
  UNION ALL
  SELECT company_id FROM prompt_policy_bindings WHERE company_id = $1
) existing_prompt_policy
`,
      [companyId],
    );
    if (Number(existing.rows[0]?.count || "0") > 0) {
      return;
    }

    await postgres.client.query("BEGIN");
    for (const [blockId, block] of Object.entries(DEFAULT_PROMPT_POLICY_BLOCKS)) {
      await postgres.client.query(
        `INSERT INTO prompt_policy_blocks (
  company_id, block_id, title, content, content_sha256, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (company_id, block_id) DO NOTHING`,
        [
          companyId,
          blockId,
          block.title,
          block.content,
          sha256(block.content.trim()),
        ],
      );
    }
    for (const templateId of TEMPLATE_IDS) {
      const template = DEFAULT_PROMPT_POLICY_TEMPLATES[templateId];
      await postgres.client.query(
        `INSERT INTO prompt_policy_templates (
  company_id, template_id, title, content, content_sha256, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (company_id, template_id) DO NOTHING`,
        [companyId, templateId, template.label, template.content, sha256(template.content.trim())],
      );
    }
    for (const scene of SCENES) {
      await postgres.client.query(
        `INSERT INTO prompt_policy_bindings (
  company_id, mount_kind, scene_type, block_id, position, created_at, updated_at
)
VALUES ($1, 'scene', $2, $3, 0, NOW(), NOW())
ON CONFLICT DO NOTHING`,
        [companyId, scene, DEFAULT_PROMPT_BLOCKS_BY_SCENE[scene]],
      );
    }
    await postgres.client.query("COMMIT");
  } catch (error) {
    await postgres.client.query("ROLLBACK");
    throw error;
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export async function loadPromptPolicyTemplateContent(input: {
  repoRoot: string;
  templateId: PromptPolicyTemplateId;
  companyId: string;
}): Promise<string> {
  const templateId = validatePromptPolicyTemplateId(input.templateId);
  const templates = await listPromptPolicyTemplates(input.repoRoot, { companyId: input.companyId });
  const template = templates.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Prompt Policy template ${templateId} is missing for company ${input.companyId}.`);
  }
  return template.content;
}

export async function savePromptBlocksConfig(input: {
  repoRoot: string;
  config: unknown;
  companyId: string;
}): Promise<PromptBlocksAdminState> {
  const availableBlocks = await listAvailablePromptBlocks(input.repoRoot, { companyId: input.companyId });
  const normalized = validatePromptBlocksConfig(
    normalizePromptBlocksConfig(input.config),
    input.repoRoot,
    availableBlocks.map((block) => block.path),
  );
  await savePromptBindings(input.repoRoot, normalized, { companyId: input.companyId });
  return {
    config: normalized,
    availableBlocks,
  };
}

export async function savePromptBlockContent(input: {
  repoRoot: string;
  blockPath: unknown;
  title?: unknown;
  content: unknown;
  companyId: string;
}): Promise<PromptBlocksAdminState> {
  const companyId = resolvePromptPolicyCompanyId(input);
  if (typeof input.blockPath !== "string") {
    throw new Error("prompt block path is required.");
  }
  if (typeof input.content !== "string") {
    throw new Error("prompt block content must be a string.");
  }
  const normalizedPath = validatePromptBlockId(input.blockPath);
  const normalizedTitle = normalizePromptBlockTitle(input.title, normalizedPath);
  const postgres = await openConfiguredPostgresConnection(input.repoRoot);
  if (!postgres) {
    throw new Error("Prompt Policy requires PostgreSQL runtime configuration.");
  }
  try {
    await postgres.client.query(
      `INSERT INTO prompt_policy_blocks (
  company_id, block_id, title, content, content_sha256, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (company_id, block_id) DO UPDATE
SET title = COALESCE(EXCLUDED.title, prompt_policy_blocks.title),
    content = EXCLUDED.content,
    content_sha256 = EXCLUDED.content_sha256,
    updated_at = NOW()`,
      [companyId, normalizedPath, normalizedTitle, input.content, sha256(input.content.trim())],
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
  return loadPromptBlocksAdminStateFromPersistence(input.repoRoot, { companyId: input.companyId });
}

export async function savePromptTemplateRow(
  repoRoot: string,
  templateId: PromptPolicyTemplateId,
  content: string,
  options: PromptPolicyCompanyOptions,
): Promise<void> {
  const companyId = resolvePromptPolicyCompanyId(options);
  const defaults = DEFAULT_PROMPT_POLICY_TEMPLATES[templateId];
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("Prompt Policy requires PostgreSQL runtime configuration.");
  }
  try {
    await postgres.client.query(
      `INSERT INTO prompt_policy_templates (
  company_id, template_id, title, content, content_sha256, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (company_id, template_id) DO UPDATE
SET title = EXCLUDED.title,
    content = EXCLUDED.content,
    content_sha256 = EXCLUDED.content_sha256,
    updated_at = NOW()`,
      [companyId, templateId, defaults.label, content, sha256(content.trim())],
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

async function loadPromptBlocksAdminStateFromPersistence(
  repoRoot: string,
  options: PromptPolicyCompanyOptions,
): Promise<PromptBlocksAdminState> {
  const [config, availableBlocks] = await Promise.all([
    loadPromptBlocksConfig(repoRoot, options),
    listAvailablePromptBlocks(repoRoot, options),
  ]);
  return {
    config: validatePromptBlocksConfig(config, repoRoot, availableBlocks.map((block) => block.path)),
    availableBlocks,
  };
}

async function savePromptBindings(
  repoRoot: string,
  config: PromptBlocksConfig,
  options: PromptPolicyCompanyOptions,
): Promise<void> {
  const companyId = resolvePromptPolicyCompanyId(options);
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("Prompt Policy requires PostgreSQL runtime configuration.");
  }
  try {
    await postgres.client.query("BEGIN");
    await postgres.client.query("DELETE FROM prompt_policy_bindings WHERE company_id = $1", [companyId]);
    let position = 0;
    for (const blockId of config.always) {
      await postgres.client.query(
        `INSERT INTO prompt_policy_bindings (
  company_id, mount_kind, scene_type, block_id, position, created_at, updated_at
)
VALUES ($1, 'always', NULL, $2, $3, NOW(), NOW())`,
        [companyId, blockId, position],
      );
      position += 1;
    }
    for (const scene of SCENES) {
      let scenePosition = 0;
      for (const blockId of config.scenes[scene]) {
        await postgres.client.query(
          `INSERT INTO prompt_policy_bindings (
  company_id, mount_kind, scene_type, block_id, position, created_at, updated_at
)
VALUES ($1, 'scene', $2, $3, $4, NOW(), NOW())`,
          [companyId, scene, blockId, scenePosition],
        );
        scenePosition += 1;
      }
    }
    await postgres.client.query("COMMIT");
  } catch (error) {
    await postgres.client.query("ROLLBACK");
    throw error;
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}
