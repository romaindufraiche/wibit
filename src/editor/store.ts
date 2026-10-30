import { buildGraph, type ParkGraph } from '../core/graph';
import type { Issue, Placed, Project } from '../core/types';
import { computeStats, validate, type Stats } from '../rules/validate';

export interface Derived {
  graph: ParkGraph;
  issues: Issue[];
  stats: Stats;
  /** uid -> niveau d'alerte le plus grave */
  flagged: Map<string, Issue['level']>;
}

type Listener = () => void;

export function emptyProject(): Project {
  return {
    version: 1,
    name: 'Nouveau parc',
    site: { length: 80, width: 60, depth: 3.5 },
    audience: 'mixed',
    modules: [],
  };
}

/** État de l'éditeur : projet, sélection, historique annuler / rétablir. */
export class Store {
  project: Project = emptyProject();
  selection = new Set<string>();
  derived!: Derived;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private seq = 0;

  constructor() {
    this.recompute();
    for (const m of this.project.modules) this.bumpSeq(m.uid);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private recompute() {
    const graph = buildGraph(this.project.modules);
    const issues = validate(this.project, graph);
    const stats = computeStats(this.project, graph);
    const rank = { error: 3, warning: 2, info: 1 } as const;
    const flagged = new Map<string, Issue['level']>();
    for (const i of issues) {
      if (i.level === 'info') continue;
      for (const u of i.uids) {
        const cur = flagged.get(u);
        if (!cur || rank[i.level] > rank[cur]) flagged.set(u, i.level);
      }
    }
    this.derived = { graph, issues, stats, flagged };
  }

  private bumpSeq(uid: string) {
    const n = Number(uid.replace(/\D/g, ''));
    if (Number.isFinite(n)) this.seq = Math.max(this.seq, n);
  }

  newUid() {
    return `m${++this.seq}`;
  }

  /** Enregistre l'état courant dans l'historique avant une modification. */
  checkpoint() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Applique une modification (avec historique par défaut). */
  update(fn: (p: Project) => void, history = true) {
    if (history) this.checkpoint();
    fn(this.project);
    this.recompute();
    this.emit();
  }

  /** Mise à jour « en direct » pendant un glisser (sans historique, sans revalidation lourde). */
  live(fn: (p: Project) => void) {
    fn(this.project);
    this.recompute();
    this.emit();
  }

  setProject(p: Project, history = true) {
    if (history) this.checkpoint();
    this.project = p;
    this.selection.clear();
    for (const m of p.modules) this.bumpSeq(m.uid);
    this.recompute();
    this.emit();
  }

  select(uids: string[], additive = false) {
    if (!additive) this.selection.clear();
    for (const u of uids) {
      if (additive && this.selection.has(u)) this.selection.delete(u);
      else this.selection.add(u);
    }
    this.emit();
  }

  selected(): Placed[] {
    return this.project.modules.filter((m) => this.selection.has(m.uid));
  }

  get(uid: string) {
    return this.project.modules.find((m) => m.uid === uid);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.selection = new Set([...this.selection].filter((u) => this.get(u)));
    this.recompute();
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.selection = new Set([...this.selection].filter((u) => this.get(u)));
    this.recompute();
    this.emit();
  }
}
