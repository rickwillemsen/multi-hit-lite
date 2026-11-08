import { popcount, popcountAll } from './data';
import { Instance } from './instance';
import { Candidates } from './generateGreedyGeneCombinations';
import { Params } from './params';

export interface GreedyStep {
  combination: number[];
  objective: number;
  tumorCovered: number;
  normalCovered: number;
}

/** One round of the greedy selection, recorded for the step-by-step visualization. */
export interface GreedyRound {
  /** Candidates checked this round: [candidate, new tumor samples covered, normal coverings, gain]. */
  evals: [number, number, number, number][];
  /** Candidate added this round, or -1 when the search stopped in this round. */
  chosen: number;
  /** Objective after this round. */
  objective: number;
}

export interface GreedyResult {
  combinations: number[][];
  objective: number;
  steps: GreedyStep[];
  stopReason: string;
}

/**
 * objective(S) = #tumor samples covered by S - sum over normal samples of #combinations covering it.
 * Coverage is computed with bitsets.
 */
export function greedy(
  instance: Instance,
  cand: Candidates,
  params: Params,
  onProgress?: (step: number) => void,
  trace?: GreedyRound[],
): GreedyResult {
  const { combinations, tumorCoverage } = cand;
  const n = combinations.length;
  const normal = instance.dataNormal;
  const words = instance.dataTumor.words;

  // Normal coverage count of each combination
  const normalCount = new Float64Array(n);
  const tmpN = new Uint32Array(normal.words);
  for (let c = 0; c < n; c++) normalCount[c] = popcountAll(normal.coverage(combinations[c], tmpN));

  // individual contribution of each candidate, in candidate order
  let order = Array.from({ length: n }, (_, i) => i);
  const value = new Float64Array(n).fill(NaN);

  const current: number[] = [];
  const inCurrent = new Uint8Array(n);
  const union = new Uint32Array(words);
  let normalSum = 0;
  let globalBestObjective = -Infinity;
  let globalBestObjectiveTumor = -Infinity;
  const steps: GreedyStep[] = [];
  let stopReason = '';

  const tumorWith = (c: number) => {
    const cov = tumorCoverage[c];
    let t = 0;
    for (let w = 0; w < words; w++) t += popcount(union[w] | cov[w]);
    return t;
  };

  for (;;) {
    let bestObjective = -Infinity;
    let bestContributionTumor = -Infinity;
    let bestCombination = -1;

    if (current.length >= params.beta) {
      stopReason = `Reached the maximum of ${params.beta} gene combinations.`;
      break;
    }

    const wasEmpty = current.length === 0;
    const prevTumor = wasEmpty ? 0 : globalBestObjectiveTumor;
    const prevObjective = wasEmpty ? 0 : globalBestObjective;
    const evals: [number, number, number, number][] = [];
    for (const c of order) {
      if (!wasEmpty && value[c] < bestContributionTumor) break;
      if (inCurrent[c]) continue;

      const tumor = tumorWith(c);
      const obj = tumor - (normalSum + normalCount[c]);
      if (trace) evals.push([c, tumor - prevTumor, normalCount[c], obj - prevObjective]);
      if (obj > bestObjective) {
        bestObjective = obj;
        bestCombination = c;
      }
      const contributionTumor = tumor - globalBestObjectiveTumor;
      if (contributionTumor > bestContributionTumor) bestContributionTumor = contributionTumor;
      if (wasEmpty) value[c] = tumor;
    }
    if (wasEmpty) {
      // stable sort by individual contribution, descending
      order = order.slice().sort((a, b) => (value[b] > value[a] ? 1 : value[b] < value[a] ? -1 : 0));
    }
    if (!wasEmpty && globalBestObjective === bestObjective) {
      stopReason = 'The objective did not improve any more.';
      trace?.push({ evals, chosen: -1, objective: globalBestObjective });
      break;
    }
    if (bestCombination >= 0) {
      current.push(bestCombination);
      inCurrent[bestCombination] = 1;
      const cov = tumorCoverage[bestCombination];
      for (let w = 0; w < words; w++) union[w] |= cov[w];
      normalSum += normalCount[bestCombination];
    } else {
      stopReason = 'No more gene combinations found.';
      trace?.push({ evals, chosen: -1, objective: wasEmpty ? 0 : globalBestObjective });
      break;
    }
    trace?.push({ evals, chosen: bestCombination, objective: bestObjective });

    globalBestObjective = bestObjective;
    globalBestObjectiveTumor = popcountAll(union);
    steps.push({
      combination: combinations[bestCombination],
      objective: bestObjective,
      tumorCovered: globalBestObjectiveTumor,
      normalCovered: normalSum,
    });
    onProgress?.(current.length);
  }

  const finalCombos = current.map((c) => combinations[c]);
  const objective = current.length === 0 ? 0 : popcountAll(union) - normalSum;
  return { combinations: finalCombos, objective, steps, stopReason };
}
