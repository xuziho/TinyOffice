import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnerAccessInstructions,
  printOwnerAccessInstructions,
} from "../../scripts/runtime/owner-access-instructions.js";

test("Owner access instructions expose the remote bootstrap URL", () => {
  assert.deepEqual(buildOwnerAccessInstructions({
    publicOrigin: "https://office.example.com/",
    bootstrapToken: "token with spaces",
  }), [
    "TinyOffice needs its first Owner passkey.",
    "Open once: https://office.example.com/?bootstrap=token%20with%20spaces",
  ]);
});

test("Owner access instructions expose the local one-time ticket", () => {
  assert.deepEqual(buildOwnerAccessInstructions({
    publicOrigin: "http://localhost:5175",
    localAccessTicket: "local-ticket",
  }), [
    "TinyOffice local Owner access is ready.",
    "Open once: http://localhost:5175/?localAccess=local-ticket",
  ]);
});

test("Owner access instructions print the ordinary URL after setup", () => {
  const lines: string[] = [];
  printOwnerAccessInstructions({
    publicOrigin: "https://office.example.com/",
  }, (line) => lines.push(line));
  assert.deepEqual(lines, ["Open: https://office.example.com/"]);
});
