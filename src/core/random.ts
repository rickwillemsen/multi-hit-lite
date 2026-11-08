/**
 * Seeded pseudo-random number generator: a 48-bit linear congruential generator
 * (multiplier 0x5DEECE66D, increment 11), so a run can be repeated exactly from its seed.
 *
 * The 48-bit state is kept as two 24-bit halves so every intermediate product
 * stays below 2^53 and is exact in a JavaScript double.
 */
const TWO24 = 16777216; // 2^24
const MULT_HI = 0x5de; // 0x5DEECE66D >>> 24
const MULT_LO = 0xece66d; // 0x5DEECE66D & 0xFFFFFF
const ADDEND = 0xb;

export class SeededRandom {
  private hi = 0;
  private lo = 0;

  constructor(seed: number) {
    this.setSeed(seed);
  }

  /** Sets the seed (scrambled with the multiplier). Seed must be a safe integer. */
  setSeed(seed: number): void {
    if (!Number.isSafeInteger(seed)) throw new Error(`Seed must be an integer, got ${seed}`);
    // Take the low 48 bits of the (two's complement) seed.
    const big = BigInt.asUintN(48, BigInt(seed)) ^ 0x5deece66dn;
    this.hi = Number(big >> 24n);
    this.lo = Number(big & 0xffffffn);
  }

  /** Next `bits` random bits, 1 <= bits <= 32, as a signed 32-bit integer. */
  next(bits: number): number {
    const p = this.lo * MULT_LO + ADDEND;
    const newLo = p % TWO24;
    const carry = Math.floor(p / TWO24);
    const cross = this.hi * MULT_LO + this.lo * MULT_HI + carry;
    this.hi = cross % TWO24;
    this.lo = newLo;
    const value = Math.floor((this.hi * TWO24 + this.lo) / 2 ** (48 - bits));
    return value | 0;
  }

  nextInt(): number;
  nextInt(bound: number): number;
  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32);
    if (!Number.isInteger(bound) || bound <= 0 || bound > 0x7fffffff) {
      throw new Error(`bound must be a positive int, got ${bound}`);
    }
    let r = this.next(31);
    const m = bound - 1;
    if ((bound & m) === 0) {
      // power of two: take the high bits
      return Math.floor((bound * r) / 2147483648) | 0;
    }
    for (let u = r; ((u - (r = u % bound) + m) | 0) < 0; u = this.next(31));
    return r;
  }

  /** Uniform number in [0, 1) with 53 random bits. */
  nextDouble(): number {
    return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992;
  }
}

/** Fisher-Yates shuffle, in place. */
export function shuffle<T>(list: T[], rnd: SeededRandom): void {
  for (let i = list.length; i > 1; i--) {
    const j = rnd.nextInt(i);
    const tmp = list[i - 1];
    list[i - 1] = list[j];
    list[j] = tmp;
  }
}
