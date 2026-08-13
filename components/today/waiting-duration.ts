// Formats "how long since this conversation last had real activity" for
// display — pure function, no Date.now() cached anywhere, always computed
// against the `now` the server component captured at render time.
export function formatWaitingSince(lastActivityAt: Date, now: Date): string {
  const ms = now.getTime() - lastActivityAt.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "ahora mismo";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}
