import { Network } from "@capacitor/network";

export class NetworkMonitor {
  private listenerHandle: { remove: () => Promise<void> } | null = null;

  async start(onChange: (online: boolean) => void): Promise<void> {
    const status = await Network.getStatus();
    onChange(status.connected);
    const handle = await Network.addListener("networkStatusChange", (s) => {
      onChange(s.connected);
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
