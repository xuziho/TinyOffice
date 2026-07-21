# Runtime event durability

TinyOffice separates runtime work into three planes. This is a dependency
boundary, not a reduction in product scope: Chat, Sessions, Process Trace,
Work, Access, and governance remain product capabilities, but observational
evidence cannot be a prerequisite for a conversation to progress.

## Planes

### Realtime interaction

Realtime interaction is process-local state delivered through the TinyOffice
realtime gateway. It includes runtime status, reply text deltas, reply
snapshots, and projected Activity updates. Publishing these events must not
acquire a PostgreSQL connection.

Realtime events are ordered within a Chat run by `sequenceInRun`. A reconnect
may lose process-local events, so clients reconcile with durable REST
snapshots. Realtime interaction is never the sole source of a user-visible
Message or a business side effect.

### Durable business facts

Business facts are synchronously persisted through small, scoped operations.
They include:

- accepted user Messages;
- final assistant Messages;
- Run and Session terminal state;
- Work, Handoff, Access, and permission decisions;
- tool actions that change external or TinyOffice-owned state.

TinyOffice publishes a completed Chat status only after the final assistant
Message and the terminal Run state are durable. A persistence failure must
produce an explicit failed state; it must not produce a ghost completion.

### Observational evidence

Process Trace is durable observational evidence. It includes thinking,
provider retry, tool lifecycle, progress, and diagnostic events. A bounded
writer preserves per-run order, coalesces or rejects low-value overflow, and
writes batches in the background. Process Trace persistence must not delay
provider invocation or reply text deltas.

Critical tool side effects remain durable business facts even when a related
Process Trace row is delayed. Process Trace is evidence about the fact, not
the fact itself.

## Activity ownership

Activity remains in the Chat Context dock. The backend owns its product
projection and publishes projected Activity upserts for a live run. The
frontend does not reinterpret raw provider events.

The persisted Activity REST response is the reconnect and history authority.
Realtime Activity is an overlay identified by stable Activity ids and ordered
by `sequenceInRun`. A persisted-through sequence watermark lets the client
discard overlay events already represented by the durable snapshot.

The client refreshes durable Activity on initial selection, reconnect, an
observed sequence gap, and terminal reconciliation. It does not refetch the
complete Activity snapshot for every Process Trace event.

## Storage boundaries

Runtime storage is split by responsibility. A Process Trace append or query
must address `process_trace_events` directly and must not load Session records,
Session events, collaboration actions, memory summaries, or retention state.
The same rule applies to other runtime stores.

Core correlation fields such as run, conversation, source Message, and Chat
entry ids are first-class Process Trace columns with scoped indexes. JSON
payloads may retain diagnostic metadata but are not the query contract for
owned identifiers.

Repositories may share the configured PostgreSQL pool. They must not hold one
connection while waiting to acquire another repository connection. A provider
call must not keep a database connection checked out for the duration of model
execution.

Long-lived Message and Channel services do not own long-lived PostgreSQL
clients. Ordinary repository operations borrow and release a pool connection;
transactions pin exactly one connection through their asynchronous call chain.
Chat Projection loads first-message previews with one batch query instead of
starting one concurrent query per conversation on a shared client.

## Backpressure and failure

- The evidence queue is bounded and observable.
- Per-run event order is preserved.
- Writes are idempotent by `(company_id, id)`.
- Repeated progress and thinking observations may be coalesced before storage.
- Business facts and external side effects are never dropped as queue
  backpressure.
- Database acquisition and queries have finite timeouts.
- Shutdown performs a bounded evidence drain and reports any remaining rows.
- An evidence persistence failure is visible in diagnostics but cannot exhaust
  the shared pool or indefinitely block unrelated product APIs.

## Hard-cut policy

This pre-release migration does not keep a compatibility reader, dual writer,
or metadata fallback. Existing test data may be reset when it cannot satisfy
the new schema. Writers populate the first-class correlation columns and
readers query those columns after the migration is applied.
