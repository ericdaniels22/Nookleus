import { BackgroundTask } from "@capawesome/capacitor-background-task";
import { App } from "@capacitor/app";

export class BackgroundSyncRunner {
  private listenerHandle: { remove: () => Promise<void> } | null = null;

  async start(onWake: (budgetMs: number) => Promise<void>): Promise<void> {
    this.listenerHandle = await App.addListener(
      "appStateChange",
      async ({ isActive }) => {
        if (isActive) return;
        // App went to background. Schedule a finite background task.
        const taskId = await BackgroundTask.beforeExit(async () => {
          try {
            await onWake(8000);
          } catch (e) {
            console.warn("[65c] bg-sync drain error", e);
          } finally {
            BackgroundTask.finish({ taskId });
          }
        });
      },
    );
  }

  async stop(): Promise<void> {
    if (this.listenerHandle) {
      await this.listenerHandle.remove();
      this.listenerHandle = null;
    }
  }
}
