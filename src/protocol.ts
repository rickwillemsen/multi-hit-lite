import type { Issue } from './core/csv';
import type { Params } from './core/params';
import type { Progress, RunResult } from './core/pipeline';

export type Source = { kind: 'file'; file: File } | { kind: 'text'; text: string; name: string };

export type ToWorker =
  | { type: 'load'; normal: Source; tumor: Source; testShare: number }
  | { type: 'exclusion'; source: Source | null }
  | { type: 'run'; params: Params; trace: boolean };

export interface DataSummary {
  numGenes: number;
  normalSamples: number;
  tumorSamples: number;
}

/** Small datasets only: the matrices for the step-by-step visualization. */
export interface DataPreview {
  geneIds: string[];
  tumor: number[][];
  normal: number[][];
  /** Gene indices on the exclusion list. */
  excluded: number[];
}

export interface ExclusionSummary {
  name: string;
  idsInList: number;
  /** Genes of the loaded data that are on the list (null when no data is loaded). */
  matchedInData: number | null;
}

export type FromWorker =
  | { type: 'loaded'; ok: boolean; issues: Issue[]; summary?: DataSummary }
  | { type: 'exclusion'; ok: boolean; issues: Issue[]; summary: ExclusionSummary | null }
  | { type: 'progress'; progress: Progress }
  | { type: 'preview'; preview: DataPreview | null }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; message: string };
