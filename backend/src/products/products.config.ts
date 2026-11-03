// Global threshold: low is 0 < stock < threshold; normal is stock >= threshold.
export function lowStockThreshold(): number {
  const raw = process.env.LOW_STOCK_THRESHOLD ?? '6';
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 2147483647)
    throw new Error(
      'LOW_STOCK_THRESHOLD must be an integer from 1 to 2147483647',
    );
  return Number(raw);
}
