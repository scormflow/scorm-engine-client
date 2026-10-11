import { describe, expect, it } from 'vitest';
import { computeBackoff, parseRateLimit, parseRetryAfter, sleep } from './retry.js';

describe('parseRateLimit', () => {
  it('reads the X-RateLimit-* headers', () => {
    const headers = new Headers({
      'x-ratelimit-limit': '600',
      'x-ratelimit-remaining': '12',
      'x-ratelimit-reset': '41',
    });
    expect(parseRateLimit(headers)).toEqual({ limit: 600, remaining: 12, resetSeconds: 41 });
  });

  it('returns null when limiting is off or a header is missing / malformed', () => {
    expect(parseRateLimit(new Headers())).toBeNull();
    expect(parseRateLimit(new Headers({ 'x-ratelimit-limit': '600', 'x-ratelimit-remaining': '1' }))).toBeNull();
    expect(
      parseRateLimit(
        new Headers({ 'x-ratelimit-limit': 'lots', 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': '2' }),
      ),
    ).toBeNull();
  });
});

describe('computeBackoff', () => {
  it('grows exponentially up to maxMs', () => {
    expect(computeBackoff({ baseMs: 100, maxMs: 10_000, attempt: 1, jitter: false })).toBe(100);
    expect(computeBackoff({ baseMs: 100, maxMs: 10_000, attempt: 2, jitter: false })).toBe(200);
    expect(computeBackoff({ baseMs: 100, maxMs: 10_000, attempt: 3, jitter: false })).toBe(400);
    expect(computeBackoff({ baseMs: 100, maxMs: 10_000, attempt: 4, jitter: false })).toBe(800);
  });

  it('caps growth at maxMs', () => {
    expect(computeBackoff({ baseMs: 1000, maxMs: 2000, attempt: 5, jitter: false })).toBe(2000);
  });

  it('uses the injected random fn when jitter is on', () => {
    const value = computeBackoff({
      baseMs: 100,
      maxMs: 10_000,
      attempt: 4,
      jitter: true,
      random: () => 0.5,
    });
    expect(value).toBe(400);
  });

  it('floors jittered values', () => {
    const value = computeBackoff({
      baseMs: 100,
      maxMs: 10_000,
      attempt: 1,
      jitter: true,
      random: () => 0.999,
    });
    expect(Number.isInteger(value)).toBe(true);
  });

  it('treats attempt <= 0 as the first attempt', () => {
    expect(computeBackoff({ baseMs: 100, maxMs: 10_000, attempt: 0, jitter: false })).toBe(100);
    expect(computeBackoff({ baseMs: 100, maxMs: 10_000, attempt: -3, jitter: false })).toBe(100);
  });
});

describe('parseRetryAfter', () => {
  it('returns null for missing header', () => {
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('parses seconds as a number', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP-date and returns milliseconds from now', () => {
    const future = new Date('2030-01-01T00:00:30Z').toUTCString();
    const result = parseRetryAfter(future, () => Date.parse('2030-01-01T00:00:00Z'));
    expect(result).toBe(30_000);
  });

  it('clamps past dates to 0', () => {
    const past = new Date('2000-01-01T00:00:00Z').toUTCString();
    const result = parseRetryAfter(past, () => Date.parse('2030-01-01T00:00:00Z'));
    expect(result).toBe(0);
  });

  it('returns null for garbage', () => {
    expect(parseRetryAfter('not-a-date-or-number')).toBeNull();
  });
});

describe('sleep', () => {
  it('resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('resolves immediately for non-positive delays', async () => {
    const start = Date.now();
    await sleep(0);
    await sleep(-100);
    expect(Date.now() - start).toBeLessThan(10);
  });

  it('rejects when the signal is aborted mid-sleep', async () => {
    const controller = new AbortController();
    const p = sleep(1000, controller.signal);
    controller.abort();
    await expect(p).rejects.toBeDefined();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toBeDefined();
  });
});
