// src/lib/elapsed.ts — render an elapsed duration for the On-the-clock status
// bar (issue #701). Pure: takes elapsed milliseconds, returns a compact label.

export function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
