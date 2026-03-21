import { writeFileSync, readFileSync } from 'node:fs';
import { DriftError } from './errors';
import type { Snapshot } from './types';

/** Write a snapshot as pretty-printed JSON to a file path. */
export function saveSnapshot(snapshot: Snapshot, filePath: string): void {
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
}

/** Load and validate a snapshot from a JSON file. */
export function loadSnapshot(filePath: string): Snapshot {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new DriftError(
      `Failed to read snapshot file: ${(err as Error).message}`,
      'INVALID_SNAPSHOT',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DriftError('Snapshot file is not valid JSON.', 'INVALID_SNAPSHOT');
  }

  return validateSnapshot(parsed);
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'number');
}

function isNumberMatrix(v: unknown): v is number[][] {
  return Array.isArray(v) && v.every((row) => isNumberArray(row));
}

/** Validate a parsed object against the Snapshot schema. */
export function validateSnapshot(obj: unknown): Snapshot {
  if (typeof obj !== 'object' || obj === null) {
    throw new DriftError('Snapshot is not an object.', 'INVALID_SNAPSHOT');
  }

  const s = obj as Record<string, unknown>;

  const requiredStrings = ['id', 'createdAt', 'modelId'];
  for (const key of requiredStrings) {
    if (typeof s[key] !== 'string') {
      throw new DriftError(`Snapshot missing or invalid field: ${key}`, 'INVALID_SNAPSHOT');
    }
  }

  const requiredNumbers = ['dimensionality', 'sampleCount', 'meanPairwiseSimilarity', 'stdPairwiseSimilarity'];
  for (const key of requiredNumbers) {
    if (typeof s[key] !== 'number') {
      throw new DriftError(`Snapshot missing or invalid field: ${key}`, 'INVALID_SNAPSHOT');
    }
  }

  const dim = s['dimensionality'] as number;

  if (!isNumberArray(s['centroid'])) {
    throw new DriftError('Snapshot missing or invalid field: centroid', 'INVALID_SNAPSHOT');
  }
  if ((s['centroid'] as number[]).length !== dim) {
    throw new DriftError('Snapshot centroid length does not match dimensionality.', 'INVALID_SNAPSHOT');
  }

  if (!isNumberArray(s['variance'])) {
    throw new DriftError('Snapshot missing or invalid field: variance', 'INVALID_SNAPSHOT');
  }
  if ((s['variance'] as number[]).length !== dim) {
    throw new DriftError('Snapshot variance length does not match dimensionality.', 'INVALID_SNAPSHOT');
  }

  if (!isNumberArray(s['similarityHistogram'])) {
    throw new DriftError('Snapshot missing or invalid field: similarityHistogram', 'INVALID_SNAPSHOT');
  }
  if ((s['similarityHistogram'] as number[]).length !== 20) {
    throw new DriftError('Snapshot similarityHistogram must have exactly 20 bins.', 'INVALID_SNAPSHOT');
  }

  if (!isNumberMatrix(s['sampleVectors'])) {
    throw new DriftError('Snapshot missing or invalid field: sampleVectors', 'INVALID_SNAPSHOT');
  }

  return s as unknown as Snapshot;
}
