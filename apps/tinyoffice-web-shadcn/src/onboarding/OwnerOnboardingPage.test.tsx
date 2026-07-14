import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

import { OwnerOnboardingPage } from "./OwnerOnboardingPage";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderOnboarding(session: TinyOfficeCurrentSession): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <OwnerOnboardingPage session={session} />
    </QueryClientProvider>,
  );
}

test("Owner onboarding initializes the account profile before Company creation", () => {
  const html = renderOnboarding({
    schema: "tinyoffice-current-session",
    version: 2,
    user: { id: "owner-1", displayName: "Owner" },
    needsProfileInitialization: true,
    needsCompanyInitialization: true,
  });
  assert.match(html, /Step 1 of 2/);
  assert.match(html, /Set up your profile/);
  assert.doesNotMatch(html, /Create your first Company/);
});

test("Owner onboarding creates the first Company only after profile initialization", () => {
  const html = renderOnboarding({
    schema: "tinyoffice-current-session",
    version: 2,
    user: { id: "owner-1", displayName: "Xu Ziho" },
    needsProfileInitialization: false,
    needsCompanyInitialization: true,
  });
  assert.match(html, /Step 2 of 2/);
  assert.match(html, /Create your first Company/);
  assert.match(html, /Create office/);
});
