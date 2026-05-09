import { Network } from "@capacitor/network";

export class NetworkMonitor {
  private listenerHandle: { remove: () => Promise<void> } | null = null;

  async start(onOnline: () => void): Promise<void> {
    const status = await Network.getStatus();
    if (status.connected) onOnline();
    const handle = await Network.addListener("networkStatusChange", (s) => {
      if (s.connected) onOnline();
    });
    this.listenerHandle = handle;
  }

  async stop(): Promise<void> {
    if (this.listenerHandle) {
      await this.listenerHandle.remove();
      this.listenerHandle = null;
    }
  }
}
