import * as THREE from 'three';
import { spec } from '../catalog/modules';
import { moduleOBB, obbCorners, rotate, worldPorts } from '../core/geometry';
import { buildGraph } from '../core/graph';
import type { ModuleSpec, Placed, Vec2 } from '../core/types';
import type { Store } from '../editor/store';
import { makeRng, type Rng } from '../generator/rng';
import type { Viewport } from './viewport';

/*
 * Mode Play : des baigneurs (gilets orange) circulent sur le parc. Chaque baigneur suit
 * le graphe des connexions : il traverse les modules, se repose sur les jonctions, rebondit
 * sur les trampolines, saute à l'eau, glisse sur les toboggans puis nage jusqu'à un accès
 * pour remonter. Les groupes d'amis partagent le même tirage aléatoire et suivent donc le
 * même itinéraire, en file. La caméra enchaîne des plans cinématiques.
 */

type State = 'walk' | 'idle' | 'bounce' | 'jump' | 'slide' | 'swim' | 'climb';

interface Agent {
  rng: Rng;
  state: State;
  pos: THREE.Vector3;
  heading: number;
  /** Module courant (pour la hauteur de surface). */
  mod: Placed | null;
  path: Vec2[];
  seg: number;
  segT: number;
  speed: number;
  timer: number;
  /** Port visé en fin de chemin (sortie du module). */
  outPort: string | null;
  // saut / glisse : trajectoire paramétrique
  from: THREE.Vector3;
  to: THREE.Vector3;
  dur: number;
  t: number;
  arc: number;
  bodyColor: THREE.Color;
  skin: THREE.Color;
  delay: number;
}

interface ModInfo {
  p: Placed;
  s: ModuleSpec;
  ports: Map<string, { x: number; z: number; dx: number; dz: number }>;
  /** port -> [voisin, port du voisin] */
  links: Map<string, [string, string]>;
}

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd8a47f].map((c) => new THREE.Color(c));
const SUITS = [0x1f6feb, 0xe11d48, 0x16a34a, 0x7c3aed, 0x0ea5e9, 0xf59e0b, 0x111827, 0xec4899].map((c) => new THREE.Color(c));

/** Hauteur (pieds) d'un baigneur sur un module, au point local (lx, lz). */
function surface(s: ModuleSpec, lx: number): number {
  const u = Math.max(0, Math.min(1, (lx + s.L / 2) / s.L));
  const base = 0.2;
  const k = s.model.kind;
  const H = Math.min(s.H, 4);
  const hump = base + Math.sin(Math.PI * u) * Math.max(0, H - base);
  const plateau = base + Math.min(1, Math.min(u, 1 - u) * 5) * Math.max(0, H * 0.92 - base);
  switch (k) {
    case 'ramp':
    case 'humps':
    case 'log':
    case 'bridge':
    case 'dome':
    case 'twist':
    case 'roller':
    case 'gapjump':
      return hump;
    case 'beam':
      return base + (H - base) * 0.9;
    case 'tower':
    case 'deck':
    case 'targetjump':
    case 'watch':
      return plateau;
    case 'bars':
      return s.model.style === 'level' ? plateau : base;
    case 'tramp':
      return 0.45;
    case 'wave':
    case 'mountain':
    case 'actionloop':
    case 'springboard':
      return base + Math.min(1, u / 0.2) * (H - base);
    case 'turn':
      return s.model.variant === 'curve' ? 0.45 : base;
    default:
      return base;
  }
}

export class PlayMode {
  active = false;
  cinematic = true;
  ratio = 0.5;
  private agents: Agent[] = [];
  private mods = new Map<string, ModInfo>();
  private access: { x: number; z: number; uid: string }[] = [];
  private group = new THREE.Group();
  private body!: THREE.InstancedMesh;
  private vest!: THREE.InstancedMesh;
  private head!: THREE.InstancedMesh;
  private splashes: { mesh: THREE.Mesh; t: number }[] = [];
  private rng = makeRng(42);
  private shot = 0;
  private shotT = 0;
  private shotSeed = 0;
  private center = new THREE.Vector3();
  private radius = 30;
  private ui: HTMLElement | null = null;
  private fade: HTMLElement | null = null;
  private savedCam: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private dummy = new THREE.Object3D();
  private savedOpts: Viewport['opts'] | null = null;
  onExit?: () => void;

  constructor(
    private viewport: Viewport,
    private store: Store,
  ) {}

  get capacity() {
    return this.store.derived.stats.capacity;
  }

  start() {
    if (this.active || !this.store.project.modules.length) return false;
    this.active = true;
    this.buildWorld();
    this.savedCam = { pos: this.viewport.camera.position.clone(), target: this.viewport.controls.target.clone() };
    this.viewport.scene.add(this.group);
    // pas de repères techniques pendant la lecture
    this.savedOpts = { ...this.viewport.opts };
    Object.assign(this.viewport.opts, { grid: false, ports: false, zones: false, anchors: false, buoys: true });
    this.viewport.refreshOverlays();
    this.spawn(Math.max(1, Math.round(this.capacity * this.ratio)));
    document.body.classList.add('playing');
    this.mountUI();
    this.setCinematic(true);
    this.viewport.onFrame = (dt) => this.update(Math.min(dt, 0.05));
    return true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.viewport.onFrame = undefined;
    this.viewport.scene.remove(this.group);
    this.group.clear();
    this.agents = [];
    document.body.classList.remove('playing');
    this.ui?.remove();
    this.fade?.remove();
    this.ui = this.fade = null;
    this.viewport.controls.enabled = true;
    if (this.savedOpts) {
      Object.assign(this.viewport.opts, this.savedOpts);
      this.viewport.refreshOverlays();
    }
    if (this.savedCam) {
      this.viewport.camera.position.copy(this.savedCam.pos);
      this.viewport.controls.target.copy(this.savedCam.target);
    }
    this.viewport.controls.update();
    this.onExit?.();
  }

  // ------------------------------------------------------------ monde

  private buildWorld() {
    const mods = this.store.project.modules;
    const graph = buildGraph(mods);
    this.mods.clear();
    for (const p of mods) {
      const s = spec(p.type);
      const ports = new Map(worldPorts(p, s).map((w) => [w.port.id, { x: w.x, z: w.z, dx: w.dx, dz: w.dz }]));
      this.mods.set(p.uid, { p, s, ports, links: new Map() });
    }
    for (const l of graph.links) {
      this.mods.get(l.a)!.links.set(l.aPort, [l.b, l.bPort]);
      this.mods.get(l.b)!.links.set(l.bPort, [l.a, l.aPort]);
    }
    // points d'accès depuis l'eau : modules d'entrée / step-up et extrémités libres
    this.access = [];
    for (const mi of this.mods.values()) {
      const { p, s } = mi;
      if (s.role === 'entry' || s.stepUp) {
        const c = obbCorners(moduleOBB(p, s, 0.6));
        for (let i = 0; i < 4; i++) this.access.push({ x: (c[i].x + c[(i + 1) % 4].x) / 2, z: (c[i].z + c[(i + 1) % 4].z) / 2, uid: p.uid });
      }
      for (const [id, w] of mi.ports) if (!mi.links.has(id) && s.role !== 'terminal') this.access.push({ x: w.x + w.dx * 0.6, z: w.z + w.dz * 0.6, uid: p.uid });
    }
    if (!this.access.length) for (const mi of this.mods.values()) this.access.push({ x: mi.p.x, z: mi.p.z, uid: mi.p.uid });
    // cadrage
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const mi of this.mods.values())
      for (const c of obbCorners(moduleOBB(mi.p, mi.s))) {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minZ = Math.min(minZ, c.z);
        maxZ = Math.max(maxZ, c.z);
      }
    this.center.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.radius = Math.max(12, Math.hypot(maxX - minX, maxZ - minZ) / 2);
    this.buildMeshes();
  }

  private buildMeshes() {
    this.group.clear();
    const max = 600;
    const bodyGeo = new THREE.CapsuleGeometry(0.17, 0.75, 4, 10).translate(0, 0.55, 0);
    const vestGeo = new THREE.CylinderGeometry(0.22, 0.2, 0.42, 10).translate(0, 0.98, 0);
    const headGeo = new THREE.SphereGeometry(0.13, 12, 10).translate(0, 1.42, 0);
    const mat = () => new THREE.MeshStandardMaterial({ roughness: 0.6 });
    this.body = new THREE.InstancedMesh(bodyGeo, mat(), max);
    this.vest = new THREE.InstancedMesh(vestGeo, new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.5 }), max);
    this.head = new THREE.InstancedMesh(headGeo, mat(), max);
    for (const m of [this.body, this.vest, this.head]) {
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    const ringGeo = new THREE.RingGeometry(0.2, 0.32, 24).rotateX(-Math.PI / 2);
    this.splashes = [];
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      this.group.add(mesh);
      this.splashes.push({ mesh, t: 1 });
    }
  }

  // ------------------------------------------------------------ baigneurs

  setCount(n: number) {
    n = Math.max(0, Math.min(600, n));
    if (n > this.agents.length) this.spawn(n - this.agents.length);
    else this.agents.length = n;
  }

  setRatio(r: number) {
    this.ratio = r;
    this.setCount(Math.round(this.capacity * r));
    this.refreshUI();
  }

  private spawn(n: number) {
    const mods = [...this.mods.values()].filter((m) => m.s.ports.length > 0 || m.s.role === 'standalone');
    if (!mods.length) return;
    let made = 0;
    while (made < n) {
      // groupes de 1 à 4 amis (même graine = même itinéraire)
      const size = Math.min(n - made, this.rng.next() < 0.45 ? 1 : this.rng.int(2, 4));
      const seed = Math.floor(this.rng.next() * 1e9);
      const start = this.rng.pick(mods);
      const inWater = this.rng.next() < 0.25;
      for (let k = 0; k < size; k++) {
        const a: Agent = {
          rng: makeRng(seed),
          state: 'idle',
          pos: new THREE.Vector3(),
          heading: 0,
          mod: null,
          path: [],
          seg: 0,
          segT: 0,
          speed: 1.1 + this.rng.next() * 0.6,
          timer: k * 0.7 + this.rng.next() * 0.3,
          outPort: null,
          from: new THREE.Vector3(),
          to: new THREE.Vector3(),
          dur: 1,
          t: 0,
          arc: 0,
          bodyColor: this.rng.pick(SUITS),
          skin: this.rng.pick(SKIN),
          delay: k * 0.7,
        };
        const off = (k - (size - 1) / 2) * 0.55;
        if (inWater || !start.s.ports.length) {
          const ang = this.rng.next() * Math.PI * 2;
          a.pos.set(start.p.x + Math.cos(ang) * (start.s.L / 2 + 3) + off, -0.95, start.p.z + Math.sin(ang) * (start.s.W / 2 + 3));
          this.toSwim(a);
        } else {
          const l = rotate((this.rng.next() - 0.5) * start.s.L * 0.6, off, start.p.rot);
          a.pos.set(start.p.x + l.x, 0, start.p.z + l.z);
          a.mod = start.p;
          a.pos.y = this.heightAt(start.p, a.pos.x, a.pos.z);
          this.walkToPort(a, start, this.pickPort(a, start, null));
        }
        this.agents.push(a);
        made++;
      }
    }
  }

  private heightAt(p: Placed, x: number, z: number) {
    const s = spec(p.type);
    const l = rotate(x - p.x, z - p.z, -p.rot);
    return surface(s, l.x);
  }

  private pickPort(a: Agent, mi: ModInfo, exclude: string | null): string | null {
    const ids = [...mi.ports.keys()].filter((id) => id !== exclude);
    if (!ids.length) return null;
    // les ports reliés sont plus attractifs (on continue le parcours)
    const linked = ids.filter((id) => mi.links.has(id));
    const pool = linked.length && a.rng.next() < 0.85 ? linked : ids;
    return a.rng.pick(pool);
  }

  private walkToPort(a: Agent, mi: ModInfo, port: string | null) {
    a.mod = mi.p;
    a.outPort = port;
    const target = port ? mi.ports.get(port)! : { x: mi.p.x, z: mi.p.z };
    a.path = [{ x: a.pos.x, z: a.pos.z }, { x: mi.p.x, z: mi.p.z }, { x: target.x, z: target.z }];
    if (Math.hypot(a.pos.x - mi.p.x, a.pos.z - mi.p.z) < 0.8) a.path.splice(1, 1);
    a.seg = 0;
    a.segT = 0;
    a.state = 'walk';
  }

  private toSwim(a: Agent) {
    a.state = 'swim';
    a.mod = null;
    const near = [...this.access].sort((p, q) => Math.hypot(p.x - a.pos.x, p.z - a.pos.z) - Math.hypot(q.x - a.pos.x, q.z - a.pos.z)).slice(0, 3);
    const t = a.rng.pick(near);
    a.path = [{ x: a.pos.x, z: a.pos.z }, { x: t.x, z: t.z }];
    a.seg = 0;
    a.segT = 0;
    a.outPort = t.uid; // module visé
    a.speed = 0.7 + a.rng.next() * 0.3;
  }

  private jumpTo(a: Agent, to: THREE.Vector3, arc: number, dur: number, state: 'jump' | 'slide') {
    a.state = state;
    a.from.copy(a.pos);
    a.to.copy(to);
    a.arc = arc;
    a.dur = dur;
    a.t = 0;
  }

  private splash(x: number, z: number) {
    const s = this.splashes.find((q) => q.t >= 1);
    if (!s) return;
    s.t = 0;
    s.mesh.position.set(x, 0.03, z);
    s.mesh.visible = true;
  }

  /** Arrivé au port de sortie : on passe au module voisin, on glisse, ou on saute à l'eau. */
  private arrive(a: Agent) {
    const mi = a.mod ? this.mods.get(a.mod.uid) : null;
    if (!mi) return this.toSwim(a);
    const link = a.outPort ? mi.links.get(a.outPort) : undefined;
    if (link) {
      const next = this.mods.get(link[0])!;
      if (next.s.role === 'terminal') {
        // monter puis glisser jusqu'au bout de la zone de sortie
        const zone = next.s.zones[0];
        const top = rotate(-next.s.L / 2 + next.s.L * 0.2, 0, next.p.rot);
        a.mod = next.p;
        a.path = [{ x: a.pos.x, z: a.pos.z }, { x: next.p.x + top.x, z: next.p.z + top.z }];
        a.seg = 0;
        a.segT = 0;
        a.outPort = '__slide';
        a.state = 'walk';
        if (zone) {
          const end = rotate(zone.x + zone.hx * 0.6, zone.z + (a.rng.next() - 0.5) * zone.hz, next.p.rot);
          a.to.set(next.p.x + end.x, -0.6, next.p.z + end.z);
        } else {
          const end = rotate(next.s.L / 2 + 2, 0, next.p.rot);
          a.to.set(next.p.x + end.x, -0.6, next.p.z + end.z);
        }
        return;
      }
      // pause sur les jonctions, rebonds sur les trampolines
      if (next.s.model.kind === 'tramp' && a.rng.next() < 0.7) {
        a.mod = next.p;
        a.state = 'bounce';
        a.timer = 2 + a.rng.next() * 4;
        a.outPort = this.pickPort(a, next, link[1]);
        return;
      }
      if (next.s.role === 'connector' && a.rng.next() < 0.25) {
        a.mod = next.p;
        a.state = 'idle';
        a.timer = 1 + a.rng.next() * 3;
        a.outPort = this.pickPort(a, next, link[1]);
        return;
      }
      this.walkToPort(a, next, this.pickPort(a, next, link[1]));
      return;
    }
    // extrémité libre : plongeon
    const w = a.outPort ? mi.ports.get(a.outPort) : null;
    const dir = w ? { x: w.dx, z: w.dz } : { x: Math.cos(a.heading), z: -Math.sin(a.heading) };
    this.jumpTo(a, new THREE.Vector3(a.pos.x + dir.x * 2.5, -0.7, a.pos.z + dir.z * 2.5), 1.0, 0.8, 'jump');
  }

  private update(dt: number) {
    for (const a of this.agents) this.step(a, dt);
    this.render();
    for (const s of this.splashes) {
      if (s.t >= 1) continue;
      s.t += dt / 1.2;
      const k = 1 + s.t * 5;
      s.mesh.scale.set(k, 1, k);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - s.t);
      if (s.t >= 1) s.mesh.visible = false;
    }
    if (this.cinematic) this.updateCamera(dt);
  }

  private step(a: Agent, dt: number) {
    if (a.delay > 0) {
      a.delay -= dt;
      return;
    }
    switch (a.state) {
      case 'walk':
      case 'swim': {
        const p0 = a.path[a.seg],
          p1 = a.path[a.seg + 1];
        if (!p1) {
          if (a.state === 'swim') {
            // remontée sur le module d'accès
            const mi = this.mods.get(a.outPort ?? '');
            a.state = 'climb';
            a.mod = mi?.p ?? null;
            a.t = 0;
            a.from.copy(a.pos);
            const h = mi ? this.heightAt(mi.p, a.pos.x, a.pos.z) : 0.2;
            a.to.set(a.pos.x + (mi ? (mi.p.x - a.pos.x) * 0.15 : 0), h, a.pos.z + (mi ? (mi.p.z - a.pos.z) * 0.15 : 0));
            a.dur = 1.1;
            return;
          }
          if (a.outPort === '__slide') {
            this.jumpTo(a, a.to.clone(), 0.2, 1.4 + a.rng.next() * 0.6, 'slide');
            return;
          }
          this.arrive(a);
          return;
        }
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 0.01;
        a.segT += (a.speed * dt) / len;
        if (a.segT >= 1) {
          a.seg++;
          a.segT = 0;
        }
        const t = Math.min(1, a.segT);
        a.pos.x = p0.x + (p1.x - p0.x) * t;
        a.pos.z = p0.z + (p1.z - p0.z) * t;
        a.heading = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
        if (a.state === 'swim') a.pos.y = -0.95 + Math.sin(performance.now() / 300 + a.speed * 10) * 0.04;
        else {
          a.pos.y = a.mod ? this.heightAt(a.mod, a.pos.x, a.pos.z) : 0.2;
          // envie soudaine de sauter à l'eau
          if (a.rng.next() < dt * 0.02) {
            const side = a.rng.next() < 0.5 ? 1 : -1;
            const nx = Math.cos(a.heading + (side * Math.PI) / 2),
              nz = -Math.sin(a.heading + (side * Math.PI) / 2);
            this.jumpTo(a, new THREE.Vector3(a.pos.x + nx * 2.8, -0.7, a.pos.z + nz * 2.8), 1.2, 0.9, 'jump');
          }
        }
        return;
      }
      case 'idle':
      case 'bounce': {
        a.timer -= dt;
        if (a.state === 'bounce') a.pos.y = 0.45 + Math.abs(Math.sin(a.timer * 4.2)) * 1.1;
        if (a.timer <= 0) {
          const mi = this.mods.get(a.mod!.uid)!;
          a.pos.y = this.heightAt(mi.p, a.pos.x, a.pos.z);
          this.walkToPort(a, mi, a.outPort);
        }
        return;
      }
      case 'jump':
      case 'slide':
      case 'climb': {
        a.t += dt / a.dur;
        const t = Math.min(1, a.t);
        const e = a.state === 'slide' ? t * t : t;
        a.pos.lerpVectors(a.from, a.to, e);
        if (a.state === 'jump') a.pos.y += Math.sin(Math.PI * t) * a.arc;
        if (a.state === 'slide') a.pos.y = a.from.y + (a.to.y - a.from.y) * Math.sin((t * Math.PI) / 2);
        a.heading = Math.atan2(-(a.to.z - a.from.z), a.to.x - a.from.x);
        if (t >= 1) {
          if (a.state === 'climb') {
            const mi = a.mod ? this.mods.get(a.mod.uid) : null;
            if (mi) this.walkToPort(a, mi, this.pickPort(a, mi, null));
            else this.toSwim(a);
          } else {
            this.splash(a.pos.x, a.pos.z);
            a.pos.y = -0.95;
            this.toSwim(a);
          }
        }
        return;
      }
    }
  }

  private render() {
    const n = this.agents.length;
    for (const m of [this.body, this.vest, this.head]) m.count = n;
    this.agents.forEach((a, i) => {
      this.dummy.position.copy(a.pos);
      this.dummy.rotation.set(0, a.heading - Math.PI / 2, 0);
      if (a.state === 'slide') this.dummy.rotation.x = -0.9;
      if (a.state === 'jump') this.dummy.rotation.x = -0.3;
      this.dummy.updateMatrix();
      this.body.setMatrixAt(i, this.dummy.matrix);
      this.vest.setMatrixAt(i, this.dummy.matrix);
      this.head.setMatrixAt(i, this.dummy.matrix);
      this.body.setColorAt(i, a.bodyColor);
      this.head.setColorAt(i, a.skin);
    });
    for (const m of [this.body, this.vest, this.head]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ caméra cinématique

  setCinematic(on: boolean) {
    this.cinematic = on;
    this.viewport.controls.enabled = !on;
    this.shotT = 99;
    this.refreshUI();
  }

  private updateCamera(dt: number) {
    const SHOT = 7;
    this.shotT += dt;
    if (this.shotT > SHOT) {
      this.shotT = 0;
      this.shot = (this.shot + 1) % 5;
      this.shotSeed = Math.random();
      if (this.fade) {
        this.fade.classList.remove('cut');
        void this.fade.offsetWidth;
        this.fade.classList.add('cut');
      }
    }
    const cam = this.viewport.camera;
    const c = this.center,
      R = this.radius;
    const u = this.shotT / SHOT;
    const look = new THREE.Vector3();
    const a0 = this.shotSeed * Math.PI * 2;
    switch (this.shot) {
      case 0: {
        // grand plan en orbite lente
        const ang = a0 + u * 0.6;
        cam.position.set(c.x + Math.cos(ang) * R * 1.5, R * 0.55 + 6, c.z + Math.sin(ang) * R * 1.5);
        look.copy(c);
        break;
      }
      case 1: {
        // travelling au ras de l'eau
        const ang = a0;
        const dx = Math.cos(ang),
          dz = Math.sin(ang);
        const side = (u - 0.5) * R * 1.6;
        cam.position.set(c.x + dx * R * 0.9 - dz * side, 1.3, c.z + dz * R * 0.9 + dx * side);
        look.set(c.x - dz * side * 0.4, 1.5, c.z + dx * side * 0.4);
        break;
      }
      case 2: {
        // on suit un baigneur (de préférence sur un toboggan ou en saut)
        const pick = this.agents.find((a) => a.state === 'slide' || a.state === 'jump') ?? this.agents[Math.floor(this.shotSeed * this.agents.length)];
        if (!pick) break;
        const back = 7;
        const target = cam.position.clone();
        target.set(pick.pos.x - Math.cos(pick.heading) * back, Math.max(pick.pos.y, 0) + 4, pick.pos.z + Math.sin(pick.heading) * back);
        cam.position.lerp(target, Math.min(1, dt * 2));
        look.set(pick.pos.x, Math.max(pick.pos.y, 0) + 1, pick.pos.z);
        break;
      }
      case 3: {
        // vue zénithale qui descend doucement
        cam.position.set(c.x + 0.01, R * (2.2 - u * 0.6), c.z + 0.02);
        look.copy(c);
        break;
      }
      case 4: {
        // grue : montée depuis l'eau
        const ang = a0;
        cam.position.set(c.x + Math.cos(ang) * R * 0.8, 1 + u * R * 0.9, c.z + Math.sin(ang) * R * 0.8);
        look.set(c.x, 1.5, c.z);
        break;
      }
    }
    cam.lookAt(look);
    this.viewport.controls.target.copy(look);
  }

  // ------------------------------------------------------------ interface

  private mountUI() {
    this.fade = document.createElement('div');
    this.fade.className = 'play-fade';
    document.body.appendChild(this.fade);
    this.ui = document.createElement('div');
    this.ui.className = 'play-bar glass';
    document.body.appendChild(this.ui);
    this.refreshUI();
  }

  private refreshUI() {
    if (!this.ui) return;
    const n = this.agents.length;
    const pct = Math.round(this.ratio * 100);
    this.ui.innerHTML = `
      <button class="btn" data-a="exit">Quitter</button>
      <div class="play-occ"><span>Fréquentation <b>${pct} %</b> · ${n} baigneurs sur ${this.capacity}</span>
        <input type="range" min="0.1" max="1" step="0.05" value="${this.ratio}"></div>
      <div class="seg"><button data-cam="1" class="${this.cinematic ? 'on' : ''}">Cinématique</button><button data-cam="0" class="${this.cinematic ? '' : 'on'}">Caméra libre</button></div>`;
    this.ui.querySelector<HTMLElement>('[data-a=exit]')!.onclick = () => this.stop();
    const r = this.ui.querySelector<HTMLInputElement>('input')!;
    r.oninput = () => {
      this.ratio = Number(r.value);
      this.setCount(Math.round(this.capacity * this.ratio));
      const label = this.ui!.querySelector('.play-occ span')!;
      label.innerHTML = `Fréquentation <b>${Math.round(this.ratio * 100)} %</b> · ${this.agents.length} baigneurs sur ${this.capacity}`;
    };
    this.ui.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => (b.onclick = () => this.setCinematic(b.dataset.cam === '1')));
  }
}
