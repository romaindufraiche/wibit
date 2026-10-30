/** Générateur pseudo-aléatoire déterministe (mulberry32) : même graine => même parc. */
export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
  /** Ordre aléatoire pondéré (tirage sans remise). */
  weightedOrder<T>(items: { item: T; w: number }[]): T[];
}

export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    weightedOrder: (items) => {
      // Efraimidis–Spirakis : clé = u^(1/w)
      return items
        .filter((i) => i.w > 0)
        .map((i) => ({ i, k: Math.pow(next(), 1 / i.w) }))
        .sort((x, y) => y.k - x.k)
        .map((x) => x.i.item);
    },
  };
  return rng;
}

export function randomSeed(): string {
  const words = ['lagon', 'vague', 'corail', 'dune', 'rivage', 'atoll', 'ressac', 'marée', 'embrun', 'galet', 'crique', 'récif'];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}-${Math.floor(Math.random() * 9000 + 1000)}`;
}
