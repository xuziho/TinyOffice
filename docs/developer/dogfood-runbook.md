# Dogfood Runbook

`dogfood:*` means publishing or checking the TinyOffice formal-use environment. It is not the default product smoke path.

## Default Product Validation

Before any dogfood update, validate the current mainline product path locally:

```powershell
npm run check
npm test
npm run docs:build
npm run smoke:no-carrier-chat
npm run smoke:standalone-frontend-browser
```

For the real local Chat runtime preview:

```powershell
npm start
```

## Boundary

The current repository no longer contains the Mattermost plugin package, local Mattermost deployment files, or Mattermost runtime adapter scripts. Dogfood updates must not restore those paths.

## Release Evidence

For each dogfood update, record:

- commit SHA
- commands run
- local validation result
- remote service updated
- remote health check result
- rollback note

Do not deploy to dogfood automatically after a mainline smoke. The user must explicitly request a dogfood update or remote health check.
