import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresOpenOptions,
} from "../company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../company-config/company-paths.js";

export interface CompanyMemberProfile {
  id: string;
  avatarSeed: string;
  displayName: string;
  role: string;
  summary?: string;
}

export interface CompanyMemberDirectory {
  members: CompanyMemberProfile[];
}

export interface SaveCompanyMemberProfileOptions extends CompanyPostgresOpenOptions {
  companyId: string;
  memberId: string;
  role: string;
  summary: string;
  avatarSeed?: string;
}

export interface CreateCompanyMemberProfileOptions extends CompanyPostgresOpenOptions {
  companyId: string;
  memberId: string;
  displayName: string;
  role: string;
  summary: string;
}

interface CompanyMemberRow {
  id: string;
  avatar_seed: string;
  display_name: string;
  role: string;
  summary: string | null;
}

function memberFromRow(row: CompanyMemberRow): CompanyMemberProfile {
  return {
    id: row.id,
    avatarSeed: requiredIdentityText(row.avatar_seed, "avatarSeed", row.id),
    displayName: requiredIdentityText(row.display_name, "displayName", row.id),
    role: requiredIdentityText(row.role, "role", row.id),
    summary: row.summary || undefined,
  };
}

function requiredIdentityText(value: string | null | undefined, field: string, memberId: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required for Company member ${memberId}`);
  }
  return normalized;
}

export async function loadCompanyMemberDirectory(
  repoRoot: string,
  options: CompanyPostgresOpenOptions & { companyId: string },
): Promise<CompanyMemberDirectory> {
  const companyId = normalizeCompanyId(options.companyId);
  const postgres = await openConfiguredPostgresConnection(repoRoot, options);
  if (!postgres) {
    throw new Error("Company members require PostgreSQL runtime configuration.");
  }

  try {
    const rows = await postgres.client.query<CompanyMemberRow>(`
SELECT id, avatar_seed, display_name, role, summary
FROM company_members
WHERE company_id = $1
ORDER BY id ASC
`, [companyId]);
    return {
      members: rows.rows.map(memberFromRow),
    };
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export async function createCompanyMemberProfile(
  repoRoot: string,
  options: CreateCompanyMemberProfileOptions,
): Promise<CompanyMemberProfile> {
  const companyId = normalizeCompanyId(options.companyId);
  const memberId = options.memberId.trim();
  const displayName = options.displayName.trim();
  const role = options.role.trim();
  if (!memberId) {
    throw new Error("memberId is required");
  }
  if (!displayName) {
    throw new Error("displayName is required");
  }
  if (!role) {
    throw new Error("role is required");
  }
  const postgres = await openConfiguredPostgresConnection(repoRoot, options);
  if (!postgres) {
    throw new Error("Company members require PostgreSQL runtime configuration.");
  }

  try {
    const rows = await postgres.client.query<CompanyMemberRow>(`
INSERT INTO company_members (
  company_id, id, display_name, role, summary, avatar_seed, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $2, NOW(), NOW())
RETURNING *
`, [
      companyId,
      memberId,
      displayName,
      role,
      options.summary.trim() || null,
    ]);
    return memberFromRow(rows.rows[0]!);
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export async function saveCompanyMemberProfile(
  repoRoot: string,
  options: SaveCompanyMemberProfileOptions,
): Promise<CompanyMemberProfile> {
  const companyId = normalizeCompanyId(options.companyId);
  const memberId = options.memberId.trim();
  if (!memberId) {
    throw new Error("memberId is required");
  }
  const role = options.role.trim();
  if (!role) {
    throw new Error("role is required");
  }
  const postgres = await openConfiguredPostgresConnection(repoRoot, options);
  if (!postgres) {
    throw new Error("Company members require PostgreSQL runtime configuration.");
  }

  try {
    const rows = await postgres.client.query<CompanyMemberRow>(`
UPDATE company_members
SET role = $3,
    summary = $4,
    avatar_seed = $5,
    updated_at = NOW()
WHERE company_id = $1
  AND id = $2
RETURNING *
`, [
      companyId,
      memberId,
      role,
      options.summary.trim() || null,
      options.avatarSeed?.trim() || memberId,
    ]);
    const row = rows.rows[0];
    if (!row) {
      throw new Error(`company member ${memberId} not found`);
    }
    return memberFromRow(row);
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

export function findCompanyMemberProfile(
  directory: CompanyMemberDirectory,
  id: string,
): CompanyMemberProfile | undefined {
  return directory.members.find(
    (member) => member.id === id,
  );
}

export function projectCompanyMemberRef(profile: CompanyMemberProfile): ParticipantRef {
  const ref: ParticipantRef = {
    id: profile.id,
    displayName: profile.displayName,
    role: profile.role,
  };
  if (profile.summary) {
    ref.summary = profile.summary;
  }
  return ref;
}
