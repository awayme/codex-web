type MessagePortListener = (...args: unknown[]) => void;

export type MessagePortTransportMessage =
  | {
      type: "message-port-message";
      portId: string;
      data: unknown;
    }
  | {
      type: "message-port-close";
      portId: string;
    };

export class WebSocketMessagePort {
  private closed = false;
  private readonly listeners = new Map<string, Set<MessagePortListener>>();
  private readonly pendingMessages: unknown[] = [];

  constructor(
    private readonly portId: string,
    private readonly sendToRenderer: (
      message: MessagePortTransportMessage,
    ) => void,
    private readonly onClosed: () => void,
  ) {}

  on(event: string, listener: MessagePortListener): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    if (event === "message" && this.pendingMessages.length > 0) {
      for (const data of this.pendingMessages.splice(0)) {
        listener({ data });
      }
    }
    return this;
  }

  postMessage(data: unknown): void {
    if (this.closed) {
      return;
    }
    this.sendToRenderer({
      type: "message-port-message",
      portId: this.portId,
      data,
    });
  }

  start(): void {}

  close(): void {
    if (!this.markClosed()) {
      return;
    }
    this.sendToRenderer({
      type: "message-port-close",
      portId: this.portId,
    });
  }

  receiveMessage(data: unknown): void {
    if (this.closed) {
      return;
    }
    const listeners = this.listeners.get("message");
    if (!listeners || listeners.size === 0) {
      if (this.pendingMessages.length < 1_000) {
        this.pendingMessages.push(data);
      }
      return;
    }
    for (const listener of listeners) {
      listener({ data });
    }
  }

  disconnect(): void {
    if (!this.markClosed()) {
      return;
    }
    this.emit("close");
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  private markClosed(): boolean {
    if (this.closed) {
      return false;
    }
    this.closed = true;
    this.pendingMessages.length = 0;
    this.onClosed();
    return true;
  }
}
