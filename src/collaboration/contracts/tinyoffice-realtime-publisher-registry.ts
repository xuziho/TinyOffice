import type {
  TinyOfficeRealtimeEvent,
  TinyOfficeRealtimeEventPayload,
  TinyOfficeRealtimePublisher,
} from "./tinyoffice-realtime-contract.js";

const attachedPublishers = new Set<TinyOfficeRealtimePublisher>();

export function registerTinyOfficeRealtimePublisher(
  publisher: TinyOfficeRealtimePublisher,
): () => void {
  attachedPublishers.add(publisher);
  return () => attachedPublishers.delete(publisher);
}

export function publishToRegisteredTinyOfficeRealtimePublishers(
  event: TinyOfficeRealtimeEventPayload,
): TinyOfficeRealtimeEvent[] {
  return [...attachedPublishers].map((publisher) => publisher.publish(event));
}
