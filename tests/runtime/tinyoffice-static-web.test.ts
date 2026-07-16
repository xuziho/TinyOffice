import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { serveTinyOfficeStaticWeb } from "../../src/server/tinyoffice-static-web.js";

test("production static web serves assets and SPA routes without intercepting APIs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-web-"));
  await writeFile(path.join(root, "index.html"), "<main>TinyOffice</main>");
  await writeFile(path.join(root, "app.js"), "console.log('ok')");
  const server = http.createServer(async (request, response) => {
    if (await serveTinyOfficeStaticWeb(request, response, root)) return;
    response.statusCode = 418;
    response.end("not-web");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal(await (await fetch(`${origin}/app.js`)).text(), "console.log('ok')");
    assert.equal(await (await fetch(`${origin}/chat?room=1`)).text(), "<main>TinyOffice</main>");
    assert.equal((await fetch(`${origin}/api/companies`)).status, 418);
    assert.equal((await fetch(`${origin}/health`)).status, 418);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
