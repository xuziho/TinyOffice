import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresClient,
  type CompanyPostgresOpenOptions,
  type CompanyPostgresPoolLike,
} from "./postgres-runtime-connection.js";

export interface ExplicitCompanyContext {
  ok: true;
  companyId: string;
  source: "explicit_company_id";
}

export interface MissingCompanyContext {
  ok: false;
  code: "missing_company_context";
  statusCode: 400;
  message: string;
}

export interface UnknownCompanyContext {
  ok: false;
  code: "unknown_company";
  statusCode: 404;
  message: string;
  setup: {
    required: true;
    reason: "company_not_found";
    companyId: string;
  };
}

export type ExplicitCompanyContextResolution =
  | ExplicitCompanyContext
  | MissingCompanyContext
  | UnknownCompanyContext;

export class CompanyContextRepository {
  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
  ) {}

  static async open(
    repoRoot: string,
    options: CompanyPostgresOpenOptions = {},
  ): Promise<CompanyContextRepository> {
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Company context resolution requires PostgreSQL runtime configuration.");
    }
    return new CompanyContextRepository(postgres.client, postgres.pool);
  }

  close(): void {
    this.client.release();
    void endCompanyPostgresPool(this.pool);
  }

  async resolveExplicitCompanyId(input: {
    companyId?: string;
  }): Promise<ExplicitCompanyContextResolution> {
    const companyId = input.companyId?.trim();
    if (!companyId) {
      return {
        ok: false,
        code: "missing_company_context",
        statusCode: 400,
        message: "TinyOffice API company context requires explicit companyId.",
      };
    }

    const rows = await this.client.query<{ company_id: string }>(
      "SELECT company_id FROM companies WHERE company_id = $1 LIMIT 1",
      [companyId],
    );
    const row = rows.rows[0];
    if (!row) {
      return {
        ok: false,
        code: "unknown_company",
        statusCode: 404,
        message: `Company ${companyId} was not found.`,
        setup: {
          required: true,
          reason: "company_not_found",
          companyId,
        },
      };
    }

    return {
      ok: true,
      companyId: row.company_id,
      source: "explicit_company_id",
    };
  }
}

export async function resolveExplicitCompanyContext(input: {
  repoRoot: string;
  companyId?: string;
  options?: CompanyPostgresOpenOptions;
}): Promise<ExplicitCompanyContextResolution> {
  const repository = await CompanyContextRepository.open(input.repoRoot, input.options);
  try {
    return await repository.resolveExplicitCompanyId({
      companyId: input.companyId,
    });
  } finally {
    repository.close();
  }
}
