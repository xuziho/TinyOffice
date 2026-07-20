# Runtime Extensions and MCP

This page defines how TinyOffice expands employee capability without turning the product runtime into an unmanaged PI installation.

## Product Boundary

| Surface | Product status | Authority |
| --- | --- | --- |
| TinyOffice Skills | Supported | Company or Employee scope in TinyOffice. |
| TinyOffice-managed MCP | Planned product surface | Deployment installation plus Company or Employee assignment. |
| Internal PI extensions | Supported implementation detail | Code-owned approved manifest. |
| Arbitrary PI Marketplace extensions | Not supported | Must be reviewed and adapted before entering the approved manifest. |

TinyOffice is based on a PI runtime provider, but it owns identity, Company isolation, Chat/Handoff, Work, Access, Evidence, model configuration, and web UI semantics. An extension that assumes raw PI CLI behavior is not automatically compatible with these product contracts.

## Runtime Resource Isolation

Employee sessions ignore host-global and project-level PI extensions, prompt templates, themes, and context files. They load only:

- the code-owned approved internal extension factories;
- TinyOffice-selected Company and Employee Skills;
- the compiled TinyOffice system prompt, scene blocks, and employee instruction files.

Startup fails explicitly if an approved extension fails to load or does not register its expected tools. A host package cannot silently add hooks or tools to an employee session.

System AI calls are stricter: they are independent in-memory calls with no history, extensions, skills, prompt templates, themes, context files, or tools.

## MCP Direction

MCP will be implemented as a provider-neutral TinyOffice gateway rather than a global PI package installation.

The planned durable objects are:

1. **MCP Server**: deployment-level transport and launch definition.
2. **MCP Connection**: one concrete credential/account instance for a server.
3. **MCP Assignment**: Company- or Employee-scoped access to a connection.

Installing an MCP server does not automatically expose it to every Company. Runtime discovery is assignment-based. The prompt receives only a compact capability summary; full tool schemas are discovered lazily through the gateway so large MCP catalogs do not inflate every turn.

The first MCP implementation must preserve abort, timeout, tool evidence, Company isolation, name-collision handling, and restart behavior. It must not rely on a generic PI MCP adapter as the product authority.
