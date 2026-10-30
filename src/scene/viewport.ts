import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { spec } from '../catalog/modules';
import { moduleOBB, obbCorners } from '../core/geometry';
import { findSnap } from '../core/snap';
import type { Placed } from '../core/types';
import type { Store } from '../editor/store';
import { RULES } from '../rules/validate';
import { buildModel } from '../models/builders';

export interface ViewOptions {
  grid: boolean;
  ports: boolean;
  zones: boolean;
  anchors: boolean;
  buoys: boolean;
}

interface ModObj {
  root: THREE.Group;
  model: THREE.Group;
  outline: THREE.LineLoop;
  overlays: THREE.Group;
  type: string;
}

const COLORS = { selected: 0x22d3ee, error: 0xff3b30, warning: 0xffa000 };

// ressources partagées des surcouches (évite de recréer des géométries à chaque image de glisser)
const PORT_MAT = new THREE.MeshBasicMaterial({ color: 0x34d399, depthTest: false, side: THREE.DoubleSide });
const RING_GEO = new THREE.RingGeometry(0.22, 0.34, 20).rotateX(-Math.PI / 2);
const ARROW_GEO = new THREE.ConeGeometry(0.16, 0.4, 3).rotateZ(-Math.PI / 2);
const ZONE_MATS = {
  slide: new THREE.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.22, depthWrite: false }),
  jump: new THREE.MeshBasicMaterial({ color: 0xff4fa3, transparent: true, opacity: 0.22, depthWrite: false }),
};
const ANCHOR_GEO = new THREE.SphereGeometry(0.18, 10, 8);
const ANCHOR_MAT = new THREE.MeshStandardMaterial({ color: 0xff3b30 });
const zoneGeos = new Map<string, THREE.PlaneGeometry>();
function zoneGeo(hx: number, hz: number) {
  const k = `${hx}x${hz}`;
  let g = zoneGeos.get(k);
  if (!g) {
    g = new THREE.PlaneGeometry(hx * 2, hz * 2).rotateX(-Math.PI / 2);
    zoneGeos.set(k, g);
  }
  return g;
}

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  opts: ViewOptions = { grid: true, ports: true, zones: true, anchors: false, buoys: true };
  onDropModule?: (type: string, x: number, z: number) => void;
  onHover?: (p: Placed | null, clientX: number, clientY: number) => void;

  private objs = new Map<string, ModObj>();
  private siteGroup = new THREE.Group();
  private buoyGroup = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private drag: { start: THREE.Vector3; orig: Map<string, { x: number; z: number }>; moved: boolean; anchor: string } | null = null;
  private downAt: { x: number; y: number } | null = null;
  private siteKey = '';
  private water!: THREE.Mesh;
  private clock = new THREE.Clock();

  constructor(
    private container: HTMLElement,
    private store: Store,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000);
    this.camera.position.set(0, 55, 85);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 600;

    this.setupEnvironment();
    this.scene.add(this.siteGroup, this.buoyGroup);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    this.bindEvents();
    store.on(() => this.sync());
    this.sync();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ environnement

  private setupEnvironment() {
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(200));
    u.sunPosition.value.copy(sunDir);
    this.scene.add(sky);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    this.scene.environment = pmrem.fromScene(envScene as any).texture;

    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a5a78, 0.6));
    this.sun.position.copy(sunDir).multiplyScalar(150);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x1677a8, roughness: 0.35, metalness: 0.0, transparent: true, opacity: 0.92, clearcoat: 0.4, clearcoatRoughness: 0.5 });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 1, 1), waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -0.02;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
    const deep = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x0b3a52 }));
    deep.rotation.x = -Math.PI / 2;
    deep.position.y = -3;
    this.scene.add(deep);
  }

  private buildSite() {
    const { length: L, width: W, depth } = this.store.project.site;
    const key = `${L}x${W}x${depth}`;
    if (key === this.siteKey) return;
    this.siteKey = key;
    this.siteGroup.clear();

    // plage côté rivage (z > W/2)
    const sand = new THREE.Mesh(new THREE.BoxGeometry(L + 400, 2, 60), new THREE.MeshStandardMaterial({ color: 0xe8d3a2, roughness: 1 }));
    sand.position.set(0, -0.7, W / 2 + 30);
    sand.receiveShadow = true;
    this.siteGroup.add(sand);
    const grass = new THREE.Mesh(new THREE.BoxGeometry(L + 400, 2, 300), new THREE.MeshStandardMaterial({ color: 0x6f9b4e, roughness: 1 }));
    grass.position.set(0, -0.5, W / 2 + 60 + 150);
    this.siteGroup.add(grass);

    // fond du plan d'eau utile (teinte selon profondeur)
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ color: 0x2d9cc4, roughness: 1 }));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -Math.min(depth, 2.5) * 0.6;
    this.siteGroup.add(bottom);

    const rect = (hx: number, hz: number, color: number, dashed: boolean, y = 0.03) => {
      const pts = [new THREE.Vector3(-hx, y, -hz), new THREE.Vector3(hx, y, -hz), new THREE.Vector3(hx, y, hz), new THREE.Vector3(-hx, y, hz)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 1, gapSize: 0.7 }) : new THREE.LineBasicMaterial({ color });
      const line = new THREE.LineLoop(geo, m);
      line.computeLineDistances();
      return line;
    };
    this.siteGroup.add(rect(L / 2, W / 2, 0xffffff, false));
    this.siteGroup.add(rect(L / 2 - RULES.edgeMargin, W / 2 - RULES.edgeMargin, 0xffa000, true));

    const grid = new THREE.GridHelper(Math.max(L, W), Math.max(L, W), 0xffffff, 0xffffff);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.06;
    grid.scale.set(L / Math.max(L, W), 1, W / Math.max(L, W));
    grid.position.y = 0.01;
    grid.name = 'grid';
    this.siteGroup.add(grid);

    const s = Math.max(L, W) * 0.75 + 20;
    const cam = this.sun.shadow.camera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.far = 500;
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ synchro projet -> scène

  sync() {
    this.buildSite();
    const grid = this.siteGroup.getObjectByName('grid');
    if (grid) grid.visible = this.opts.grid;
    const { project, selection, derived } = this.store;
    const alive = new Set<string>();
    for (const m of project.modules) {
      alive.add(m.uid);
      let o = this.objs.get(m.uid);
      if (o && o.type !== m.type) {
        this.scene.remove(o.root);
        this.objs.delete(m.uid);
        o = undefined;
      }
      if (!o) o = this.createObj(m);
      o.root.position.set(m.x, 0, m.z);
      o.root.rotation.y = m.rot;
      const flag = derived.flagged.get(m.uid);
      const sel = selection.has(m.uid);
      const lm = o.outline.material as THREE.LineBasicMaterial;
      o.outline.visible = sel || flag === 'error' || flag === 'warning';
      lm.color.setHex(sel ? COLORS.selected : flag === 'error' ? COLORS.error : COLORS.warning);
      this.updateOverlays(m, o);
    }
    for (const [uid, o] of this.objs) {
      if (!alive.has(uid)) {
        this.scene.remove(o.root);
        this.objs.delete(uid);
      }
    }
    this.updateBuoys();
  }

  private createObj(m: Placed): ModObj {
    const s = spec(m.type);
    const root = new THREE.Group();
    root.userData.uid = m.uid;
    const model = buildModel(s);
    model.traverse((c) => (c.userData.uid = m.uid));
    root.add(model);
    const pts = [
      [-s.L / 2, -s.W / 2],
      [s.L / 2, -s.W / 2],
      [s.L / 2, s.W / 2],
      [-s.L / 2, s.W / 2],
    ].map(([x, z]) => new THREE.Vector3(x, 0.25, z));
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLORS.selected, depthTest: false }));
    outline.renderOrder = 10;
    root.add(outline);
    const overlays = new THREE.Group();
    root.add(overlays);
    this.scene.add(root);
    const o = { root, model, outline, overlays, type: m.type };
    this.objs.set(m.uid, o);
    return o;
  }

  private updateOverlays(m: Placed, o: ModObj) {
    o.overlays.clear();
    const s = spec(m.type);
    const used = this.store.derived.graph.usedPorts.get(m.uid) ?? new Set();
    if (this.opts.ports) {
      for (const p of s.ports) {
        if (used.has(p.id)) continue;
        const ring = new THREE.Mesh(RING_GEO, PORT_MAT);
        ring.position.set(p.x, 0.3, p.z);
        ring.renderOrder = 11;
        o.overlays.add(ring);
        // flèche orientée selon la direction sortante (même convention que geometry.rotate)
        const arrow = new THREE.Mesh(ARROW_GEO, PORT_MAT);
        arrow.position.set(p.x + p.dx * 0.5, 0.3, p.z + p.dz * 0.5);
        arrow.rotation.y = Math.atan2(-p.dz, p.dx);
        arrow.renderOrder = 11;
        o.overlays.add(arrow);
      }
    }
    if (this.opts.zones) {
      for (const z of s.zones) {
        const mesh = new THREE.Mesh(zoneGeo(z.hx, z.hz), ZONE_MATS[z.kind]);
        mesh.position.set(z.x, 0.04, z.z);
        o.overlays.add(mesh);
      }
    }
    if (this.opts.anchors) {
      const n = s.anchors;
      const corners = obbCorners({ cx: 0, cz: 0, hx: s.L / 2 + 1.2, hz: s.W / 2 + 1.2, rot: 0 });
      for (let i = 0; i < n; i++) {
        const a = corners[i % 4],
          b = corners[(i + 1) % 4];
        const t = Math.floor(i / 4) * 0.5;
        const pos = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        const buoy = new THREE.Mesh(ANCHOR_GEO, ANCHOR_MAT);
        buoy.position.set(pos.x, 0.05, pos.z);
        o.overlays.add(buoy);
      }
    }
  }

  private updateBuoys() {
    this.buoyGroup.clear();
    if (!this.opts.buoys) return;
    const per = this.store.derived.stats.perimeter;
    if (per.length < 3) return;
    const pts = per.map((p) => new THREE.Vector3(p.x, 0.12, p.z));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.6, gapSize: 0.4 }));
    line.computeLineDistances();
    this.buoyGroup.add(line);
    const geo = new THREE.SphereGeometry(0.22, 10, 8);
    const mats = [new THREE.MeshStandardMaterial({ color: 0xff6a00 }), new THREE.MeshStandardMaterial({ color: 0xffffff })];
    let k = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length];
      const len = a.distanceTo(b);
      for (let d = 0; d < len; d += 1.5) {
        const m = new THREE.Mesh(geo, mats[k++ % 2]);
        m.position.lerpVectors(a, b, d / len);
        this.buoyGroup.add(m);
      }
    }
  }

  refreshOverlays() {
    for (const m of this.store.project.modules) {
      const o = this.objs.get(m.uid);
      if (o) this.updateOverlays(m, o);
    }
    this.sync();
  }

  // ------------------------------------------------------------ interactions

  private ndc(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  groundPoint(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, p) ? p : null;
  }

  private pick(e: { clientX: number; clientY: number }): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const targets = [...this.objs.values()].map((o) => o.model);
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    return hit ? (hit.object.userData.uid as string) : null;
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
      if (e.button !== 0) return;
      const uid = this.pick(e);
      if (!uid) return;
      if (e.shiftKey) {
        this.store.select([uid], true);
        return;
      }
      if (!this.store.selection.has(uid)) this.store.select([uid]);
      const start = this.groundPoint(e);
      if (!start) return;
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      const orig = new Map(this.store.selected().map((m) => [m.uid, { x: m.x, z: m.z }]));
      this.drag = { start, orig, moved: false, anchor: uid };
    });
    el.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const p = this.groundPoint(e);
        if (!p) return;
        const dx = p.x - this.drag.start.x,
          dz = p.z - this.drag.start.z;
        if (!this.drag.moved) {
          if (Math.hypot(dx, dz) < 0.15) return;
          this.drag.moved = true;
          this.store.checkpoint();
        }
        const d = this.drag;
        this.store.live((proj) => {
          const sel = proj.modules.filter((m) => d.orig.has(m.uid));
          const others = proj.modules.filter((m) => !d.orig.has(m.uid));
          for (const m of sel) {
            const o = d.orig.get(m.uid)!;
            m.x = Math.round((o.x + dx) * 4) / 4;
            m.z = Math.round((o.z + dz) * 4) / 4;
          }
          if (sel.length === 1 && !e.altKey) {
            const snap = findSnap(sel[0], others);
            if (snap) {
              sel[0].x = snap.x;
              sel[0].z = snap.z;
              sel[0].rot = snap.rot;
            }
          }
        });
        return;
      }
      if (e.buttons === 0 && this.onHover) {
        const uid = this.pick(e);
        this.onHover(uid ? this.store.get(uid) ?? null : null, e.clientX, e.clientY);
      }
    });
    const end = (e: PointerEvent) => {
      if (this.drag) {
        this.drag = null;
        this.controls.enabled = true;
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        return;
      }
      if (this.downAt && e.button === 0 && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 4 && !this.pick(e)) {
        this.store.select([]);
      }
      this.downAt = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => this.onHover?.(null, 0, 0));
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const type = e.dataTransfer?.getData('text/wibit-module');
      const p = this.groundPoint(e);
      if (type && p) this.onDropModule?.(type, p.x, p.z);
    });
  }

  // ------------------------------------------------------------ caméra

  centerOfView(): { x: number; z: number } {
    return { x: this.controls.target.x, z: this.controls.target.z };
  }

  frameAll(top = false) {
    const mods = this.store.project.modules;
    const { site } = this.store.project;
    let cx = 0,
      cz = 0,
      r = Math.max(site.length, site.width) * 0.6;
    if (mods.length) {
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const m of mods) {
        for (const c of obbCorners(moduleOBB(m, spec(m.type)))) {
          minX = Math.min(minX, c.x);
          maxX = Math.max(maxX, c.x);
          minZ = Math.min(minZ, c.z);
          maxZ = Math.max(maxZ, c.z);
        }
      }
      cx = (minX + maxX) / 2;
      cz = (minZ + maxZ) / 2;
      r = Math.max(maxX - minX, maxZ - minZ) * 0.65 + 8;
    }
    this.controls.target.set(cx, 0, cz);
    if (top) this.camera.position.set(cx, r * 2.3, cz + 0.01);
    else this.camera.position.set(cx + r * 0.6, r * 1.1, cz + r * 1.6);
    this.controls.update();
  }

  focusSelection() {
    const sel = this.store.selected();
    if (!sel.length) return this.frameAll();
    const cx = sel.reduce((a, m) => a + m.x, 0) / sel.length;
    const cz = sel.reduce((a, m) => a + m.z, 0) / sel.length;
    const off = this.camera.position.clone().sub(this.controls.target).setLength(25);
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx + off.x, off.y, cz + off.z);
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private resize() {
    const w = this.container.clientWidth || 1,
      h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const t = this.clock.getElapsedTime();
    (this.water.material as THREE.MeshPhysicalMaterial).clearcoatRoughness = 0.5 + Math.sin(t * 0.7) * 0.05;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
