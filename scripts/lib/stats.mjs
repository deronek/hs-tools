// Shared numeric helpers for the data scripts.

/** p-th (0..1) percentile of an ascending-sorted array of numbers. */
export function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
