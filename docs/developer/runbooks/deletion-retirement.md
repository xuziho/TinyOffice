# Deletion And Retirement

Deletion means zero residue by default. Migration and contract cleanup follow the same rule: hard cut first, explicit temporary exception only when the user accepts it.

## Remove Current Entry Points

Clean all current-system traces:

- product docs
- technical docs
- feature maps
- status/alignment pages
- MkDocs nav
- Console nav
- plugin entry points
- runtime/API routes
- compatibility references
- UI entry points
- tests
- scripts
- smoke checks

## Zero-Residue Scan

Run `rg` for feature names, routes, API prefixes, labels, old aliases, and test names.

Every remaining hit must be classified as one of:

- archive
- setup/reset gate
- report-only check
- retired-route negative test fixture

If a hit is still a current product entry point, keep deleting.

## No Compatibility Leftovers

Do not leave old behavior alive through hidden fallback, compatibility aliases, dual product paths, deprecated fields, default-company guesses, or old adapter surfaces.

If a compatibility bridge cannot be removed in the same slice, record it as a temporary exception with a GitHub Issue, owner, visible label, reason, deletion criteria, and verification steps.
