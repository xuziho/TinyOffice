import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDoctorCliArgs,
  runDoctorCli,
} from "../../src/cli/doctor-cli.js";
import { buildTinyOfficeDoctorReport } from "../../src/runtime/doctor/tinyoffice-doctor.js";

test("doctor CLI parses company, runtime URL, and output mode", () => {
  assert.deepEqual(parseDoctorCliArgs(["--company", "acme", "--url", "http://127.0.0.1:8095", "--summary"]), {
    companyId: "acme",
    runtimeUrl: "http://127.0.0.1:8095",
    output: "summary",
  });
  assert.deepEqual(parseDoctorCliArgs(["--company", "acme"]), {
    companyId: "acme",
    runtimeUrl: "http://127.0.0.1:8095",
    output: "json",
  });
  assert.deepEqual(parseDoctorCliArgs(["acme", "http://runtime.test", "--summary"]), {
    companyId: "acme",
    runtimeUrl: "http://runtime.test",
    output: "summary",
  });
  assert.deepEqual(parseDoctorCliArgs(["acme", "http://runtime.test", "summary"]), {
    companyId: "acme",
    runtimeUrl: "http://runtime.test",
    output: "summary",
  });
  assert.throws(
    () => parseDoctorCliArgs(["--url", "http://127.0.0.1:8095"]),
    /--company is required/,
  );
});

test("doctor CLI fetches the company doctor report from the runtime API", async () => {
  const visited: string[] = [];
  const output = await runDoctorCli(["--company", "acme", "--url", "http://runtime.test", "--summary"], {
    fetchReport: async (url) => {
      visited.push(url.toString());
      return buildTinyOfficeDoctorReport({
        companyId: "acme",
        generatedAt: "2026-07-09T08:00:00.000Z",
        sections: [{
          id: "core",
          label: "Core",
          checks: [{
            id: "core.api",
            label: "Runtime API",
            status: "ok",
            summary: "Runtime API is reachable.",
          }],
        }],
      });
    },
  });

  assert.deepEqual(visited, ["http://runtime.test/api/companies/acme/doctor"]);
  assert.match(output, /TinyOffice doctor: fail=0 warn=0 ok=1 info=0/);
});
