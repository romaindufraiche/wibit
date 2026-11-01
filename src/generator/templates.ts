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
    site: { length: 180, width: 110, depth: 2.6 },
    params: { audience: 'kids', capacity: 35, intensity: 1, loop: true, bigSlide: false, standalones: false, seed: 'kids-lagoon' },
  },
  {
    id: 'family-beach',
    name: 'Family Beach',
    desc: 'Parc de plage familial ~90 pers., boucle et toboggan de fin.',
    site: { length: 260, width: 150, depth: 3.5 },
    params: { audience: 'family', capacity: 90, intensity: 3, loop: true, bigSlide: true, standalones: false, seed: 'family-beach-4' },
  },
  {
    id: 'aqua-track',
    name: 'AquaTrack',
    desc: 'Parcours d’obstacles linéaire pour petit lac.',
    site: { length: 200, width: 110, depth: 2.5 },
    params: { audience: 'mixed', capacity: 45, intensity: 3, loop: false, bigSlide: false, standalones: false, seed: 'aquatrack-1' },
  },
  {
    id: 'sportspark-xl',
    name: 'SportsPark XL',
    desc: 'Grand parc de lac ~160 pers., MatchTrack, grand toboggan, modules autonomes.',
    site: { length: 320, width: 180, depth: 4 },
    params: { audience: 'sport', capacity: 160, intensity: 4, loop: true, bigSlide: true, standalones: true, seed: 'sportspark-xl-7' },
  },
  {
    id: 'lake-resort',
    name: 'Lake Resort',
    desc: 'Parc d’hôtel / camping mixte ~120 pers. avec activités autonomes.',
    site: { length: 280, width: 160, depth: 3.6 },
    params: { audience: 'mixed', capacity: 120, intensity: 3, loop: true, bigSlide: true, standalones: true, seed: 'lake-resort-2' },
  },
  // ---------------------------------------------------------------- piscines
  {
    id: 'pool-kids',
    name: 'Mercredi des enfants',
    desc: 'Bassin de 25 m : parcours doux pour les 6–12 ans, modules bas, une surveillance.',
    site: { length: 25, width: 12.5, depth: 2, kind: 'pool' },
    params: { audience: 'kids', capacity: 20, intensity: 1, loop: false, bigSlide: false, standalones: false, seed: 'pool-kids-3' },
  },
  {
    id: 'pool-challenge',
    name: 'Challenge 25 m',
    desc: 'Parcours chronométré d’un bout à l’autre du bassin pour les ados et adultes.',
    site: { length: 25, width: 15, depth: 2, kind: 'pool' },
    params: { audience: 'sport', capacity: 28, intensity: 4, loop: false, bigSlide: false, standalones: false, course: true, seed: 'pool-challenge-2' },
  },
  {
    id: 'pool-family',
    name: 'Fun Pool 50 m',
    desc: 'Bassin olympique : parcours familial avec jonctions, tours et zones de saut.',
    site: { length: 50, width: 25, depth: 2.2, kind: 'pool' },
    params: { audience: 'family', capacity: 70, intensity: 3, loop: false, bigSlide: false, standalones: false, seed: 'pool-family-5' },
  },
  {
    id: 'pool-sport',
    name: 'SportsPool 50 m',
    desc: 'Bassin olympique profond : obstacles exigeants, tours et parcours en duel.',
    site: { length: 50, width: 25, depth: 3, kind: 'pool' },
    params: { audience: 'sport', capacity: 80, intensity: 5, loop: false, bigSlide: false, standalones: false, seed: 'pool-sport-1' },
  },
];
