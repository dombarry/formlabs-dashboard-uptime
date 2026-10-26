import { describe, expect, it } from "vitest";
import { percentile } from "./percentile";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("percentile (nearest-rank)", () => {
  it("matches textbook values for 1..100", () => {
    expect(percentile(range(100), 0.5)).toBe(50);
    expect(percentile(range(100), 0.95)).toBe(95);
    expect(percentile(range(100), 0.99)).toBe(99);
    expect(percentile(range(100), 1)).toBe(100);
  });

  it("returns an actual sample rather than interpolating", () => {
    // Nearest-rank for 4 samples at P50 is the 2nd value, not the 2.5 an interpolating method gives
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBe(50);
  });

  it("does not depend on input order and does not mutate it", () => {
    const input = [5, 1, 4, 2, 3];
    expect(percentile(input, 0.5)).toBe(3);
    expect(input).toEqual([5, 1, 4, 2, 3]);
  });

  it("handles ties", () => {
    expect(percentile([7, 7, 7, 7], 0.95)).toBe(7);
    expect(percentile([1, 2, 2, 2, 9], 0.5)).toBe(2);
  });

  it("handles tiny and empty inputs", () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([42], 0.01)).toBe(42);
    expect(percentile([42], 0.99)).toBe(42);
    // With fewer than 100 samples, P99 is simply the maximum
    expect(percentile(range(20), 0.99)).toBe(20);
  });

  it("is not thrown off by floating-point noise", () => {
    // 0.07 * 100 = 7.000000000000001 in JS; the rank must still be 7
    expect(percentile(range(100), 0.07)).toBe(7);
  });

  it("lands on the timeout value when more than 1% of checks time out", () => {
    const fast = Array.from({ length: 98 }, () => 10_000);
    expect(percentile([...fast, 20_000, 20_000], 0.99)).toBe(20_000);
    expect(percentile([...fast, 20_000, 20_000], 0.95)).toBe(10_000);
    // Exactly 1% timeouts leaves P99 on the slowest successful check
    expect(percentile([...fast, 12_000, 20_000], 0.99)).toBe(12_000);
  });
});
