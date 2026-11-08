import type { ApiRequestRecord } from "../lib/api-client";
import { redact } from "./redact";

export type RequestLogEntry = ApiRequestRecord & { id: number };

export class RequestLog {
  private entries: RequestLogEntry[] = [];
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  constructor(readonly capacity = 100) {}

  add(record: ApiRequestRecord): RequestLogEntry {
    const entry: RequestLogEntry = { ...record, route: redact(record.route), id: this.nextId++ };
    this.entries = [entry, ...this.entries].slice(0, this.capacity);
    this.emit();
    return entry;
  }

  list(): readonly RequestLogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
      }
    }
  }
}
