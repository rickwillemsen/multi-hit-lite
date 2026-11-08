import { anyBit } from './data';
import { Instance } from './instance';
import { SeededRandom, shuffle } from './random';
import { Params } from './params';

export interface Candidates {
  /** Combinations (sorted gene indices) in the order they were found. */
  combinations: number[][];
  /** Tumor (train) coverage bitset of each combination. */
  tumorCoverage: Uint32Array[];
  /** The maxSelect most frequently mutated tumor genes. */
  topIndices: number[];
  iterations: number;
}

/**
 * Generates the random candidate gene combinations the greedy heuristic chooses from.
 */
export function generateGreedyGeneCombinations(
  instance: Instance,
  params: Params,
  rnd: SeededRandom,
  onProgress?: (found: number, iterations: number) => void,
): Candidates {
  const dataTumor = instance.dataTumor;

  // Num times a gene appears; stable sort descending, ties stay in gene order.
  const counts = Array.from({ length: dataTumor.numGenes }, (_, g) => dataTumor.rowCount(g));
  const topIndices = counts
    .map((c, g) => ({ c, g }))
    .sort((a, b) => b.c - a.c)
    .slice(0, params.maxSelect)
    .map((e) => e.g);

  const seen = new Set<string>();
  const combinations: number[][] = [];
  const tumorCoverage: Uint32Array[] = [];

  let stuckInLoopIter = 0;
  let prev = -1;
  let iterations = 0;
  while (combinations.length < params.numCombinations) {
    if (combinations.length === prev) {
      stuckInLoopIter++;
      if (stuckInLoopIter >= 1000) break; // stop after 1000 tries in a row without a new candidate
    } else {
      stuckInLoopIter = 0;
    }
    prev = combinations.length;
    iterations++;

    const size = params.minHitSize + rnd.nextInt(params.maxHitSize - params.minHitSize + 1);

    const shuffled = topIndices.slice();
    shuffle(shuffled, rnd);

    const combination = shuffled.slice(0, Math.min(size, shuffled.length)).sort((a, b) => a - b);

    // Only add a combination if it is present in at least 1 tumor sample
    const cov = dataTumor.coverage(combination);
    if (anyBit(cov)) {
      const key = combination.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        combinations.push(combination);
        tumorCoverage.push(cov);
      }
    }

    if (onProgress && (iterations & 4095) === 0) onProgress(combinations.length, iterations);
  }
  onProgress?.(combinations.length, iterations);
  return { combinations, tumorCoverage, topIndices, iterations };
}
