import type { Site } from '../core/types';
import type { GenParams } from './generator';

/** Modèles de parcs prêts à l'emploi (générés de manière déterministe à partir d'une graine). */
export interface Template {
  id: string;
  name: string;
  desc: string;
  site: Site;
  params: GenParams;
}

export const TEMPLATES: Template[] = [
  {
    id: 'kids-lagoon',
    name: 'Kids Lagoon',
    desc: 'Petit parc enfants 6–12 ans, boucle sans goulet, modules bas.',
    site: { length: 50, width: 35, depth: 2.6 },
    params: { audience: 'kids', capacity: 35, intensity: 1, loop: true, bigSlide: false, standalones: false, seed: 'kids-lagoon' },
  },
  {
    id: 'family-beach',
    name: 'Family Beach',
    desc: 'Parc de plage familial ~90 pers., boucle et toboggan de fin.',
    site: { length: 80, width: 55, depth: 3.5 },
    params: { audience: 'family', capacity: 90, intensity: 3, loop: true, bigSlide: true, standalones: false, seed: 'family-beach-4' },
  },
  {
    id: 'aqua-track',
    name: 'AquaTrack',
    desc: 'Parcours d’obstacles linéaire pour piscine ou petit lac.',
    site: { length: 60, width: 30, depth: 2.5 },
    params: { audience: 'mixed', capacity: 45, intensity: 3, loop: false, bigSlide: false, standalones: false, seed: 'aquatrack-1' },
  },
  {
    id: 'sportspark-xl',
    name: 'SportsPark XL',
    desc: 'Grand parc de lac ~160 pers., MatchTrack, grand toboggan, modules autonomes.',
    site: { length: 130, width: 80, depth: 4 },
    params: { audience: 'sport', capacity: 160, intensity: 4, loop: true, bigSlide: true, standalones: true, seed: 'sportspark-xl-7' },
  },
  {
    id: 'lake-resort',
    name: 'Lake Resort',
    desc: 'Parc d’hôtel / camping mixte ~120 pers. avec activités autonomes.',
    site: { length: 100, width: 70, depth: 3.6 },
    params: { audience: 'mixed', capacity: 120, intensity: 3, loop: true, bigSlide: true, standalones: true, seed: 'lake-resort-2' },
  },
];
