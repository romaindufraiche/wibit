// Jeu d'icônes maison : trait 2 px, aplats légers (classe « f ») pour un rendu plus graphique.
// Les aplats prennent la couleur du texte à 22 % d'opacité.
const F = 'fill="currentColor" fill-opacity="0.22" stroke="none"';
const S = 'fill="currentColor" stroke="none"';

const P: Record<string, string> = {
  cursor: `<path d="M5 3.5l13.5 6.2-5.6 1.8-1.9 5.8z" ${S}/><path d="M13 13l5.5 5.5"/>`,
  pen: `<path d="M4 20l1.2-4.6L16.6 4a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8z" ${F}/><path d="M4 20l1.2-4.6L16.6 4a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8zM14.5 6l3.5 3.5"/>`,
  shore: `<path d="M2 21v-4c3 0 4-3 7-3s4 3 7 3 4-2 6-2v6z" ${F}/><path d="M2 17c3 0 4-3 7-3s4 3 7 3 4-2 6-2"/><rect x="4" y="5" width="4" height="4" ${S}/><rect x="16" y="3" width="4" height="4" ${S}/><path d="M8 7l8-2"/>`,
  grid: `<rect x="3.5" y="3.5" width="7" height="7" rx="1" ${S}/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>`,
  layout: `<rect x="3" y="4" width="18" height="16" rx="1.5"/><rect x="6" y="7" width="5" height="10" ${S}/><path d="M14 8h4M14 12h4M14 16h2"/>`,
  waves: `<path d="M2 20v-3c2.5 0 3.5-2 5-2s2.5 2 5 2 3.5-2 5-2 2.5 2 5 2v3z" ${F}/><path d="M2 9c2.5 0 3.5-2 5-2s2.5 2 5 2 3.5-2 5-2 2.5 2 5 2M2 17c2.5 0 3.5-2 5-2s2.5 2 5 2 3.5-2 5-2 2.5 2 5 2"/>`,
  layers: `<path d="M12 3l9 5-9 5-9-5z" ${F}/><path d="M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5"/>`,
  help: `<circle cx="12" cy="12" r="9" ${F}/><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 015 .9c0 1.8-2.5 2-2.5 3.8"/><circle cx="12" cy="17.3" r="1" ${S}/>`,
  undo: '<path d="M8 5L3.5 9.5 8 14"/><path d="M4 9.5h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M16 5l4.5 4.5L16 14"/><path d="M20 9.5H10a6 6 0 000 12h3"/>',
  save: `<path d="M4 4h12l4 4v12H4z" ${F}/><path d="M4 4h12l4 4v12H4zM8 4v5h7V4M8 20v-6h8v6"/>`,
  download: '<path d="M12 3v12M7 10.5l5 5 5-5M4 20h16"/>',
  folder: `<path d="M3 6h7l2 2h9v11H3z" ${F}/><path d="M3 6h7l2 2h9v11H3z"/>`,
  plus: '<path d="M12 5v14M5 12h14"/>',
  shuffle: '<path d="M3 7h3.5c5 0 6 10 11 10H21M3 17h3.5c2 0 3.2-1.6 4.2-3.6M14 8.6c1-1 2-1.6 3.5-1.6H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  settings: `<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><rect x="13" y="4" width="4" height="4" rx="1" ${S}/><rect x="7" y="10" width="4" height="4" rx="1" ${S}/><rect x="15" y="16" width="4" height="4" rx="1" ${S}/>`,
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  rotl: '<path d="M4 4v6h6"/><path d="M4.6 14a8 8 0 102-8.3L4 10"/>',
  rotr: '<path d="M20 4v6h-6"/><path d="M19.4 14a8 8 0 11-2-8.3L20 10"/>',
  copy: `<rect x="8" y="8" width="13" height="13" rx="1" ${F}/><rect x="8" y="8" width="13" height="13" rx="1"/><path d="M5 16H3V3h13v2"/>`,
  trash: `<path d="M5 7h14l-1.2 14H6.2z" ${F}/><path d="M3 7h18M9 7V3.5h6V7M5 7l1.2 14h11.6L19 7M10 11v6M14 11v6"/>`,
  focus: `<circle cx="12" cy="12" r="3" ${S}/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>`,
  cube: `<path d="M12 3l8.5 4.5L12 12 3.5 7.5z" ${F}/><path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9zM3.5 7.5L12 12l8.5-4.5M12 12v9"/>`,
  top: `<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="9" y="9" width="6" height="6" ${S}/><path d="M12 1.5V4M12 20v2.5M1.5 12H4M20 12h2.5"/>`,
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r="1" fill="currentColor" stroke="none"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.4 13.3l7.2 4.4M15.6 6.3l-7.2 4.4"/>',
  file: `<path d="M5 2.5h9l5 5v14H5z" ${F}/><path d="M5 2.5h9l5 5v14H5zM14 2.5v5h5M8.5 13h7M8.5 17h5"/>`,
  image: `<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 17l5-5 4 4 3-3 6 6v1H3z" ${F}/><circle cx="16" cy="8.5" r="1.6" ${S}/>`,
  package: `<path d="M3 7.5L12 3l9 4.5-9 4.5z" ${F}/><path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5zM3 7.5L12 12l9-4.5M12 12v9M7.5 5.2l9 4.6"/>`,
  anchor: '<circle cx="12" cy="5" r="2.4"/><path d="M12 7.5V21M8 11h8M4 13a8 8 0 0016 0"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  user: `<circle cx="12" cy="8" r="4" ${F}/><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>`,
  cloud: `<path d="M7 19a4.5 4.5 0 01-.6-9A6 6 0 0118 9a4.5 4.5 0 01-1 10z" ${F}/><path d="M7 19a4.5 4.5 0 01-.6-9A6 6 0 0118 9a4.5 4.5 0 01-1 10z"/><path d="M12 16v-5M9.5 13.5L12 11l2.5 2.5"/>`,
  camera: '<rect x="2" y="6" width="14" height="12" rx="1"/><path d="M16 10l6-3.5v11L16 14z"/>',
  chart: `<path d="M3 21h18"/><rect x="5" y="11" width="3" height="8" ${S}/><rect x="10.5" y="6" width="3" height="13"/><rect x="16" y="13" width="3" height="6" ${S}/>`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="1" ${F}/><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3.5 6l8.5 7 8.5-7"/>`,
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/>',
  users: `<circle cx="9" cy="8" r="3.5" ${F}/><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 010 6.4M18.5 14.8c1.7.8 2.8 2.5 3 5.2"/>`,
  bell: `<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z" ${F}/><path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4"/>`,
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  euro: '<path d="M17.5 6.5A7 7 0 007 12a7 7 0 0010.5 5.5M4 10h9M4 14h9"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  table: `<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18" /><rect x="3" y="4" width="18" height="5" ${F}/><path d="M3 14.5h18M9 9v11"/>`,
};

export function icon(name: keyof typeof P | string, size = 20): string {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

/** Marque de l'outil : bouée et vague. */
export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="13" r="8.5" fill="none" stroke="currentColor" stroke-width="4"/><path d="M16 4.5v4M16 17.5v4M7.5 13h4M20.5 13h4" stroke="#fff" stroke-width="2.6"/><path d="M3 27c3 0 3.8-2.2 6.5-2.2S13 27 16 27s3.8-2.2 6.5-2.2S26 27 29 27" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
