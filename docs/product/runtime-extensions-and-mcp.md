# Runtime Extensions and MCP

This page defines how TinyOffice expands employee capability without turning the product runtime into an unmanaged PI installation.

## Product Boundary

| Surface | Product status | Authority |
| --- | --- | --- |
| TinyOffice Skills | Supported | Company or Employee scope in TinyOffice. |
| TinyOffice-managed MCP | Foundation implemented | Deployment installation plus Company or Employee assignment. |
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

## MCP Product Model

MCP is implemented as a provider-neutral TinyOffice gateway rather than a global PI package installation.

The durable objects are:

1. **MCP Server**: deployment-level transport and launch definition.
2. **MCP Connection**: one concrete credential/account instance for a server.
3. **MCP Assignment**: Company- or Employee-scoped access to a connection.

Installing an MCP server does not automatically expose it to every Company. Runtime discovery is assignment-based. The model-visible capability registry names `mcp.tools.list` and `mcp.tool.call`; full MCP tool schemas are loaded only when an employee calls the list capability, so large MCP catalogs do not inflate every turn. If one assigned connection is unavailable, tools from healthy connections remain discoverable and the failed connection is returned separately in `unavailableConnections`.

The standalone `/mcp` page is a read-only Owner visibility surface. It shows deployment-level servers and connections plus Company and Employee assignments, but it does not expose manual configuration forms. MCP is not hidden under External Intake because Intake transports events into TinyOffice while MCP gives employees outbound tools.

Connection records store environment-variable references, never credential values. A stdio environment entry maps the variable name expected by the MCP server to a host environment variable. An HTTP header entry maps a header name to a host environment variable. The browser can see reference names and whether they resolve, but never receives the resolved value.

The runtime creates and closes an MCP client around each discovery or call. This gives restart-safe behavior without holding opaque cross-turn client state. Calls have a finite timeout and accept runtime cancellation. Tool names remain paired with `connectionId`, which avoids collisions between servers without rewriting server-owned tool names. Every call records started and terminal audit evidence, but the evidence contains only argument names and value types plus result shape metadata. TinyOffice does not persist argument values, MCP content bodies, or resolved credentials in MCP audit rows; error strings are bounded and credential-redacted.

Assignment is the product authority boundary. Once the Owner assigns a connection, ordinary employee use does not add an invented generic business-confirmation layer. The MCP tool itself may still expose its own protocol or application semantics.

Operators configure MCP by asking an employee in Chat. The employee first reads `mcp.admin.describe`, validates and presents the exact command or URL, environment-reference names, scope, and affected employees, and then uses `mcp.admin.configure` only after explicit operator confirmation. This capability path is the only active product path that writes MCP Server, Connection, and Assignment objects; it does not edit PI global configuration or accept secret values in Chat.

## Current Limit

The first foundation supports stdio and Streamable HTTP definitions created through a confirmed Chat capability and inspected through the Owner page. OAuth browser handshakes, an MCP marketplace, automated package provenance review, server update automation, and per-tool allow/deny overrides are not yet product behavior. They must build on the same Server / Connection / Assignment boundary rather than bypass it through global PI configuration.
