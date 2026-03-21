import { randomUUID } from 'node:crypto';
import { DriftError } from './errors';
import type { Snapshot, SnapshotOptions } from './types';
import {
  elementWiseMean,
  elementWiseVariance,
  cosineSimilarity,
  reservoirSample,
} from './math';

/** Create a snapshot from a set of embedding vectors. */
export function createSnapshot(
  embeddings: number[][],
  modelId: string,
  options: SnapshotOptions = {},
): Snapshot {
  if (embeddings.length < 2) {
    throw new DriftError(
      'At least 2 embedding vectors are required to create a snapshot.',
      'EMPTY_INPUT',
    );
  }

  const dim = embeddings[0].length;
  for (let i = 1; i < embeddings.length; i++) {
    if (embeddings[i].length !== dim) {
      throw new DriftError(
        `Inconsistent vector dimensions: expected ${dim}, got ${embeddings[i].length} at index ${i}.`,
        'INCONSISTENT_DIMENSIONS',
      );
    }
  }

  const centroid = elementWiseMean(embeddings);
  const variance = elementWiseVariance(embeddings, centroid);

  // Pairwise cosine similarity estimation
  const maxPairs = options.sampleSize !== undefined
    ? Math.min(options.sampleSize * 10, 500)
    : 500;
  const n = embeddings.length;
  const totalPossiblePairs = (n * (n - 1)) / 2;
  const pairCount = Math.min(maxPairs, totalPossiblePairs);

  const similarities: number[] = [];

  if (totalPossiblePairs <= pairCount) {
    // Compute all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        similarities.push(cosineSimilarity(embeddings[i], embeddings[j]));
      }
    }
  } else {
    // Sample random pairs
    const seen = new Set<string>();
    let attempts = 0;
    while (similarities.length < pairCount && attempts < pairCount * 10) {
      attempts++;
      const i = Math.floor(Math.random() * n);
      let j = Math.floor(Math.random() * n);
      while (j === i) j = Math.floor(Math.random() * n);
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        similarities.push(cosineSimilarity(embeddings[i], embeddings[j]));
      }
    }
  }

  const meanPairwiseSimilarity =
    similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 0;

  const stdPairwiseSimilarity =
    similarities.length > 1
      ? Math.sqrt(
          similarities.reduce((acc, s) => acc + (s - meanPairwiseSimilarity) ** 2, 0) /
            similarities.length,
        )
      : 0;

  // Similarity histogram: 20 bins from -1.0 to 1.0
  const NUM_BINS = 20;
  const histogram = new Array<number>(NUM_BINS).fill(0);
  for (const s of similarities) {
    // Map [-1, 1] to [0, 20)
    const binIdx = Math.min(
      NUM_BINS - 1,
      Math.floor(((s + 1) / 2) * NUM_BINS),
    );
    histogram[binIdx]++;
  }
  if (similarities.length > 0) {
    for (let i = 0; i < NUM_BINS; i++) {
      histogram[i] /= similarities.length;
    }
  }

  // Reservoir sample of vectors
  const sampleSize = options.sampleSize ?? 50;
  const sampleVectors = reservoirSample(embeddings, Math.min(sampleSize, n));

  const snapshot: Snapshot = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    modelId,
    dimensionality: dim,
    sampleCount: n,
    centroid,
    variance,
    meanPairwiseSimilarity,
    stdPairwiseSimilarity,
    similarityHistogram: histogram,
    sampleVectors,
    metadata: options.metadata ?? {},
  };

  return snapshot;
}
