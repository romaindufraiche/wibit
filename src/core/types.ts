// Types partagés du moteur (aucune dépendance à three.js : utilisable en test / worker).

/** Point / vecteur dans le plan horizontal (x vers la droite, z vers le rivage). */
export interface Vec2 {
  x: number;
  z: number;
}

/** Point de connexion d'un module, exprimé dans le repère local du module. */
export interface PortSpec {
  id: string;
  x: number;
  z: number;
  /** Direction sortante (vecteur unitaire local). */
  dx: number;
  dz: number;
  /** Largeur de la jonction (m), purement indicatif / visuel. */
  w: number;
}

/** Rectangle local (centre + demi-tailles) qui doit rester en eau libre : sortie de toboggan, zone de saut… */
export interface ZoneSpec {
  x: number;
  z: number;
  hx: number;
  hz: number;
  kind: 'slide' | 'jump';
}

export type Category = 'fun' | 'matchtrack' | 'watch' | 'technical' | 'standalone';

/**
 * Rôle du module dans la grammaire de parcours :
 * - entry : point d'accès depuis l'eau (Base, Step, StartGate…)
 * - connector : jonction / virage / plateforme de repos
 * - obstacle : module traversant (deux extrémités)
 * - tower : module haut traversant (≥ 2,4 m)
 * - terminal : fin de parcours (toboggan, tremplin…) : une seule connexion, sortie vers l'eau
 * - watch : poste de surveillance
 * - standalone : module flottant autonome (pas de connexion)
 */
export type Role = 'entry' | 'connector' | 'obstacle' | 'tower' | 'terminal' | 'watch' | 'standalone';

export type Audience = 'kids' | 'family' | 'sport' | 'mixed';

export interface ModelSpec {
  kind: string;
  [k: string]: unknown;
}

export interface ModuleSpec {
  id: string;
  name: string;
  category: Category;
  role: Role;
  /** Longueur (axe local x, sens de progression), largeur (axe z), hauteur (m). */
  L: number;
  W: number;
  H: number;
  /** Profondeur d'eau minimale (m). */
  depth: number;
  /** Difficulté 1 (facile) à 5 (expert). */
  diff: number;
  /** Capacité recommandée (personnes) — estimation MVP. */
  cap: number;
  /** Prix indicatif HT (€) — estimation MVP à remplacer par la grille Wibit. */
  price: number;
  /** Nombre d'ancrages estimé. */
  anchors: number;
  ports: PortSpec[];
  zones: ZoneSpec[];
  /** Le module accepte le système de remontée (step-up) : sert aussi d'accès. */
  stepUp?: boolean;
  /** Turn à 90° utilisable dans une boucle InfinityLoop. */
  loopCorner?: boolean;
  desc: string;
  model: ModelSpec;
  /** Affichage catalogue « L × l » si différent de L × W (modules orientés). */
  displaySize?: string;
}

/** Instance posée dans le projet. */
export interface Placed {
  uid: string;
  type: string;
  x: number;
  z: number;
  /** Rotation autour de l'axe vertical (radians), même convention que three.js (rotation.y). */
  rot: number;
}

export interface Site {
  /** Dimension du plan d'eau le long du rivage (axe x). */
  length: number;
  /** Dimension perpendiculaire au rivage (axe z). Le rivage est en z = +width/2. */
  width: number;
  /** Profondeur d'eau disponible (m). */
  depth: number;
  /** Géoréférencement (plan d'ancrage GPS). */
  geo?: Geo;
  /** Contour remodelé du plan d'eau (polygone) ; absent = rectangle longueur × largeur. */
  outline?: Vec2[];
}

export interface Geo {
  /** Centre du plan d'eau (WGS84). */
  lat: number;
  lon: number;
  /** Azimut (degrés depuis le nord) de la direction « vers le large », perpendiculaire au rivage. */
  bearing: number;
}

export interface Project {
  version: 1;
  name: string;
  site: Site;
  audience: Audience;
  modules: Placed[];
  /** Stock de modules possédés (parc existant / inventaire) : id -> quantité. */
  inventory?: Record<string, number>;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  rule: string;
  level: IssueLevel;
  message: string;
  uids: string[];
}
