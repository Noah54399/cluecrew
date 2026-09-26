import { EventEmitter } from 'node:events';

export interface AppEventMap {
  'tiktok:linked': [{ userId: string }];
  'tiktok:unlinked': [{ userId: string }];
  /** Import progress changed (started, progressed, finished or was deleted). */
  'tiktok:import:updated': [{ userId: string }];
}

/**
 * Tiny typed event bus used to decouple modules (OAuth service -> room manager).
 */
class TypedEmitter {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof AppEventMap>(event: K, listener: (...args: AppEventMap[K]) => void): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof AppEventMap>(event: K, ...args: AppEventMap[K]): void {
    this.emitter.emit(event, ...args);
  }
}

export const appEvents = new TypedEmitter();
