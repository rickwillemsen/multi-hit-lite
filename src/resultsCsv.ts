import type { Metrics } from './core/metrics';
import type { RunResult } from './core/pipeline';
import type { ExclusionSummary } from './protocol';

const cell = (v: unknown) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (vals: unknown[]) => vals.map(cell).join(',');

export function combinationsCsv(r: RunResult): string {
  const out = [line(['step', 'gene_ids', 'size', 'objective_after_step', 'tumor_samples_covered_train', 'normal_coverings_train'])];
  r.steps.forEach((s, i) => {
    out.push(line([i + 1, r.combinationIds[i].join(' + '), s.combination.length, s.objective, s.tumorCovered, s.normalCovered]));
  });
  return out.join('\n') + '\n';
}

const SETTING_NAMES: Record<string, string> = {
  seed: 'random_seed',
  minHitSize: 'smallest_size',
  maxHitSize: 'largest_size',
  beta: 'max_gene_combinations',
  maxSelect: 'genes_to_choose_from',
  numCombinations: 'gene_combinations_to_try',
  testShare: 'test_share',
};

export function metricsCsv(r: RunResult, dataLabel: string, exclusion: ExclusionSummary | null): string {
  const m = (label: string, x: Metrics) => line([label, x.TP, x.TN, x.FP, x.FN, x.MCC, x.specificity, x.sensitivity, x.F1]);
  const out = [
    line(['set', 'TP', 'TN', 'FP', 'FN', 'MCC', 'specificity', 'sensitivity', 'F1']),
    m('train', r.train),
    m('test', r.test),
    '',
    line(['setting', 'value']),
    line(['data', dataLabel]),
    ...Object.entries(r.params).map(([k, v]) => line([SETTING_NAMES[k] ?? k, v])),
    line(['objective_train', r.objective]),
    line(['number_of_gene_combinations', r.combinations.length]),
    line(['stop_reason', r.stopReason]),
    line(['candidate_gene_combinations', r.numCandidates]),
    line(['exclusion_list', exclusion?.name ?? '']),
    line(['genes_excluded', r.excludedGenes]),
    line(['tumor_train', r.split.tumorTrain]),
    line(['tumor_test', r.split.tumorTest]),
    line(['normal_train', r.split.normalTrain]),
    line(['normal_test', r.split.normalTest]),
    line(['seconds', r.seconds.toFixed(2)]),
  ];
  return out.join('\n') + '\n';
}
