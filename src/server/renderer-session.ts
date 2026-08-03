import { WebSocket } from "ws";

export const RENDERER_TAKEOVER_CLOSE_CODE = 4001;
export const RENDERER_TAKEOVER_CLOSE_REASON =
  "This Codex session was opened in another browser tab.";

type RendererSessionSocket = Pick<WebSocket, "close" | "readyState" | "send">;

type RendererSession = {
  socket: RendererSessionSocket;
  dispose: () => void;
};

export class RendererSessionCoordinator {
  private activeSession: RendererSession | null = null;

  claim(socket: RendererSessionSocket, dispose: () => void): void {
    const previous = this.activeSession;
    if (previous?.socket === socket) {
      return;
    }

    this.activeSession = { socket, dispose };
    if (!previous) {
      return;
    }

    previous.dispose();
    if (
      previous.socket.readyState === WebSocket.OPEN ||
      previous.socket.readyState === WebSocket.CONNECTING
    ) {
      previous.socket.close(
        RENDERER_TAKEOVER_CLOSE_CODE,
        RENDERER_TAKEOVER_CLOSE_REASON,
      );
    }
  }

  release(socket: RendererSessionSocket): void {
    if (this.activeSession?.socket === socket) {
      this.activeSession = null;
    }
  }

  send(payload: string): void {
    const socket = this.activeSession?.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}
