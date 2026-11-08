import { anyBit, popcountAll } from './data';
import { Instance } from './instance';

/** Confusion matrix and derived performance scores. */
export interface Metrics {
  TP: number;
  TN: number;
  FP: number;
  FN: number;
  MCC: number;
  specificity: number;
  sensitivity: number;
  F1: number;
}

export function makeMetrics(TP: number, TN: number, FP: number, FN: number): Metrics {
  const specificity = TN + FP === 0 ? 0 : TN / (TN + FP);
  const sensitivity = TP + FN === 0 ? 0 : TP / (TP + FN);
  const precision = TP + FP === 0 ? 0 : TP / (TP + FP);
  const F1 = precision + sensitivity === 0 ? 0 : (2.0 * (precision * sensitivity)) / (precision + sensitivity);
  const numerator = TP * TN - FP * FN;
  const denominator = Math.sqrt((TP + FP) * (TP + FN) * (TN + FP) * (TN + FN));
  const MCC = denominator === 0 ? 0 : numerator / denominator;
  return { TP, TN, FP, FN, MCC, specificity, sensitivity, F1 };
}

/** A sample is predicted "tumor" when at least one combination covers it. */
export function evaluate(instance: Instance, combinations: number[][]): Metrics {
  const covered = (data: Instance['dataTumor']) => {
    if (combinations.length === 0) return 0;
    const union = new Uint32Array(data.words);
    const tmp = new Uint32Array(data.words);
    for (const c of combinations) {
      data.coverage(c, tmp);
      for (let w = 0; w < union.length; w++) union[w] |= tmp[w];
    }
    return anyBit(union) ? popcountAll(union) : 0;
  };
  const nT = instance.dataTumor.numSamples;
  const nN = instance.dataNormal.numSamples;
  const TP = covered(instance.dataTumor);
  const FP = covered(instance.dataNormal);
  return makeMetrics(TP, nN - FP, FP, nT - TP);
}
