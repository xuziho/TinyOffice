import { runStandaloneFrontendBrowserSmoke } from "./smoke-standalone-frontend-browser.js";

runStandaloneFrontendBrowserSmoke()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
