# Security policy

## Supported versions

TinyOffice is pre-release software. No version is currently supported for production use or security backports.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue, discussion, or pull request. Use GitHub's private vulnerability reporting for the public repository once it is enabled. Until then, contact the repository owner privately through the account listed on the GitHub repository.

Include the affected commit or version, reproduction steps, expected impact, and any suggested mitigation. Please avoid accessing data that is not yours and do not perform destructive testing.

## Secrets and local data

TinyOffice repositories must not contain provider keys, authentication tokens, company records, employee workspaces, uploaded assets, runtime databases, backups, or production configuration. If such material is committed, rotate the affected credential first and then coordinate history cleanup privately.
