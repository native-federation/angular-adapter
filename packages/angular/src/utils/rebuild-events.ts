import { EventHub, type EventSource } from './event-source.js';

export interface RebuildEvents {
  readonly rebuild: EventSource;
}

export class RebuildHubs implements RebuildEvents {
  readonly rebuild = new EventHub();
}
