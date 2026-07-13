import assert from "node:assert/strict";
import test from "node:test";

import { executeTinyOfficeCapabilityCallTool } from "../../src/runtime/capabilities/capability-tool.js";

test("Intake integration contract is machine-readable to AI employees", async () => {
  const call = await executeTinyOfficeCapabilityCallTool({
    repoRoot: process.cwd(),
    companyId: "ziho-e-com",
    capabilityId: "intake.integration.describe",
    input: { companyId: "ziho-e-com" },
    conversationId: "conversation-1",
  });

  assert.equal(call.status, "allowed");
  assert.equal(call.capabilityId, "intake.integration.describe");
  const contract = call.result as Record<string, unknown>;
  assert.equal(contract.schema, "tinyoffice-intake-integration-contract");
  assert.equal(contract.method, "POST");
  assert.equal(contract.endpointPath, "/api/companies/ziho-e-com/intake/events");
  assert.equal(contract.targetSelectionCapabilityId, "company.member.directory.list");
  assert.match(JSON.stringify(contract), /targetMemberId/);
  assert.match(JSON.stringify(contract), /sourceEventId/);
});
