import { Data, splitTrainTestData } from './data';
import { SeededRandom } from './random';

/** A normal and a tumor matrix over the same genes. */
export class Instance {
  constructor(
    readonly name: string,
    readonly dataNormal: Data,
    readonly dataTumor: Data,
  ) {}
}

/** Stratified train/test split: tumor samples are split first, then normal samples. */
export function splitTrainTestInstance(instance: Instance, percTest: number, rnd: SeededRandom) {
  const tumor = splitTrainTestData(instance.dataTumor, percTest, rnd);
  const normal = splitTrainTestData(instance.dataNormal, percTest, rnd);
  return {
    train: new Instance(instance.name + '_train', normal.train, tumor.train),
    test: new Instance(instance.name + '_test', normal.test, tumor.test),
    tumorTrainIdx: tumor.trainIdx,
    tumorTestIdx: tumor.testIdx,
    normalTrainIdx: normal.trainIdx,
    normalTestIdx: normal.testIdx,
  };
}
