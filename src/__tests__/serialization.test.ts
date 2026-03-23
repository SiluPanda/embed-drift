import { describe, it, expect, afterEach } from 'vitest';
import { saveSnapshot, loadSnapshot, validateSnapshot } from '../serialization';
import { DriftError } from '../errors';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Helper ────────────────────────────────────────────────────────────

const DIM = 3;

function makeSnapshot() {
  return {
    id: 'snap-001',
    createdAt: '2026-01-01T00:00:00Z',
    modelId: 'text-embedding-3-small',
    dimensionality: DIM,
    sampleCount: 5,
    centroid: [0.1, 0.2, 0.3],
    variance: [0.01, 0.02, 0.03],
    meanPairwiseSimilarity: 0.85,
    stdPairwiseSimilarity: 0.05,
    similarityHistogram: Array.from({ length: 20 }, () => 0.05),
    sampleVectors: [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('saveSnapshot / loadSnapshot', () => {
  let dir: string;

  function makeTmpDir(): string {
    dir = mkdtempSync(join(tmpdir(), 'embed-drift-test-'));
    return dir;
  }

  // Clean up temp directory after each test
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('saveSnapshot writes valid JSON', () => {
    const tmpDir = makeTmpDir();
    const filePath = join(tmpDir, 'snap.json');
    const snap = makeSnapshot();

    saveSnapshot(snap as unknown as import('../types').Snapshot, filePath);

    const raw = require('node:fs').readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(snap);
  });

  it('loadSnapshot reads back the same snapshot (round-trip)', () => {
    const tmpDir = makeTmpDir();
    const filePath = join(tmpDir, 'snap.json');
    const snap = makeSnapshot();

    saveSnapshot(snap as unknown as import('../types').Snapshot, filePath);
    const loaded = loadSnapshot(filePath);

    expect(loaded).toEqual(snap);
  });

  it('loadSnapshot throws INVALID_SNAPSHOT for malformed JSON', () => {
    const tmpDir = makeTmpDir();
    const filePath = join(tmpDir, 'bad.json');

    writeFileSync(filePath, 'this is not json!!!', 'utf-8');

    expect(() => loadSnapshot(filePath)).toThrowError(DriftError);
    try {
      loadSnapshot(filePath);
    } catch (e) {
      expect((e as DriftError).code).toBe('INVALID_SNAPSHOT');
    }
  });

  it('loadSnapshot throws INVALID_SNAPSHOT for missing required fields', () => {
    const tmpDir = makeTmpDir();
    const filePath = join(tmpDir, 'incomplete.json');

    const incomplete = { ...makeSnapshot() };
    delete (incomplete as Record<string, unknown>)['centroid'];
    writeFileSync(filePath, JSON.stringify(incomplete), 'utf-8');

    expect(() => loadSnapshot(filePath)).toThrowError(DriftError);
    try {
      loadSnapshot(filePath);
    } catch (e) {
      expect((e as DriftError).code).toBe('INVALID_SNAPSHOT');
    }
  });
});

describe('validateSnapshot', () => {
  it('throws for wrong field types (centroid as string instead of number[])', () => {
    const bad = {
      ...makeSnapshot(),
      centroid: 'not-an-array',
    };

    expect(() => validateSnapshot(bad)).toThrowError(DriftError);
    try {
      validateSnapshot(bad);
    } catch (e) {
      expect((e as DriftError).code).toBe('INVALID_SNAPSHOT');
    }
  });
});
