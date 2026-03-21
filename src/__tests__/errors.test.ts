import { describe, it, expect } from 'vitest';
import { DriftError } from '../errors';
import type { DriftErrorCode } from '../errors';

describe('DriftError', () => {
  it('extends Error', () => {
    const err = new DriftError('test message', 'EMPTY_INPUT');
    expect(err instanceof Error).toBe(true);
  });

  it('is instanceof DriftError', () => {
    const err = new DriftError('test message', 'EMPTY_INPUT');
    expect(err instanceof DriftError).toBe(true);
  });

  it('has name DriftError', () => {
    const err = new DriftError('test message', 'EMPTY_INPUT');
    expect(err.name).toBe('DriftError');
  });

  it('stores the message correctly', () => {
    const err = new DriftError('something went wrong', 'NO_BASELINE');
    expect(err.message).toBe('something went wrong');
  });

  it('stores the code as a readable property', () => {
    const err = new DriftError('test', 'EMBED_FN_FAILED');
    expect(err.code).toBe('EMBED_FN_FAILED');
  });

  it('has correct prototype chain for catch blocks', () => {
    const err = new DriftError('proto test', 'INVALID_SNAPSHOT');
    expect(Object.getPrototypeOf(err)).toBe(DriftError.prototype);
  });

  const allCodes: DriftErrorCode[] = [
    'EMPTY_INPUT',
    'INCONSISTENT_DIMENSIONS',
    'INCOMPATIBLE_DIMENSIONS',
    'NO_BASELINE',
    'INVALID_SNAPSHOT',
    'NO_CANARY_BASELINE',
    'EMBED_FN_FAILED',
  ];

  it('covers all 7 error codes', () => {
    expect(allCodes).toHaveLength(7);
  });

  allCodes.forEach((code) => {
    it(`constructs correctly with code ${code}`, () => {
      const err = new DriftError(`error: ${code}`, code);
      expect(err.code).toBe(code);
      expect(err.message).toBe(`error: ${code}`);
      expect(err.name).toBe('DriftError');
      expect(err instanceof DriftError).toBe(true);
      expect(err instanceof Error).toBe(true);
    });
  });

  it('can be caught as Error', () => {
    let caught: Error | null = null;
    try {
      throw new DriftError('catch test', 'NO_BASELINE');
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught instanceof Error).toBe(true);
    expect(caught instanceof DriftError).toBe(true);
  });
});
