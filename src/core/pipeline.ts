import { Data } from './data';
import { greedy, GreedyRound, GreedyStep } from './greedy';
import { Instance, splitTrainTestInstance } from './instance';
import { SeededRandom } from './random';
import { evaluate, Metrics } from './metrics';
import { Params } from './params';
import { generateGreedyGeneCombinations } from './generateGreedyGeneCombinations';

export interface RunResult {
  params: Params;
  combinations: number[][];
  combinationIds: string[][];
  objective: number;
  steps: GreedyStep[];
  stopReason: string;
  numCandidates: number;
  candidateIterations: number;
  excludedGenes: number;
  split: { tumorTrain: number; tumorTest: number; normalTrain: number; normalTest: number };
  train: Metrics;
  test: Metrics;
  seconds: number;
  /** Everything the step-by-step visualization needs; only for small runs. */
  trace?: VizTrace;
}

/** Limits for recording a trace; larger runs are not visualized. */
export const VIZ_LIMITS = { genes: 40, samplesPerClass: 60, candidates: 60 };

export interface VizTrace {
  geneIds: string[];
  /** Gene indices on the exclusion list (all zeros in the data). */
  excluded: number[];
  /** Matrices as rows of samples, one 0/1 value per gene, in file order. */
  tumor: number[][];
  normal: number[][];
  /** Sample indices (file order) in the training and test sets. */
  tumorTrain: number[];
  tumorTest: number[];
  normalTrain: number[];
  normalTest: number[];
  /** Accepted candidate gene combinations, in the order they were found. */
  candidates: number[][];
  rounds: GreedyRound[];
  /** Candidate indices of the selected gene combinations, in the order they were added. */
  chosen: number[];
}

/** Samples as rows of 0/1 values. */
export function sampleRows(d: Data): number[][] {
  return Array.from({ length: d.numSamples }, (_, s) => Array.from({ length: d.numGenes }, (_, g) => (d.get(g, s) ? 1 : 0)));
}

export type Progress = { phase: 'candidates'; found: number; iterations: number } | { phase: 'greedy'; step: number };

/** Gene rows whose ID is on the exclusion list. These rows are set to all zeros. */
export function excludedRows(geneIds: string[], excluded: ReadonlySet<string> | null): number[] {
  if (!excluded) return [];
  const rows: number[] = [];
  geneIds.forEach((id, g) => {
    if (excluded.has(id)) rows.push(g);
  });
  return rows;
}

/** A complete run: split, candidate generation, greedy selection and evaluation. */
export function runGreedyPipeline(
  normalRaw: Data,
  tumorRaw: Data,
  excluded: ReadonlySet<string> | null,
  params: Params,
  name = 'instance',
  onProgress?: (p: Progress) => void,
  wantTrace = false,
): RunResult {
  const t0 = performance.now();
  const rnd = new SeededRandom(params.seed);

  const rows = excludedRows(tumorRaw.geneIds, excluded);
  const normal = rows.length ? normalRaw.withRowsCleared(rows) : normalRaw;
  const tumor = rows.length ? tumorRaw.withRowsCleared(rows) : tumorRaw;
  const instance = new Instance(name, normal, tumor);

  const split = splitTrainTestInstance(instance, params.testShare, rnd);
  const cand = generateGreedyGeneCombinations(split.train, params, rnd, (found, iterations) => onProgress?.({ phase: 'candidates', found, iterations }));
  const traceOk =
    wantTrace &&
    tumor.numGenes <= VIZ_LIMITS.genes &&
    Math.max(tumor.numSamples, normal.numSamples) <= VIZ_LIMITS.samplesPerClass &&
    cand.combinations.length <= VIZ_LIMITS.candidates;
  const rounds: GreedyRound[] | undefined = traceOk ? [] : undefined;
  const g = greedy(split.train, cand, params, (step) => onProgress?.({ phase: 'greedy', step }), rounds);
  const byKey = new Map(cand.combinations.map((c, i) => [c.join(','), i]));
  const trace: VizTrace | undefined = rounds && {
    geneIds: tumor.geneIds,
    excluded: rows,
    tumor: sampleRows(tumor),
    normal: sampleRows(normal),
    tumorTrain: [...split.tumorTrainIdx].sort((a, b) => a - b),
    tumorTest: [...split.tumorTestIdx].sort((a, b) => a - b),
    normalTrain: [...split.normalTrainIdx].sort((a, b) => a - b),
    normalTest: [...split.normalTestIdx].sort((a, b) => a - b),
    candidates: cand.combinations,
    rounds,
    chosen: g.combinations.map((c) => byKey.get(c.join(','))!),
  };

  return {
    params,
    combinations: g.combinations,
    combinationIds: g.combinations.map((c) => c.map((i) => tumor.geneIds[i])),
    objective: g.objective,
    steps: g.steps,
    stopReason: g.stopReason,
    numCandidates: cand.combinations.length,
    candidateIterations: cand.iterations,
    excludedGenes: rows.length,
    split: {
      tumorTrain: split.train.dataTumor.numSamples,
      tumorTest: split.test.dataTumor.numSamples,
      normalTrain: split.train.dataNormal.numSamples,
      normalTest: split.test.dataNormal.numSamples,
    },
    train: evaluate(split.train, g.combinations),
    test: evaluate(split.test, g.combinations),
    seconds: (performance.now() - t0) / 1000,
    trace,
  };
}
