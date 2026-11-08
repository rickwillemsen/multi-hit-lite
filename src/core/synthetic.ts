import { SeededRandom } from './random';

export interface SyntheticParams {
  seed: number;
  numGenes: number;
  numTumor: number;
  numNormal: number;
  /** Average chance that a gene is mutated in a tumor sample (background noise). */
  tumorRate: number;
  /** Average chance that a gene is mutated in a normal sample (background noise). */
  normalRate: number;
  /** Planted gene combinations that mark tumor samples. */
  numPatterns: number;
  patternMinSize: number;
  patternMaxSize: number;
  /** Share of tumor samples that carry each planted combination. */
  tumorPrevalence: number;
  /** Share of normal samples that carry each planted combination. */
  normalPrevalence: number;
}

export const DEFAULT_SYNTHETIC: SyntheticParams = {
  seed: 42,
  numGenes: 2000,
  numTumor: 300,
  numNormal: 300,
  tumorRate: 0.05,
  normalRate: 0.03,
  numPatterns: 5,
  patternMinSize: 2,
  patternMaxSize: 3,
  tumorPrevalence: 0.15,
  normalPrevalence: 0.01,
};

export interface PlantedPattern {
  geneIds: string[];
  tumorSamples: number;
  normalSamples: number;
}

export interface SyntheticResult {
  normalCsv: string;
  tumorCsv: string;
  patterns: PlantedPattern[];
}

export function checkSyntheticParams(p: SyntheticParams): string[] {
  const errors: string[] = [];
  const int = (v: number, name: string, min: number, max: number) => {
    if (!Number.isInteger(v) || v < min || v > max) errors.push(`${name} must be a whole number between ${min} and ${max}.`);
  };
  const share = (v: number, name: string) => {
    if (!Number.isFinite(v) || v < 0 || v > 1) errors.push(`${name} must be between 0 and 1.`);
  };
  int(p.seed, 'Seed', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  int(p.numGenes, 'Number of genes', 1, 60000);
  int(p.numTumor, 'Tumor samples', 1, 5000);
  int(p.numNormal, 'Normal samples', 1, 5000);
  int(p.numPatterns, 'Number of planted gene combinations', 0, 1000);
  int(p.patternMinSize, 'Smallest planted size', 1, 50);
  int(p.patternMaxSize, 'Largest planted size', 1, 50);
  if (p.patternMaxSize < p.patternMinSize) errors.push('Largest planted size must be at least the smallest.');
  if (p.numPatterns * p.patternMaxSize > p.numGenes) errors.push('Not enough genes for the planted combinations.');
  share(p.tumorRate, 'Tumor background rate');
  share(p.normalRate, 'Normal background rate');
  share(p.tumorPrevalence, 'Share of tumor samples with each planted gene combination');
  share(p.normalPrevalence, 'Share of normal samples with each planted gene combination');
  if (p.numGenes * (p.numTumor + p.numNormal) > 60_000_000) errors.push('That is too much data for the browser; use fewer genes or samples.');
  return errors;
}

export function geneId(i: number, numGenes: number): string {
  return 'SYN' + String(i + 1).padStart(Math.max(5, String(numGenes).length), '0');
}

/**
 * Makes a normal and a tumor file in the input file format.
 * Each gene gets its own mutation rate (exponentially spread around the average, so a few genes are frequent),
 * then the planted combinations are switched on in a share of the samples.
 */
export function generateSynthetic(p: SyntheticParams): SyntheticResult {
  const rnd = new SeededRandom(p.seed);
  const G = p.numGenes;
  const geneFactor = new Float64Array(G);
  for (let g = 0; g < G; g++) geneFactor[g] = 0.25 + 1.5 * rnd.nextDouble();

  const tumor = makeMatrix(G, p.numTumor);
  const normal = makeMatrix(G, p.numNormal);
  fillBackground(tumor, geneFactor, p.tumorRate, rnd);
  fillBackground(normal, geneFactor, p.normalRate, rnd);

  // Planted combinations use distinct genes
  const pool = Array.from({ length: G }, (_, i) => i);
  for (let i = G - 1; i > 0; i--) {
    const j = rnd.nextInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let next = 0;
  const patterns: PlantedPattern[] = [];
  for (let k = 0; k < p.numPatterns; k++) {
    const size = p.patternMinSize + rnd.nextInt(p.patternMaxSize - p.patternMinSize + 1);
    const genes = pool.slice(next, next + size).sort((a, b) => a - b);
    next += size;
    const plant = (m: Uint8Array[], n: number, share: number) => {
      let count = 0;
      for (let s = 0; s < n; s++) {
        if (rnd.nextDouble() < share) {
          for (const g of genes) m[g][s] = 1;
          count++;
        }
      }
      return count;
    };
    const tumorSamples = plant(tumor, p.numTumor, p.tumorPrevalence);
    const normalSamples = plant(normal, p.numNormal, p.normalPrevalence);
    patterns.push({ geneIds: genes.map((g) => geneId(g, G)), tumorSamples, normalSamples });
  }

  return { normalCsv: toCsv(normal, p.numNormal, G), tumorCsv: toCsv(tumor, p.numTumor, G), patterns };
}

function makeMatrix(G: number, n: number): Uint8Array[] {
  return Array.from({ length: G }, () => new Uint8Array(n));
}

function fillBackground(m: Uint8Array[], factor: Float64Array, rate: number, rnd: SeededRandom) {
  for (let g = 0; g < m.length; g++) {
    const pr = Math.min(0.95, rate * factor[g]);
    const row = m[g];
    for (let s = 0; s < row.length; s++) if (rnd.nextDouble() < pr) row[s] = 1;
  }
}

function toCsv(m: Uint8Array[], n: number, G: number): string {
  const lines: string[] = [`${G},${n}`];
  for (let g = 0; g < G; g++) lines.push(`${g},${geneId(g, G)},${Array.prototype.join.call(m[g], ',')}`);
  return lines.join('\n') + '\n';
}
