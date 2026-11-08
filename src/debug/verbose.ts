import { KEYS, type KeyValueStore } from "../lib/storage";
import { redact } from "./redact";

export class VerboseLog {
  private enabled = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: KeyValueStore,
    private readonly secrets: () => readonly string[],
  ) {}

  async load(): Promise<void> {
    try {
      this.enabled = (await this.store.get({ key: KEYS.debugVerbose })).value === "true";
      this.emit();
    } catch {
    }
  }

  get on(): boolean {
    return this.enabled;
  }

  async set(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    this.emit();
    try {
      if (enabled) await this.store.set({ key: KEYS.debugVerbose, value: "true" });
      else await this.store.remove({ key: KEYS.debugVerbose });
    } catch {
    }
  }

  log(topic: string, data: unknown): void {
    if (!this.enabled) return;
    let text: string;
    try {
      text = typeof data === "string" ? data : JSON.stringify(data);
    } catch {
      text = String(data);
    }
    console.debug(`[Mantel debug] ${topic} ${redact(text, this.secrets())}`);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
