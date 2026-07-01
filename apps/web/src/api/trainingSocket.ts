// Small wrapper around the /ws/train WebSocket. Owns one connection, buffers a
// pending command until the socket opens, and fans server events out to a
// handler. usePythonLab drives it.

import { WS_BASE } from './client';
import { TrainClientCommand, TrainServerEvent } from './types';

export interface TrainingSocketHandlers {
  onEvent: (event: TrainServerEvent) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: () => void;
}

export class TrainingSocket {
  private ws: WebSocket | null = null;
  private queue: TrainClientCommand[] = [];
  private handlers: TrainingSocketHandlers;

  constructor(handlers: TrainingSocketHandlers) {
    this.handlers = handlers;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(`${WS_BASE}/ws/train`);
    this.ws = ws;

    ws.onopen = () => {
      this.handlers.onOpen?.();
      // flush anything queued before the socket was ready
      const pending = this.queue;
      this.queue = [];
      for (const cmd of pending) this.rawSend(cmd);
    };
    ws.onmessage = (ev) => {
      try {
        this.handlers.onEvent(JSON.parse(ev.data) as TrainServerEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      this.handlers.onClose?.(ev);
    };
    ws.onerror = () => this.handlers.onError?.();
  }

  send(cmd: TrainClientCommand): void {
    if (this.isOpen) {
      this.rawSend(cmd);
    } else {
      this.queue.push(cmd);
      this.connect();
    }
  }

  private rawSend(cmd: TrainClientCommand): void {
    this.ws?.send(JSON.stringify(cmd));
  }

  close(): void {
    this.queue = [];
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
