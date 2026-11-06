export { cn } from "cn";

export function formatDuration(seconds: number) {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [
    days && `${days}d`,
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    secs && `${secs}s`,
  ].filter(Boolean);
  return parts.join(" ");
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

/**
 * Splits a wiki "requirements" cell (e.g. "VII Umber VI (6)") into the HotM tier
 * and the optional collection requirement. The trailing "(n)" is the numeric
 * echo of the roman collection tier, so it is dropped.
 */
export function parseUnlock(hotm: string) {
  const cleaned = hotm.replace(/\s*\(\d+\)\s*$/, "").trim();
  const [tier, ...requirement] = cleaned.split(" ");
  return { tier, requirement: requirement.join(" ") || null };
}
