import type { Project } from '../core/types';

/*
 * Dernières générations aléatoires (3), gardées dans le navigateur avec une miniature,
 * pour revenir à une proposition précédente depuis le panneau « Modèles de parcs ».
 */

export interface RecentPark {
  at: number;
  name: string;
  modules: number;
  capacity: number;
  total: number;
  thumb: string;
  project: Project;
}

const KEY = 'parkcraft.recent';
/** 3 dernières générations par mode (piscine d'un côté, lacs et sites réels de l'autre). */
const MAX = 3;
export type Mode = 'pool' | 'lake';
export const modeOf = (p: Project): Mode => (p.site.kind === 'pool' ? 'pool' : 'lake');

/** Dernières générations du mode demandé (ou toutes). */
export function loadRecent(mode?: Mode): RecentPark[] {
  const all = loadAll();
  return mode ? all.filter((r) => modeOf(r.project) === mode).slice(0, MAX) : all;
}

function loadAll(): RecentPark[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((r) => r?.project?.modules) : [];
  } catch {
    return [];
  }
}

function save(list: RecentPark[]) {
  // miniatures comprises : si le stockage est plein, on retire les plus anciennes
  for (let n = list.length; n > 0; n--) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, n)));
      return;
    } catch {
      /* quota */
    }
  }
}

/** Réduit une capture d'écran (data URL) en miniature JPEG. */
export function thumbnail(dataUrl: string, w = 320, h = 180): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      // recadrage centré au format 16:9
      const r = Math.max(w / img.width, h / img.height);
      const sw = w / r,
        sh = h / r;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

export function pushRecent(r: RecentPark) {
  const list = loadAll().filter((x) => x.name !== r.name);
  list.unshift(r);
  // on garde les 3 plus récentes de chaque mode
  const keep = (['pool', 'lake'] as Mode[]).flatMap((m) => list.filter((x) => modeOf(x.project) === m).slice(0, MAX));
  save(list.filter((x) => keep.includes(x)));
}
