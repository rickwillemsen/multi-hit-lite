import { SeededRandom, shuffle } from './random';

/**
 * Binary gene x sample matrix, stored as one bitset per gene
 * (`mat[g][s]` is bit s of row g).
 */
export class Data {
  readonly words: number;
  readonly bits: Uint32Array;

  constructor(
    readonly name: string,
    readonly numGenes: number,
    readonly numSamples: number,
    readonly geneIds: string[],
    bits?: Uint32Array,
  ) {
    this.words = Math.max(1, Math.ceil(numSamples / 32));
    this.bits = bits ?? new Uint32Array(numGenes * this.words);
  }

  get(g: number, s: number): boolean {
    return (this.bits[g * this.words + (s >>> 5)] & (1 << (s & 31))) !== 0;
  }

  set(g: number, s: number): void {
    this.bits[g * this.words + (s >>> 5)] |= 1 << (s & 31);
  }

  row(g: number): Uint32Array {
    return this.bits.subarray(g * this.words, (g + 1) * this.words);
  }

  rowCount(g: number): number {
    let c = 0;
    const off = g * this.words;
    for (let w = 0; w < this.words; w++) c += popcount(this.bits[off + w]);
    return c;
  }

  numMutations(): number {
    let c = 0;
    for (let i = 0; i < this.bits.length; i++) c += popcount(this.bits[i]);
    return c;
  }

  /** Bitset of samples in which every gene of the combination is mutated. */
  coverage(combination: readonly number[], out?: Uint32Array): Uint32Array {
    const res = out ?? new Uint32Array(this.words);
    const first = combination[0] * this.words;
    for (let w = 0; w < this.words; w++) res[w] = this.bits[first + w];
    for (let k = 1; k < combination.length; k++) {
      const off = combination[k] * this.words;
      for (let w = 0; w < this.words; w++) res[w] &= this.bits[off + w];
    }
    return res;
  }

  /** Copy with the given gene rows set to all zeros (used for excluded genes). */
  withRowsCleared(rows: Iterable<number>): Data {
    const bits = this.bits.slice();
    for (const g of rows) bits.fill(0, g * this.words, (g + 1) * this.words);
    return new Data(this.name, this.numGenes, this.numSamples, this.geneIds, bits);
  }

  /** New Data containing only the given samples, in that order. */
  selectSamples(name: string, sampleIdx: readonly number[]): Data {
    const out = new Data(name, this.numGenes, sampleIdx.length, this.geneIds);
    for (let g = 0; g < this.numGenes; g++) {
      for (let i = 0; i < sampleIdx.length; i++) {
        if (this.get(g, sampleIdx[i])) out.set(g, i);
      }
    }
    return out;
  }
}

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) as number;
}

export function popcountAll(bits: Uint32Array): number {
  let c = 0;
  for (let i = 0; i < bits.length; i++) c += popcount(bits[i]);
  return c;
}

export function anyBit(bits: Uint32Array): boolean {
  for (let i = 0; i < bits.length; i++) if (bits[i] !== 0) return true;
  return false;
}

/** Random train/test split of the samples: shuffles the sample indices with the shared generator. */
export function splitTrainTestData(data: Data, percTest: number, rnd: SeededRandom): { train: Data; test: Data; trainIdx: number[]; testIdx: number[] } {
  const n = data.numSamples;
  const numTest = roundHalfUp(n * percTest);
  const numTrain = n - numTest;
  const indices = Array.from({ length: n }, (_, i) => i);
  shuffle(indices, rnd);
  const trainIdx = indices.slice(0, numTrain);
  const testIdx = indices.slice(numTrain, n);
  return {
    train: data.selectSamples(data.name + '_train', trainIdx),
    test: data.selectSamples(data.name + '_test', testIdx),
    trainIdx,
    testIdx,
  };
}

/** Rounds half up: floor(x + 0.5). */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
