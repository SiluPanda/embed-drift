/** Compute the dot product of two equal-length vectors. */
export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/** Compute the L2 (Euclidean) norm of a vector. */
export function l2Norm(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector has zero norm.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const normA = l2Norm(a);
  const normB = l2Norm(b);
  if (normA === 0 || normB === 0) return 0;
  const sim = dotProduct(a, b) / (normA * normB);
  // Clamp to [-1, 1] to guard against floating-point rounding errors
  return Math.max(-1, Math.min(1, sim));
}

/**
 * Compute cosine distance between two vectors (1 - cosineSimilarity).
 * Result is clamped to [0, 2].
 */
export function cosineDistance(a: number[], b: number[]): number {
  return Math.max(0, Math.min(2, 1 - cosineSimilarity(a, b)));
}

/** Compute the element-wise mean (centroid) of a set of vectors. */
export function elementWiseMean(vectors: number[][]): number[] {
  const d = vectors[0].length;
  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < d; i++) {
      mean[i] += v[i];
    }
  }
  const n = vectors.length;
  for (let i = 0; i < d; i++) {
    mean[i] /= n;
  }
  return mean;
}

/** Compute per-dimension variance given vectors and their precomputed mean. */
export function elementWiseVariance(vectors: number[][], mean: number[]): number[] {
  const d = mean.length;
  const variance = new Array<number>(d).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < d; i++) {
      const diff = v[i] - mean[i];
      variance[i] += diff * diff;
    }
  }
  const n = vectors.length;
  for (let i = 0; i < d; i++) {
    variance[i] /= n;
  }
  return variance;
}

/**
 * Reservoir sampling (Algorithm R): selects k items uniformly at random
 * from an array in a single pass.
 */
export function reservoirSample<T>(items: T[], k: number): T[] {
  const result: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i < k) {
      result.push(items[i]);
    } else {
      const j = Math.floor(Math.random() * (i + 1));
      if (j < k) {
        result[j] = items[i];
      }
    }
  }
  return result;
}
