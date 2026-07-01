// Tournament selection: pick `size` random individuals, return the fittest.
// Larger tournaments => stronger selection pressure (less diversity).

import { Rng } from '../engine/seedRandom';
import { Chromosome } from '../engine/types';

export function tournamentSelect(
  population: Chromosome[],
  fitness: Float64Array,
  size: number,
  rng: Rng,
): Chromosome {
  const n = population.length;
  let bestIndex = rng.int(n);
  let bestFitness = fitness[bestIndex];
  for (let k = 1; k < size; k++) {
    const i = rng.int(n);
    if (fitness[i] > bestFitness) {
      bestFitness = fitness[i];
      bestIndex = i;
    }
  }
  return population[bestIndex];
}
