import { describe, it, expect } from 'vitest';
import { DEFAULT_CANARY_TEXTS } from '../constants';

describe('DEFAULT_CANARY_TEXTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(DEFAULT_CANARY_TEXTS)).toBe(true);
    expect(DEFAULT_CANARY_TEXTS.length).toBeGreaterThan(0);
  });

  it('has at least 5 entries', () => {
    expect(DEFAULT_CANARY_TEXTS.length).toBeGreaterThanOrEqual(5);
  });

  it('has exactly 25 entries per the SPEC', () => {
    expect(DEFAULT_CANARY_TEXTS).toHaveLength(25);
  });

  it('each entry is a non-empty string', () => {
    DEFAULT_CANARY_TEXTS.forEach((text, index) => {
      expect(typeof text, `entry ${index} should be a string`).toBe('string');
      expect(text.length, `entry ${index} should be non-empty`).toBeGreaterThan(0);
    });
  });

  it('all entries are unique', () => {
    const unique = new Set(DEFAULT_CANARY_TEXTS);
    expect(unique.size).toBe(DEFAULT_CANARY_TEXTS.length);
  });

  it('contains texts from technical documentation domain', () => {
    const hastech = DEFAULT_CANARY_TEXTS.some(t => t.includes('embedding vectors'));
    expect(hastech).toBe(true);
  });

  it('contains texts from scientific domain', () => {
    const hasSci = DEFAULT_CANARY_TEXTS.some(t => t.includes('Quantum entanglement'));
    expect(hasSci).toBe(true);
  });

  it('contains texts from legal domain', () => {
    const hasLegal = DEFAULT_CANARY_TEXTS.some(t => t.includes('binding arbitration'));
    expect(hasLegal).toBe(true);
  });

  it('is frozen / does not change identity across imports', async () => {
    const { DEFAULT_CANARY_TEXTS: reimported } = await import('../constants');
    expect(reimported).toBe(DEFAULT_CANARY_TEXTS);
  });
});
