/** Settings of a run. */
export interface Params {
  seed: number; // random seed for the split and the candidate generation
  minHitSize: number; // smallest number of genes per gene combination
  maxHitSize: number; // largest number of genes per gene combination
  beta: number; // maximum number of gene combinations in the result
  maxSelect: number; // number of most frequent tumor genes used
  numCombinations: number; // random gene combinations to try
  testShare: number; // share of samples used for testing
}

export const DEFAULT_PARAMS: Params = {
  seed: 42,
  minHitSize: 2,
  maxHitSize: 3,
  beta: 10,
  maxSelect: 100,
  numCombinations: 100000,
  testShare: 0.25,
};

export function checkParams(p: Params): string[] {
  const errors: string[] = [];
  const int = (v: number, name: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isInteger(v) || v < min || v > max) errors.push(`${name} must be a whole number between ${min} and ${max}.`);
  };
  int(p.seed, 'Seed', -Number.MAX_SAFE_INTEGER);
  int(p.minHitSize, 'Smallest size', 1, 100);
  int(p.maxHitSize, 'Largest size', 1, 100);
  if (p.maxHitSize < p.minHitSize) errors.push('Largest size must be at least the smallest size.');
  int(p.beta, 'Maximum number of gene combinations in the result', 1, 10000);
  int(p.maxSelect, 'Genes to choose from', 1, 100000);
  int(p.numCombinations, 'Random gene combinations to try', 1, 2000000);
  if (!Number.isFinite(p.testShare) || p.testShare < 0 || p.testShare >= 1) errors.push('Share of samples used for testing must be at least 0 and below 1.');
  return errors;
}
