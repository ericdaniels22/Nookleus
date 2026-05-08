// Days remaining in the 30-day trash retention window.
// Returns 0 once the cutoff has passed.
export function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return 0;
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  const remainingMs = 30 * 86_400_000 - elapsed;
  return Math.max(0, Math.floor(remainingMs / 86_400_000));
}
