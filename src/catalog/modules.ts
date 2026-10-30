import type { Category, ModelSpec, ModuleSpec, PortSpec, Role, ZoneSpec } from '../core/types';

/*
 * Catalogue Wibit (source : wibitsports.com/all-modules, dimensions et profondeurs officielles).
 * Capacités, prix et nombre d'ancrages NE SONT PAS publiés par Wibit : ce sont des estimations
 * de travail pour le MVP, à remplacer par les données constructeur après contractualisation.
 *
 * Repère local : x = sens de progression (longueur L), z = largeur W, y = hauteur.
 */

// ---------------------------------------------------------------- ports

const P = (id: string, x: number, z: number, dx: number, dz: number, w = 2): PortSpec => ({ id, x, z, dx, dz, w });

/** Module traversant : une connexion à chaque extrémité. */
const ends = (L: number, w = 2) => [P('a', -L / 2, 0, -1, 0, w), P('b', L / 2, 0, 1, 0, w)];
/** Module de fin : connexion côté −x uniquement, sortie à l'eau côté +x. */
const tail = (L: number, w = 2) => [P('a', -L / 2, 0, -1, 0, w)];
/** Module d'entrée : connexion côté +x uniquement (face au parc), accès depuis l'eau / la plage côté −x. */
const head = (L: number, w = 2) => [P('b', L / 2, 0, 1, 0, w)];
const four = (L: number, W: number, w = 2) => [
  P('a', -L / 2, 0, -1, 0, w),
  P('b', L / 2, 0, 1, 0, w),
  P('c', 0, -W / 2, 0, -1, w),
  P('d', 0, W / 2, 0, 1, w),
];
const tee = (L: number, W: number, w = 2) => [P('a', -L / 2, 0, -1, 0, w), P('c', 0, -W / 2, 0, -1, w), P('d', 0, W / 2, 0, 1, w)];
const yConn = (L: number, W: number) => {
  const k = Math.SQRT1_2;
  return [P('a', -L / 2, 0, -1, 0), P('c', L / 2 - 0.55, -W / 2 + 0.55, k, -k), P('d', L / 2 - 0.55, W / 2 - 0.55, k, k)];
};
/** Virage à 90° : arc centré sur le coin (−L/2, −W/2), voie de largeur w. */
const turn = (L: number, W: number, w = 2) => [P('a', -L / 2, W / 2 - w / 2, -1, 0, w), P('b', L / 2 - w / 2, -W / 2, 0, -1, w)];

// ---------------------------------------------------------------- zones d'eau libre

/** Zone de sortie (toboggan / saut) dans le prolongement +x. */
const exitX = (L: number, len: number, width: number, kind: ZoneSpec['kind'] = 'slide'): ZoneSpec => ({
  x: L / 2 + len / 2,
  z: 0,
  hx: len / 2,
  hz: width / 2,
  kind,
});
/** Zones de réception latérales (de chaque côté en z). */
const sides = (L: number, W: number, len: number, kind: ZoneSpec['kind'] = 'jump'): ZoneSpec[] => [
  { x: 0, z: -(W / 2 + len / 2), hx: L / 2, hz: len / 2, kind },
  { x: 0, z: W / 2 + len / 2, hx: L / 2, hz: len / 2, kind },
];
const sideZ = (L: number, W: number, len: number, kind: ZoneSpec['kind'] = 'slide'): ZoneSpec => ({
  x: 0,
  z: W / 2 + len / 2,
  hx: L / 2,
  hz: len / 2,
  kind,
});

// ---------------------------------------------------------------- estimations

const round50 = (v: number) => Math.round(v / 50) * 50;

interface Def {
  id: string;
  name: string;
  category: Category;
  role: Role;
  L: number;
  W: number;
  H: number;
  depth: number;
  diff: number;
  ports: PortSpec[];
  zones?: ZoneSpec[];
  model: ModelSpec;
  desc: string;
  cap?: number;
  price?: number;
  anchors?: number;
  stepUp?: boolean;
  loopCorner?: boolean;
  displaySize?: string;
}

function m(d: Def): ModuleSpec {
  const area = d.L * d.W;
  return {
    ...d,
    zones: d.zones ?? [],
    cap: d.cap ?? Math.min(d.role === 'connector' ? 6 : 14, Math.max(2, Math.round(area / 2.8))),
    price: d.price ?? round50(2500 + area * 300 + area * Math.max(d.H, 0.3) * 90),
    anchors: d.anchors ?? Math.max(d.role === 'standalone' ? 2 : 1, Math.ceil(area / 12) + (d.H >= 3 ? 2 : 0)),
  };
}

// ---------------------------------------------------------------- catalogue

export const MODULES: ModuleSpec[] = [
  // ===== Fun — modulaires
  m({ id: 'actionloop', name: 'ActionLoop', category: 'fun', role: 'terminal', L: 8.2, W: 6.4, H: 2.7, depth: 2.25, diff: 3, ports: tail(8.2), zones: [exitX(8.2, 6, 6.4)], model: { kind: 'actionloop' }, desc: "Module de fin avec boucle de glisse infinie.", price: 38000 }),
  m({ id: 'actiontower-xl', name: 'ActionTower XL', category: 'fun', role: 'tower', L: 4.5, W: 3.9, H: 2, depth: 1.9, diff: 3, ports: [...ends(4.5), P('c', 0, -1.95, 0, -1)], zones: [sideZ(4.5, 3.9, 5)], model: { kind: 'tower', levels: 2, slide: 'z' }, desc: 'Tour : grimper, sauter, garder l’équilibre.' }),
  m({ id: 'actiontower-xxl', name: 'ActionTower XXL', category: 'fun', role: 'tower', L: 9.1, W: 7.6, H: 3, depth: 2.4, diff: 4, ports: four(9.1, 7.6).slice(0, 3), zones: [sideZ(9.1, 7.6, 6)], model: { kind: 'tower', levels: 3, slide: 'z' }, desc: 'Parcours « team building » : grimper, ramper, se suspendre, glisser.', cap: 25, price: 52000 }),
  m({ id: 'balancebar-l', name: 'BalanceBar L', category: 'fun', role: 'obstacle', L: 6, W: 2, H: 0.7, depth: 1.25, diff: 3, ports: ends(6), model: { kind: 'beam', variant: 'bar' }, desc: 'Longue barre d’équilibre.' }),
  m({ id: 'balancebar-s', name: 'BalanceBar S', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 0.6, depth: 1.2, diff: 2, ports: ends(3), model: { kind: 'beam', variant: 'bar' }, desc: 'Barre d’équilibre compacte pour courses ou adresse.' }),
  m({ id: 'balancebeam', name: 'BalanceBeam', category: 'fun', role: 'obstacle', L: 6, W: 2, H: 0.3, depth: 1.2, diff: 2, ports: ends(6), model: { kind: 'beam', variant: 'beam' }, desc: 'Poutre d’équilibre pour cours et camps.' }),
  m({ id: 'bend', name: 'Bend', category: 'fun', role: 'connector', L: 5.5, W: 5.5, H: 0.3, depth: 1.2, diff: 1, ports: turn(5.5, 5.5), loopCorner: true, model: { kind: 'turn', variant: 'flat' }, desc: 'Virage pour eau peu profonde.' }),
  m({ id: 'bridge', name: 'Bridge', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 1.2, depth: 1.5, diff: 2, ports: ends(3), model: { kind: 'bridge' }, desc: 'Obstacle de franchissement.' }),
  m({ id: 'cliff', name: 'Cliff', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 1.5, depth: 1.65, diff: 3, ports: ends(3), model: { kind: 'ramp', profile: 'cliff' }, desc: 'Escalade de vitesse et de force.' }),
  m({ id: 'cornerswing', name: 'CornerSwing', category: 'fun', role: 'connector', L: 5.5, W: 5.5, H: 4.5, depth: 2.05, diff: 4, ports: turn(5.5, 5.5), loopCorner: true, model: { kind: 'turn', variant: 'swing' }, desc: 'Virage avec défis côtés intérieur et extérieur.' }),
  m({ id: 'curve', name: 'Curve', category: 'fun', role: 'connector', L: 5.5, W: 5.5, H: 1.1, depth: 1.5, diff: 2, ports: turn(5.5, 5.5), loopCorner: true, model: { kind: 'turn', variant: 'curve' }, desc: 'Virage pour parcours de course.' }),
  m({ id: 'deck3', name: 'Deck3', category: 'fun', role: 'watch', L: 3, W: 2.6, H: 1.6, depth: 1.7, diff: 2, ports: ends(3), model: { kind: 'deck' }, desc: 'Obstacle ou poste de surveillance flottant.', displaySize: '2,6 × 3 m' }),
  m({ id: 'dipbars', name: 'DipBars', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 1.3, depth: 1.6, diff: 3, ports: ends(3), model: { kind: 'bars', style: 'dip' }, desc: 'Barres de force pour les bras.' }),
  m({ id: 'dome', name: 'Dome', category: 'fun', role: 'obstacle', L: 6, W: 3, H: 1.3, depth: 1.8, diff: 2, ports: ends(6), model: { kind: 'dome' }, desc: 'Coussin rebondissant à franchir.' }),
  m({ id: 'doublecurve', name: 'DoubleCurve', category: 'fun', role: 'connector', L: 6, W: 6, H: 0.85, depth: 1.35, diff: 2, ports: turn(6, 6, 4), loopCorner: false, model: { kind: 'turn', variant: 'double' }, desc: 'Deux pistes inclinées avec changement de voie.' }),
  m({ id: 'flip', name: 'Flip', category: 'fun', role: 'obstacle', L: 5.8, W: 2, H: 1.1, depth: 2, diff: 3, ports: ends(5.8), model: { kind: 'flip' }, desc: 'Élément d’action en équipe (bascule).' }),
  m({ id: 'highbars', name: 'HighBars', category: 'fun', role: 'obstacle', L: 3, W: 3.2, H: 2.4, depth: 2.1, diff: 4, ports: ends(3), zones: sides(3, 3.2, 3), model: { kind: 'bars', style: 'high' }, desc: 'Balancement au-dessus de l’eau entre deux barres.' }),
  m({ id: 'highroller', name: 'HighRoller', category: 'fun', role: 'obstacle', L: 9, W: 2.7, H: 1.6, depth: 1.7, diff: 3, ports: ends(9), model: { kind: 'roller' }, desc: 'Long obstacle de franchissement à rouleaux.' }),
  m({ id: 'hop', name: 'Hop', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 1, depth: 1.4, diff: 2, ports: ends(3), model: { kind: 'humps', n: 3, style: 'round' }, desc: 'Sauts « saute-mouton » sur l’eau.' }),
  m({ id: 'hurdle', name: 'Hurdle', category: 'fun', role: 'obstacle', L: 6, W: 2.5, H: 0.3, depth: 1.2, diff: 1, ports: ends(6), model: { kind: 'humps', n: 3, style: 'low' }, desc: 'Haies pour eau peu profonde.' }),
  m({ id: 'ledge', name: 'Ledge', category: 'fun', role: 'tower', L: 4.5, W: 3.9, H: 2.7, depth: 1.25, diff: 3, ports: ends(4.5), model: { kind: 'ramp', profile: 'ledge' }, desc: 'Quatre niveaux de difficulté.' }),
  m({ id: 'levelpass', name: 'LevelPass', category: 'fun', role: 'tower', L: 6, W: 3.5, H: 2.4, depth: 2.1, diff: 3, ports: ends(6), model: { kind: 'bars', style: 'level' }, desc: 'Passage en hauteur, les bateaux passent dessous.' }),
  m({ id: 'logroll', name: 'Logroll', category: 'fun', role: 'obstacle', L: 6, W: 2, H: 0.75, depth: 1.3, diff: 3, ports: ends(6), model: { kind: 'log' }, desc: 'Rondin qui roule latéralement.' }),
  m({ id: 'level-r-connect', name: 'Level-R-Connect', category: 'fun', role: 'connector', L: 5.5, W: 4.4, H: 2.5, depth: 2.15, diff: 3, ports: turn(5.5, 4.4), model: { kind: 'turn', variant: 'level' }, desc: 'Module incliné en virage avec vue sur l’eau.', displaySize: '4,4 × 5,5 m' }),
  m({ id: 'matchball', name: 'MatchBall', category: 'fun', role: 'tower', L: 6, W: 4, H: 3.2, depth: 1.25, diff: 3, ports: ends(6), model: { kind: 'matchball' }, desc: 'Jeu d’équipe au-dessus de l’eau.' }),
  m({ id: 'monkeybars', name: 'MonkeyBars', category: 'fun', role: 'obstacle', L: 6, W: 4, H: 2.1, depth: 1.7, diff: 4, ports: ends(6), model: { kind: 'bars', style: 'monkey' }, desc: 'Parcours de suspension (force des bras).' }),
  m({ id: 'mountain', name: 'Mountain', category: 'fun', role: 'terminal', L: 13.7, W: 9, H: 4, depth: 3, diff: 3, ports: [P('a', -6.85, -2.5, -1, 0), P('a2', -6.85, 2.5, -1, 0)], zones: [exitX(13.7, 8, 9)], model: { kind: 'mountain' }, desc: 'Grande structure avec plusieurs toboggans.', cap: 30, price: 98000 }),
  m({ id: 'parcour-l-connect', name: 'Parcour-L-Connect', category: 'fun', role: 'connector', L: 5.5, W: 4.4, H: 2.3, depth: 2.05, diff: 3, ports: turn(5.5, 4.4), model: { kind: 'turn', variant: 'parcour' }, desc: 'Virage façon parkour avec poignées et barres d’angle.' }),
  m({ id: 'peak', name: 'Peak', category: 'fun', role: 'tower', L: 6, W: 3.2, H: 2.6, depth: 2.2, diff: 4, ports: ends(6), model: { kind: 'ramp', profile: 'peak' }, desc: 'Escalade avec deux niveaux de difficulté.' }),
  m({ id: 'plank', name: 'Plank', category: 'fun', role: 'obstacle', L: 6, W: 2, H: 1.2, depth: 1.5, diff: 2, ports: ends(6), model: { kind: 'beam', variant: 'plank' }, desc: 'Large poutre flottante.' }),
  m({ id: 'powerhurdle', name: 'PowerHurdle', category: 'fun', role: 'obstacle', L: 6, W: 2.2, H: 0.9, depth: 1.35, diff: 3, ports: ends(6), model: { kind: 'humps', n: 4, style: 'power' }, desc: 'Haies de hauteurs variables.' }),
  m({ id: 'quarterpipe', name: 'Quarterpipe', category: 'fun', role: 'obstacle', L: 6, W: 2.7, H: 1.4, depth: 1.6, diff: 3, ports: ends(6), model: { kind: 'ramp', profile: 'quarter' }, desc: 'Franchir en sautant, glissant, grimpant ou en équilibre.' }),
  m({ id: 'quickjump', name: 'QuickJump', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 0.8, depth: 1.3, diff: 2, ports: ends(3), model: { kind: 'humps', n: 2, style: 'wedge' }, desc: 'Coussins inclinés adaptés à toutes les tailles.' }),
  m({ id: 'quickjump-l', name: 'QuickJump L', category: 'fun', role: 'obstacle', L: 6, W: 2, H: 0.8, depth: 1.3, diff: 2, ports: ends(6), model: { kind: 'humps', n: 4, style: 'wedge' }, desc: 'Sauts répétés.' }),
  m({ id: 'roundabout', name: 'RoundAbout', category: 'fun', role: 'connector', L: 6, W: 6, H: 1.2, depth: 1.5, diff: 2, ports: four(6, 6), model: { kind: 'roundabout' }, desc: 'Piste circulaire et point de rencontre central.', cap: 14 }),
  m({ id: 'slope', name: 'Slope', category: 'fun', role: 'terminal', L: 3, W: 2, H: 1.5, depth: 1.65, diff: 2, ports: tail(3), zones: [exitX(3, 4, 3)], model: { kind: 'ramp', profile: 'slope' }, desc: 'Toboggan raide, fin de parcours.' }),
  m({ id: 'slide', name: 'Slide', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 1.1, depth: 1.5, diff: 1, ports: ends(3), model: { kind: 'ramp', profile: 'hill' }, desc: 'Obstacle facile à franchir en courant ou en sautant.' }),
  m({ id: 'spin', name: 'Spin', category: 'fun', role: 'tower', L: 6, W: 4, H: 4, depth: 1.4, diff: 4, ports: ends(6), model: { kind: 'bars', style: 'spin' }, desc: 'Sol incliné, redoutable une fois mouillé.' }),
  m({ id: 'springboard', name: 'Springboard', category: 'fun', role: 'terminal', L: 6, W: 6, H: 3.2, depth: 2.5, diff: 4, ports: tail(6), zones: [exitX(6, 6, 6, 'jump')], model: { kind: 'springboard' }, desc: 'Plateforme de saut avec marche en demi-cercle.' }),
  m({ id: 'swing', name: 'Swing', category: 'fun', role: 'obstacle', L: 6, W: 2, H: 3.2, depth: 1.8, diff: 3, ports: ends(6), zones: sides(6, 2, 4), model: { kind: 'bars', style: 'swing' }, desc: 'Balançoire modulaire au-dessus de l’eau.' }),
  m({ id: 'target', name: 'Target', category: 'fun', role: 'obstacle', L: 6, W: 5.4, H: 0.3, depth: 1.2, diff: 1, ports: ends(6), model: { kind: 'target' }, desc: 'Module d’équilibre circulaire.' }),
  m({ id: 'targetjump', name: 'TargetJump', category: 'fun', role: 'obstacle', L: 3, W: 2.2, H: 1.7, depth: 1.75, diff: 3, ports: ends(3), zones: [sideZ(3, 2.2, 4, 'jump')], model: { kind: 'targetjump' }, desc: 'Saut de précision.' }),
  m({ id: 'trampoline-2', name: 'Trampoline 2', category: 'fun', role: 'obstacle', L: 6, W: 5, H: 0.9, depth: 2.5, diff: 2, ports: ends(6), model: { kind: 'tramp' }, desc: 'Trampoline sur l’eau, deux points de connexion.', cap: 6 }),
  m({ id: 'trampoline-4', name: 'Trampoline 4', category: 'fun', role: 'connector', L: 6, W: 6, H: 0.9, depth: 2.5, diff: 2, ports: four(6, 6), model: { kind: 'tramp' }, desc: 'Trampoline à quatre points de connexion.', cap: 6 }),
  m({ id: 'triplejump', name: 'TripleJump', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 1, depth: 1.4, diff: 2, ports: ends(3), model: { kind: 'humps', n: 3, style: 'triple' }, desc: 'Trois joueurs sautent en même temps.' }),
  m({ id: 'twist', name: 'Twist', category: 'fun', role: 'obstacle', L: 6, W: 2.3, H: 0.64, depth: 1.2, diff: 2, ports: ends(6), model: { kind: 'twist' }, desc: 'Deux niveaux de difficulté.' }),
  m({ id: 'wave', name: 'Wave', category: 'fun', role: 'terminal', L: 18.8, W: 8.6, H: 5, depth: 3.4, diff: 4, ports: tail(18.8), zones: [exitX(18.8, 8, 8.6)], model: { kind: 'wave' }, desc: 'Toboggan géant avec ascension le long de la surface.', cap: 20, price: 115000 }),
  m({ id: 'wiggleboard', name: 'WiggleBoard', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 0.7, depth: 1.25, diff: 2, ports: ends(3), model: { kind: 'beam', variant: 'board' }, desc: 'Planche qui oscille latéralement.' }),
  m({ id: 'wigglebridge', name: 'WiggleBridge', category: 'fun', role: 'obstacle', L: 6, W: 1.5, H: 0.3, depth: 1.2, diff: 2, ports: ends(6, 1.5), model: { kind: 'beam', variant: 'wiggle' }, desc: 'Traversée d’équilibre et de vitesse.' }),
  m({ id: 'v-connect', name: 'V-Connect', category: 'fun', role: 'obstacle', L: 3, W: 2, H: 0.3, depth: 1.2, diff: 1, ports: ends(3), model: { kind: 'humps', n: 1, style: 'v' }, desc: 'Obstacle facile à franchir en courant ou à quatre pattes.' }),
  m({ id: 'zigzag', name: 'ZigZag', category: 'fun', role: 'obstacle', L: 6, W: 3, H: 0.8, depth: 1.3, diff: 2, ports: ends(6), model: { kind: 'humps', n: 4, style: 'zigzag' }, desc: 'Course avec montée ou raccourcis en sautant.' }),

  // ===== MatchTrack (pistes doubles de compétition)
  m({ id: 'launchgate', name: 'LaunchGate', category: 'matchtrack', role: 'entry', L: 3, W: 4.9, H: 2.4, depth: 1.4, diff: 2, ports: head(3, 4), stepUp: true, model: { kind: 'launchgate' }, desc: 'Départ de course sur deux pistes.' }),
  m({ id: 'battlelogs', name: 'BattleLogs', category: 'matchtrack', role: 'tower', L: 6, W: 4, H: 2.9, depth: 1.4, diff: 4, ports: ends(6, 4), model: { kind: 'bars', style: 'battle' }, desc: 'Pousser l’adversaire hors de la piste.' }),
  m({ id: 'comeback-sus', name: 'ComeBack SUS', category: 'matchtrack', role: 'connector', L: 3, W: 4.9, H: 1.2, depth: 1.2, diff: 1, ports: ends(3, 4), stepUp: true, model: { kind: 'flat', variant: 'sus' }, desc: 'Aide les concurrents à remonter sur la piste.' }),
  m({ id: 'gapjump', name: 'GapJump', category: 'matchtrack', role: 'obstacle', L: 6, W: 4, H: 1.6, depth: 1.7, diff: 4, ports: ends(6, 4), model: { kind: 'gapjump' }, desc: 'Sauts étroits et glissants.' }),
  m({ id: 'hangshake', name: 'HangShake', category: 'matchtrack', role: 'obstacle', L: 6, W: 4, H: 2.2, depth: 1.6, diff: 5, ports: ends(6, 4), model: { kind: 'bars', style: 'hang' }, desc: 'Suspension sur un tapis mobile.' }),
  m({ id: 'overclimb', name: 'OverClimb', category: 'matchtrack', role: 'tower', L: 6, W: 5.4, H: 3, depth: 2.1, diff: 4, ports: ends(6, 4), model: { kind: 'ramp', profile: 'twin' }, desc: 'Montée raide puis descente.' }),
  m({ id: 'swingaround', name: 'SwingAround', category: 'matchtrack', role: 'connector', L: 6.7, W: 6.7, H: 3, depth: 1.5, diff: 4, ports: turn(6.7, 6.7, 4), model: { kind: 'turn', variant: 'swing' }, desc: 'Plusieurs options de franchissement, change de direction.' }),
  m({ id: 'endrise', name: 'EndRise', category: 'matchtrack', role: 'terminal', L: 7.6, W: 4.3, H: 2.1, depth: 1.95, diff: 3, ports: tail(7.6, 4), zones: [exitX(7.6, 4, 4.3)], model: { kind: 'ramp', profile: 'end' }, desc: 'Module final du MatchTrack.' }),

  // ===== WatchLine (surveillance)
  m({ id: 'watcharound', name: 'WatchAround', category: 'watch', role: 'watch', L: 2.5, W: 2.5, H: 3.4, depth: 1.85, diff: 1, ports: tail(2.5), model: { kind: 'watch', style: 'around' }, desc: 'Complément du RoundAbout.', cap: 1 }),
  m({ id: 'watchraft', name: 'WatchRaft', category: 'watch', role: 'watch', L: 4.5, W: 4.5, H: 2.5, depth: 1.25, diff: 1, ports: four(4.5, 4.5), model: { kind: 'watch', style: 'raft' }, desc: 'Plateforme de sécurité pour sauveteur.', cap: 2 }),
  m({ id: 'watchspot', name: 'WatchSpot', category: 'watch', role: 'watch', L: 3.9, W: 4.5, H: 3.5, depth: 1.6, diff: 1, ports: ends(3.9), model: { kind: 'watch', style: 'spot' }, desc: 'Poste modulaire ou autonome avec marche.', cap: 2 }),
  m({ id: 'watchtopper', name: 'WatchTopper', category: 'watch', role: 'watch', L: 3, W: 2.5, H: 3.5, depth: 1.6, diff: 1, ports: ends(3), model: { kind: 'watch', style: 'topper' }, desc: 'S’intègre aux parcs Wibit PEAKZ.', cap: 2 }),

  // ===== Technique (bases, jonctions, entrées)
  m({ id: 'base', name: 'Base', category: 'technical', role: 'entry', L: 3, W: 2, H: 0.3, depth: 1.2, diff: 1, ports: ends(3), model: { kind: 'flat', variant: 'base' }, desc: 'Point de départ d’une combinaison.' }),
  m({ id: 'base-sus', name: 'Base SUS', category: 'technical', role: 'entry', L: 2.9, W: 3, H: 0.3, depth: 1.2, diff: 1, ports: ends(2.9), stepUp: true, model: { kind: 'flat', variant: 'sus' }, desc: 'Base avec système de remontée (step-up).', displaySize: '3 × 2,9 m' }),
  m({ id: 'guardtower', name: 'GuardTower', category: 'technical', role: 'watch', L: 6, W: 3, H: 4, depth: 1.9, diff: 1, ports: ends(6), model: { kind: 'tower', levels: 2, slide: 'none', top: 'guard' }, desc: 'Poste de sauveteur surélevé.', cap: 2 }),
  m({ id: 'junction', name: 'Junction', category: 'technical', role: 'connector', L: 3, W: 3, H: 0.3, depth: 1.2, diff: 1, ports: four(3, 3), model: { kind: 'flat', variant: 'junction' }, desc: 'Se connecte sur les quatre côtés.' }),
  m({ id: 'l-connect-sus', name: 'L-Connect SUS', category: 'technical', role: 'connector', L: 5.5, W: 4.4, H: 0.3, depth: 1.2, diff: 1, ports: turn(5.5, 4.4), stepUp: true, model: { kind: 'turn', variant: 'flat' }, desc: 'Section courbe pour InfinityLoop, entrée step-up.' }),
  m({ id: 'r-connect-sus', name: 'R-Connect SUS', category: 'technical', role: 'connector', L: 5.5, W: 4.4, H: 0.3, depth: 1.2, diff: 1, ports: turn(5.5, 4.4), stepUp: true, model: { kind: 'turn', variant: 'flat' }, desc: 'Section courbe pour InfinityLoop, entrée step-up.' }),
  m({ id: 'sidekick', name: 'SideKick', category: 'technical', role: 'connector', L: 2.5, W: 2.5, H: 0.3, depth: 1.2, diff: 1, ports: [P('a', -1.25, 0, -1, 0), P('c', 0, -1.25, 0, -1)], model: { kind: 'flat', variant: 'sidekick' }, desc: 'Permet un virage à 90°.' }),
  m({ id: 'startgate-sus', name: 'StartGate SUS', category: 'technical', role: 'entry', L: 3.2, W: 6, H: 3.1, depth: 1.2, diff: 1, ports: head(3.2, 4), stepUp: true, model: { kind: 'launchgate', wide: true }, desc: 'Entrée step-up jusqu’à six personnes.', displaySize: '6 × 3,2 m' }),
  m({ id: 'step', name: 'Step', category: 'technical', role: 'entry', L: 2, W: 2, H: 0.3, depth: 1.2, diff: 1, ports: head(2), stepUp: true, model: { kind: 'flat', variant: 'step' }, desc: 'Accès facile au parc.' }),
  m({ id: 'step6', name: 'Step 6', category: 'technical', role: 'entry', L: 3, W: 6.3, H: 0.3, depth: 1.2, diff: 1, ports: head(3, 4), stepUp: true, model: { kind: 'flat', variant: 'step' }, desc: 'Accès jusqu’à six personnes simultanément.', displaySize: '6,3 × 3 m' }),
  m({ id: 't-connect-sus', name: 'T-Connect SUS', category: 'technical', role: 'connector', L: 3, W: 3, H: 0.3, depth: 1.2, diff: 1, ports: tee(3, 3), stepUp: true, model: { kind: 'flat', variant: 'tee' }, desc: 'Crée plusieurs chemins, entrée step-up.' }),
  m({ id: 'takeoff', name: 'TakeOff', category: 'technical', role: 'terminal', L: 2, W: 1.5, H: 0.3, depth: 1.2, diff: 1, ports: tail(2, 1.5), zones: [exitX(2, 2.5, 2.5, 'jump')], model: { kind: 'flat', variant: 'takeoff' }, desc: 'Point de remise à l’eau.', cap: 2 }),
  m({ id: 'turn-sus', name: 'Turn SUS', category: 'technical', role: 'connector', L: 5.5, W: 5.5, H: 0.3, depth: 1.2, diff: 1, ports: turn(5.5, 5.5), stepUp: true, loopCorner: true, model: { kind: 'turn', variant: 'flat' }, desc: 'Virage de boucle tourné vers l’intérieur, avec step-up.' }),
  m({ id: 'y-connect', name: 'Y-Connect', category: 'technical', role: 'connector', L: 3, W: 3, H: 0.3, depth: 1.2, diff: 1, ports: yConn(3, 3), model: { kind: 'flat', variant: 'y' }, desc: 'Plusieurs chemins et directions dans une InfinityLoop.' }),

  // ===== Modules autonomes
  m({ id: 'bouncer-xxl', name: 'Bouncer XXL', category: 'standalone', role: 'standalone', L: 5.6, W: 5.6, H: 0.9, depth: 2.5, diff: 2, ports: [], model: { kind: 'tramp', springs: true }, desc: 'Trampoline à ressorts inox.', cap: 6, price: 16500 }),
  m({ id: 'doublerocker', name: 'DoubleRocker', category: 'standalone', role: 'standalone', L: 3.1, W: 2.25, H: 1.2, depth: 1.5, diff: 2, ports: [], model: { kind: 'flip', rocker: true }, desc: 'Balançoire bascule géante.', cap: 4 }),
  m({ id: 'hand', name: 'Hand', category: 'standalone', role: 'standalone', L: 3.5, W: 3.7, H: 0.1, depth: 1.2, diff: 1, ports: [], model: { kind: 'hand' }, desc: 'Jeu individuel ou intégré à un aquaparc.', cap: 4 }),
  m({ id: 'icetower-xxl', name: 'IceTower XXL', category: 'standalone', role: 'standalone', L: 6, W: 4.6, H: 4.2, depth: 3, diff: 4, ports: [], zones: [exitX(6, 5, 4.6)], model: { kind: 'icetower' }, desc: 'Grimper jusqu’au sommet puis toboggan raide.', cap: 8, price: 34000 }),
  m({ id: 'matchballarena', name: 'MatchBallArena', category: 'standalone', role: 'standalone', L: 8.5, W: 5, H: 3.2, depth: 1.2, diff: 3, ports: [], model: { kind: 'matchball', arena: true }, desc: 'Jeu multijoueur interactif pour piscines.', cap: 8 }),
  m({ id: 'multiclimb', name: 'MultiClimb', category: 'standalone', role: 'standalone', L: 7.5, W: 6, H: 2.5, depth: 2.15, diff: 3, ports: [], model: { kind: 'multiclimb' }, desc: 'Trois faces d’escalade avec prises et cordes.', cap: 12 }),
  m({ id: 'pologoal', name: 'PoloGoal', category: 'standalone', role: 'standalone', L: 2.6, W: 1.2, H: 1.1, depth: 1.0, diff: 1, ports: [], model: { kind: 'goal' }, desc: 'But de water-polo gonflable.', cap: 1, price: 2400 }),
  m({ id: 'rodeosplash', name: 'RodeoSplash', category: 'standalone', role: 'standalone', L: 4, W: 4.3, H: 1.6, depth: 1.7, diff: 2, ports: [], model: { kind: 'rodeo' }, desc: 'Colline avec cinq options de glisse.', cap: 6 }),
  m({ id: 'speedslide', name: 'SpeedSlide', category: 'standalone', role: 'standalone', L: 14, W: 3.3, H: 0.6, depth: 1.2, diff: 2, ports: [], model: { kind: 'speedslide' }, desc: 'Toboggan compact pour eau peu profonde.', cap: 6 }),
  m({ id: 'stepslide', name: 'StepSlide', category: 'standalone', role: 'standalone', L: 3.9, W: 2, H: 1, depth: 1.4, diff: 1, ports: [], zones: [exitX(3.9, 3, 2.5)], model: { kind: 'stepslide' }, desc: 'Glisse pour espaces restreints.', cap: 3 }),
  m({ id: 'triplescore', name: 'TripleScore', category: 'standalone', role: 'standalone', L: 2.9, W: 2.4, H: 1.6, depth: 1.0, diff: 1, ports: [], model: { kind: 'score' }, desc: 'Jeu de lancer de balles pour piscines.', cap: 3 }),
  m({ id: 'volley', name: 'Volley', category: 'standalone', role: 'standalone', L: 11.3, W: 5.3, H: 1.6, depth: 1.2, diff: 2, ports: [], model: { kind: 'volley' }, desc: 'Terrain de beach-volley flottant.', cap: 12, price: 14500 }),
];

export const MODULE_MAP: Record<string, ModuleSpec> = Object.fromEntries(MODULES.map((s) => [s.id, s]));

export function spec(id: string): ModuleSpec {
  const s = MODULE_MAP[id];
  if (!s) throw new Error(`Module inconnu : ${id}`);
  return s;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  fun: 'Fun — modulaires',
  matchtrack: 'MatchTrack',
  watch: 'WatchLine — surveillance',
  technical: 'Technique — bases & jonctions',
  standalone: 'Modules autonomes',
};

/** Accessoires « à prévoir » (comme Boaz Create) — prix indicatifs. */
export const ACCESSORIES = {
  anchor: { name: 'Ancrage (lest + chaîne)', price: 190 },
  buoy: { name: 'SafetyBuoy (4,5 m)', price: 320 },
  lifejacket: { name: 'Gilet de sauvetage', price: 45 },
  boat: { name: 'WibitBoat (installation / surveillance)', price: 1900 },
  tent: { name: 'BeachTent (accueil)', price: 1200 },
};
