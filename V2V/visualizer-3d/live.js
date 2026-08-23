export class MosaicLiveClient {
  constructor(url, handlers = {}) {
    this.url = url;
    this.handlers = handlers;
    this.socket = null;
    this.pollTimer = null;
  }

  connect(timeoutMs = 1500) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (connected) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(connected);
      };
      const timeout = setTimeout(() => finish(false), timeoutMs);
      try {
        this.socket = new WebSocket(this.url);
        this.socket.onopen = () => {
          this.handlers.status?.("connected");
          this.poll();
          this.pollTimer = setInterval(() => this.poll(), 100);
          finish(true);
        };
        this.socket.onmessage = (event) => this.handle(event.data);
        this.socket.onerror = () => {
          this.handlers.status?.("error");
          finish(false);
        };
        this.socket.onclose = () => {
          clearInterval(this.pollTimer);
          this.handlers.status?.("closed");
        };
      } catch {
        finish(false);
      }
    });
  }

  poll() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send("poll");
  }

  handle(raw) {
    let envelope;
    try { envelope = JSON.parse(raw); } catch { return; }
    const type = Object.keys(envelope)[0];
    const payload = envelope[type];
    if (!type || !payload) return;
    if (type === "VehicleUpdates") this.handlers.vehicles?.(payload.updated || [], payload);
    else if (type === "VehicleRegistration") this.handlers.registration?.(payload);
    else if (type === "V2xMessageTransmission") this.handlers.transmission?.(payload);
    else if (type === "V2xMessageReception") this.handlers.reception?.(payload);
    else if (type === "UnitsRemove") this.handlers.remove?.(payload);
  }

  close() {
    clearInterval(this.pollTimer);
    this.socket?.close();
  }
}
