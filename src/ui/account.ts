import type { Project } from '../core/types';
import { parseProject } from '../io/export';
import { esc, h } from './panels';
import { LOGO, icon } from './icons';

/*
 * Compte utilisateur : connexion / inscription et « Mes parcs » enregistrés sur le serveur.
 * Le jeton de session est conservé dans le navigateur (localStorage).
 */

const TOKEN_KEY = 'parkcraft:token';
const USER_KEY = 'parkcraft:user';

export interface User {
  id: number;
  email: string;
  name: string;
  company?: string;
  phone?: string;
  role?: 'user' | 'admin';
}

/** Résumé chiffré du projet envoyé avec chaque enregistrement (tableau de bord administrateur). */
export interface ProjectStats {
  modules: number;
  capacity: number;
  total: number;
  errors: number;
  warnings: number;
  types: Record<string, number>;
}
export interface ParkSummary {
  id: number;
  name: string;
  updated_at: string;
  modules: number;
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* stockage indisponible */
  }
}

export const account = {
  token: read(TOKEN_KEY),
  user: ((): User | null => {
    try {
      return JSON.parse(read(USER_KEY) ?? 'null');
    } catch {
      return null;
    }
  })(),
  /** Identifiant serveur du parc affiché (null = jamais enregistré). */
  currentParkId: null as number | null,

  get loggedIn() {
    return !!this.token && !!this.user;
  },

  get isAdmin() {
    return this.user?.role === 'admin';
  },

  /** Revalide le jeton et rafraîchit le profil (rôle…). */
  async refresh() {
    if (!this.token) return;
    try {
      const r = await this.call<{ user: User }>('GET', '/me');
      this.user = r.user;
      write(USER_KEY, JSON.stringify(r.user));
    } catch {
      /* jeton expiré : déjà déconnecté par call() */
    }
  },

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      throw new Error('Serveur indisponible.');
    }
    if (res.status === 401 && this.token && !path.startsWith('/auth')) this.logout();
    if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
    return data as T;
  },

  async auth(mode: 'login' | 'register', email: string, password: string, extra: { name?: string; company?: string; phone?: string } = {}) {
    const r = await this.call<{ token: string; user: User }>('POST', `/auth/${mode}`, { email, password, ...extra });
    this.token = r.token;
    this.user = r.user;
    write(TOKEN_KEY, r.token);
    write(USER_KEY, JSON.stringify(r.user));
  },

  logout() {
    this.token = null;
    this.user = null;
    this.currentParkId = null;
    write(TOKEN_KEY, null);
    write(USER_KEY, null);
  },

  list: () => account.call<{ parks: ParkSummary[] }>('GET', '/parks').then((r) => r.parks),
  load: (id: number) => account.call<{ park: { id: number; project: Project } }>('GET', `/parks/${id}`).then((r) => r.park),
  remove: (id: number) => account.call('DELETE', `/parks/${id}`),

  async save(project: Project, asNew = false, stats?: ProjectStats): Promise<number> {
    const id = asNew ? null : this.currentParkId;
    const r = id ? await this.call<{ park: { id: number } }>('PUT', `/parks/${id}`, { project, stats }) : await this.call<{ park: { id: number } }>('POST', '/parks', { project, stats });
    this.currentParkId = r.park.id;
    return r.park.id;
  },

  quoteRequest: (id: number, message: string) => account.call('POST', `/parks/${id}/quote-request`, { message }),
};

/**
 * Fenêtre de connexion / création de compte. En mode « accueil » (à l'ouverture de l'outil),
 * elle propose aussi de continuer sans compte.
 */
export function openAuthDialog(onDone: () => void, opts: { welcome?: boolean; onSkip?: () => void; onCancel?: () => void; reason?: string } = {}) {
  const dlg = document.getElementById('auth-dialog') as HTMLDialogElement;
  let mode: 'login' | 'register' = 'login';
  const draw = (err = '') => {
    dlg.innerHTML = `
      <div class="auth">
        <aside class="auth-side">
          <div class="auth-logo">${LOGO}</div>
          <h2>${opts.welcome ? 'Bienvenue' : mode === 'login' ? 'Connexion' : 'Créer un compte'}</h2>
          <p>${esc(opts.reason ?? 'Concevez votre parc aquatique en 3D, obtenez un devis et retrouvez vos projets sur tous vos appareils.')}</p>
          <ul>
            <li>${icon('check', 16)} Projets enregistrés en ligne</li>
            <li>${icon('check', 16)} Devis personnalisé par nos équipes</li>
            <li>${icon('check', 16)} Plan d'ancrage GPS, mode Play</li>
          </ul>
        </aside>
        <form class="auth-form" method="dialog">
          <div class="auth-tabs">
            <button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">Se connecter</button>
            <button type="button" data-m="register" class="${mode === 'register' ? 'on' : ''}">Créer un compte</button>
          </div>
          <div class="fields" style="grid-template-columns:1fr 1fr">
            ${
              mode === 'register'
                ? `<label class="field">Nom<input name="name" autocomplete="name" required></label>
                   <label class="field">Société / site<input name="company" autocomplete="organization" placeholder="Base nautique, camping…"></label>
                   <label class="field full">Téléphone<input name="phone" type="tel" autocomplete="tel"></label>`
                : ''
            }
            <label class="field full">E-mail<input name="email" type="email" required autocomplete="email"></label>
            <label class="field full">Mot de passe<input name="password" type="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
          </div>
          ${err ? `<div class="form-error">${esc(err)}</div>` : ''}
          <button type="submit" class="btn primary auth-submit">${mode === 'login' ? 'Se connecter' : 'Créer mon compte'}</button>
          ${opts.welcome ? '<button type="button" class="link-btn auth-skip" data-a="skip">Continuer sans compte</button>' : '<button type="button" class="link-btn auth-skip" data-a="cancel">Annuler</button>'}
        </form>
      </div>`;
    dlg.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.m as 'login' | 'register';
        draw();
      };
    });
    dlg.querySelector<HTMLElement>('[data-a=cancel]')?.addEventListener('click', () => {
      dlg.close();
      opts.onCancel?.();
    });
    dlg.querySelector<HTMLElement>('[data-a=skip]')?.addEventListener('click', () => {
      dlg.close();
      opts.onSkip?.();
    });
    const form = dlg.querySelector('form')!;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const v = (k: string) => String(fd.get(k) ?? '');
      try {
        await account.auth(mode, v('email'), v('password'), { name: v('name'), company: v('company'), phone: v('phone') });
        dlg.close();
        onDone();
      } catch (er) {
        draw((er as Error).message);
      }
    };
    dlg.querySelector<HTMLInputElement>('input')?.focus();
  };
  draw();
  if (!dlg.open) dlg.showModal();
}

export interface ParksHost {
  current: () => Project;
  stats: () => ProjectStats;
  open: (p: Project) => void;
  toast: (m: string) => void;
  login: () => void;
}

/** Panneau « Mes parcs » (comptes). */
export function parksFlyout(host: ParksHost, rerender: () => void): HTMLElement {
  if (!account.loggedIn) {
    const el = h(`<div><h3>Mes parcs</h3>
      <div class="empty">Connectez-vous pour enregistrer vos parcs en ligne, les retrouver partout et importer un parc existant.</div>
      <div class="btn-row"><button class="btn primary" data-a="login">Se connecter / créer un compte</button></div></div>`);
    el.querySelector<HTMLElement>('[data-a=login]')!.onclick = host.login;
    return el;
  }
  const el = h(`<div>
    <h3>Mes parcs <span class="muted-inline">${esc(account.user!.email)}</span></h3>
    <div class="btn-row" style="margin:0 0 12px">
      <button class="btn primary" data-a="save">${icon('cloud', 15)} Enregistrer le parc affiché</button>
      <button class="btn" data-a="import">Importer un parc…</button>
    </div>
    <div class="park-list"><div class="empty">Chargement…</div></div>
    <div class="btn-row">${account.isAdmin ? '<a class="btn" href="/admin">Administration</a>' : ''}<button class="btn" data-a="logout">Se déconnecter</button></div>
  </div>`);
  const list = el.querySelector<HTMLElement>('.park-list')!;
  el.querySelector<HTMLElement>('[data-a=logout]')!.onclick = () => {
    account.logout();
    host.toast('Déconnecté');
    rerender();
  };
  el.querySelector<HTMLElement>('[data-a=save]')!.onclick = async () => {
    try {
      await account.save(host.current(), false, host.stats());
      host.toast('Parc enregistré dans votre compte');
      rerender();
    } catch (e) {
      host.toast((e as Error).message);
    }
  };
  el.querySelector<HTMLElement>('[data-a=import]')!.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const p = parseProject(await f.text());
        await account.save(p, true);
        host.open(p);
        host.toast(`« ${p.name} » importé dans votre compte`);
        rerender();
      } catch (e) {
        host.toast(`Import impossible : ${(e as Error).message}`);
      }
    };
    input.click();
  };
  account
    .list()
    .then((parks) => {
      list.innerHTML = '';
      if (!parks.length) list.appendChild(h(`<div class="empty">Aucun parc enregistré pour l'instant.</div>`));
      for (const p of parks) {
        const row = h(`<div class="park-row ${p.id === account.currentParkId ? 'current' : ''}">
          <button class="grow" data-a="open"><b>${esc(p.name)}</b><span>${p.modules} modules · ${new Date(p.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span></button>
          <button class="icon-btn danger" data-a="del" title="Supprimer">${icon('trash', 16)}</button></div>`);
        row.querySelector<HTMLElement>('[data-a=open]')!.onclick = async () => {
          try {
            const park = await account.load(p.id);
            account.currentParkId = park.id;
            host.open(park.project);
            rerender();
          } catch (e) {
            host.toast((e as Error).message);
          }
        };
        row.querySelector<HTMLElement>('[data-a=del]')!.onclick = async () => {
          if (!confirm(`Supprimer « ${p.name} » de votre compte ?`)) return;
          await account.remove(p.id).catch((e) => host.toast(e.message));
          if (account.currentParkId === p.id) account.currentParkId = null;
          rerender();
        };
        list.appendChild(row);
      }
    })
    .catch((e) => {
      list.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
    });
  return el;
}
