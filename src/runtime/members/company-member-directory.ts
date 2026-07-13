import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresOpenOptions,
} from "../company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../company-config/company-paths.js";

export interface CompanyMemberProfile {
  id: string;
  avatarSeed?: string;
  displayName?: string;
  role?: string;
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
  display_name: string | null;
  role: string | null;
  summary: string | null;
}

function memberFromRow(row: CompanyMemberRow): CompanyMemberProfile {
  return {
    id: row.id,
    ...(row.avatar_seed ? { avatarSeed: row.avatar_seed } : {}),
    displayName: row.display_name || undefined,
    role: row.role || undefined,
    summary: row.summary || undefined,
  };
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
  if (!memberId) {
    throw new Error("memberId is required");
  }
  if (!displayName) {
    throw new Error("displayName is required");
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
      options.role.trim() || null,
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
      options.role.trim() || null,
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
  };
  if (profile.displayName) {
    ref.displayName = profile.displayName;
  }
  if (profile.role) {
    ref.role = profile.role;
  }
  if (profile.summary) {
    ref.summary = profile.summary;
  }
  return ref;
}
