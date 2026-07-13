import {
  buildRuntimeModelCallLifecycleEvent,
  type RuntimeModelCallLifecycleKind,
  type RuntimeSceneTurn,
} from "../orchestration/runtime-scene-turn.js";
import {
  type RuntimeSessionStatus,
} from "../storage/runtime-session-repository.js";
import type {
  RuntimeSessionEventDraft,
  RuntimeTokenUsage,
} from "./contracts.js";
import type {
  NaturalLanguageResponseInput,
  RuntimeSessionEventInput,
  RuntimeSessionPersistResult,
  RuntimeSessionRecordInput,
} from "./natural-language-responder-contracts.js";
import { buildInitialRuntimeSessionMetadata } from "./natural-language-responder-runtime-metadata.js";
import {
  buildRuntimeSessionEventId,
  inferRuntimeSessionEventSemanticRole,
  inferRuntimeSessionEventSource,
  inferRuntimeSessionEventVisibility,
} from "./natural-language-responder-session-events.js";
import {
  cacheTokenTotal,
  persistNaturalLanguageRuntimeSessionSnapshot,
  persistNaturalLanguageRuntimeSessionSnapshotIntoRepository,
  tokenTotal,
} from "./natural-language-responder-session-persistence.js";
import { appendRuntimeResponderTrace, nowIso } from "./natural-language-responder-trace.js";

export class NaturalLanguageRuntimeSessionWriter {
  readonly sessionRecordId: string;
  readonly sceneType: string;
  readonly sceneId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly modelCallId: string;

  private runtimeSessionSnapshot: RuntimeSessionRecordInput | undefined;
  private readonly runtimeSessionEvents: RuntimeSessionEventInput[] = [];
  private readonly turnEventOrdinalByTurnId = new Map<string, number>();
  private runtimeSessionFlushChain = Promise.resolve();
  private sessionEventSequence = 0;
  private latestUsage: RuntimeTokenUsage | undefined;
  private readonly runtimeSessionMetadata;

  constructor(private readonly config: {
    responseInput: NaturalLanguageResponseInput;
    repoRoot: string;
    runtimeSceneTurn: RuntimeSceneTurn;
    replyStartedAt: string;
    waitForProcessEvents: () => Promise<void>;
  }) {
    const identity = config.runtimeSceneTurn.identity;
    this.sessionRecordId = identity.sessionRecordId;
    this.sceneType = identity.sceneType;
    this.sceneId = identity.sceneId;
    this.turnId = identity.turnId;
    this.runId = identity.runId;
    this.modelCallId = config.runtimeSceneTurn.modelCall.id;
    this.runtimeSessionMetadata = buildInitialRuntimeSessionMetadata(config.responseInput);
  }

  updateLatestUsage(usage: RuntimeTokenUsage | undefined) {
    this.latestUsage = usage || this.latestUsage;
  }

  getLatestUsage() {
    return this.latestUsage;
  }

  appendRuntimeSessionEvent(event: RuntimeSessionEventDraft) {
    const sequence = ++this.sessionEventSequence;
    const eventTurnId = event.turnId || this.turnId;
    const eventOrdinal = (this.turnEventOrdinalByTurnId.get(eventTurnId) || 0) + 1;
    this.turnEventOrdinalByTurnId.set(eventTurnId, eventOrdinal);
    this.runtimeSessionEvents.push({
      id: buildRuntimeSessionEventId(this.sessionRecordId, eventTurnId, eventOrdinal),
      sessionRecordId: this.sessionRecordId,
      sequence,
      timestamp: event.timestamp || nowIso(),
      kind: event.kind,
      role: event.role,
      sceneId: event.sceneId || this.sceneId,
      turnId: eventTurnId,
      runId: event.runId || this.runId,
      modelCallId: event.modelCallId || this.modelCallId,
      source: event.source || inferRuntimeSessionEventSource(event),
      visibility: event.visibility || inferRuntimeSessionEventVisibility(event),
      semanticRole: event.semanticRole || inferRuntimeSessionEventSemanticRole(event),
      rawEventKind: event.rawEventKind || event.kind,
      title: event.title,
      summary: event.summary,
      preview: event.preview,
      payload: event.payload,
      byteSize: event.byteSize,
      truncated: event.truncated,
    });
  }

  appendModelCallLifecycleEvent(
    kind: RuntimeModelCallLifecycleKind,
    event: {
      title: string;
      summary?: string;
      preview?: string;
      payload?: Record<string, unknown>;
      byteSize?: number;
      timestamp?: string;
      semanticRole?: string;
    },
  ) {
    this.appendRuntimeSessionEvent(buildRuntimeModelCallLifecycleEvent(
      this.config.runtimeSceneTurn,
      kind,
      event,
    ));
  }

  upsertRuntimeSession(status: RuntimeSessionStatus, summary?: string) {
    const input = this.config.responseInput;
    this.runtimeSessionSnapshot = {
      id: this.sessionRecordId,
      employeeId: input.employee.employeeId,
      sessionKey: input.sessionKey,
      sessionId: this.sessionRecordId,
      sceneType: this.sceneType,
      channelTopicId: input.channelTopicId,
      requesterId: input.requesterUsername,
      modelProvider: this.runtimeSessionMetadata.model?.provider || input.employee.runtime?.modelProvider,
      modelId: this.runtimeSessionMetadata.model?.id || input.employee.runtime?.modelId,
      runtimeMetadata: this.runtimeSessionMetadata,
      status,
      title: `${input.employee.employeeId} ${this.sceneType} session`,
      summary,
      startedAt: this.config.replyStartedAt,
      updatedAt: nowIso(),
      tokenInputTotal: tokenTotal(this.latestUsage?.input),
      tokenOutputTotal: tokenTotal(this.latestUsage?.output),
      tokenCacheTotal: cacheTokenTotal(this.latestUsage),
    };
  }

  async flushRuntimeSessionWrites() {
    if (!this.runtimeSessionSnapshot) {
      return;
    }
    const input = this.config.responseInput;
    await this.config.waitForProcessEvents();
    const authoritativeUsage = this.latestUsage
      ? {
          modelCallId: this.modelCallId,
          usage: this.latestUsage,
        }
      : undefined;
    let persisted: RuntimeSessionPersistResult;
    if (input.runtimeSessionRepository) {
      persisted = await persistNaturalLanguageRuntimeSessionSnapshotIntoRepository(
        input.runtimeSessionRepository,
        this.runtimeSessionSnapshot,
        this.runtimeSessionEvents,
        { authoritativeUsage },
      );
      await input.runtimeSessionRepository.save();
    } else {
      persisted = await persistNaturalLanguageRuntimeSessionSnapshot(
        this.config.repoRoot,
        input.employee.companyId,
        this.runtimeSessionSnapshot,
        this.runtimeSessionEvents,
        { authoritativeUsage },
      );
    }
    await input.onRuntimeSessionPersisted?.(persisted);
    await appendRuntimeResponderTrace({
      phase: "reply.session_persisted",
      employeeId: input.employee.employeeId,
      sessionKey: input.sessionKey,
      sessionRecordId: persisted.record.id,
      status: persisted.record.status,
      eventCount: persisted.record.eventCount || 0,
      appendedEventCount: persisted.appendedEventCount,
    });
  }

  scheduleRuntimeSessionFlush() {
    const input = this.config.responseInput;
    this.runtimeSessionFlushChain = this.runtimeSessionFlushChain
      .then(() => this.flushRuntimeSessionWrites())
      .catch((error) =>
        appendRuntimeResponderTrace({
          phase: "reply.session_incremental_flush_error",
          employeeId: input.employee.employeeId,
          sessionKey: input.sessionKey,
          error: error instanceof Error ? error.stack || error.message : String(error),
        }).catch(() => undefined),
      );
    return this.runtimeSessionFlushChain;
  }

  waitForScheduledFlushes() {
    return this.runtimeSessionFlushChain;
  }
}
