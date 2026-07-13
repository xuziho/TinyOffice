# Open-source distribution

## Decision

TinyOffice will not make the existing private incubation repository public in place. The first public repository will be created from a verified clean snapshot of the current product source.

After the transition:

- the new public repository becomes the canonical development repository;
- the current private repository remains a read-only incubation archive;
- future code, issues, pull requests, releases, and contributor activity happen in the public repository;
- private company data and local operator state never move with source code.

This is a repository-boundary decision, not a fork of the product. TinyOffice keeps one active product line and does not maintain separate private and public implementations.

## Public snapshot boundary

The public snapshot includes product source, tests, current product documentation, build metadata, contributor guidance, and third-party notices.

It excludes:

- Git history from the private incubation period;
- `companies/`, employee workspaces, generated private skills, uploads, backups, databases, logs, and secrets;
- QA screenshots, browser captures, visual experiments, and local prototypes;
- archived execution plans and agent-only operating instructions;
- machine-specific paths or configuration.

Test fixtures may use fictional names, ids, paths, or credentials when they are clearly inert and required to verify behavior. They are not runtime defaults and must not be copied into production configuration.

## Release gate

Before creating the public repository:

1. select and commit the root project license;
2. run the normal type, test, frontend, and documentation checks;
3. run `npm run check:open-source` with no exceptions;
4. run `npm run check:dependency-licenses` after a clean `npm ci`;
5. create the snapshot with `git archive`, which respects the repository's `export-ignore` rules;
6. scan the extracted snapshot for secrets and unexpected binary or local data;
7. create the public repository with one initial commit from that snapshot;
8. enable secret scanning, dependency alerts, private vulnerability reporting, and branch protection;
9. verify a clean clone can install, test, build docs, and start the local preview;
10. archive the private repository and update all canonical links.

Repository visibility must not change before this gate passes.

## License boundary

TinyOffice uses Apache-2.0 for the project source. It permits commercial and private use, modification, and redistribution while providing an explicit patent grant and requiring preservation of the license and relevant notices. Third-party components retain their own licenses and attributions.
