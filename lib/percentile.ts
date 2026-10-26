// Nearest-rank percentile: the smallest sample with at least p of all samples at or below it.
// Always returns an actual sample (never an interpolated value), or null for no samples.
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // The epsilon stops float noise (0.07 * 100 = 7.000000000000001) from bumping the rank up by one
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length - 1e-9)));
  return sorted[rank - 1];
}
