import { account } from '../ui/account';

/*
 * Suivi d'activité (comptes connectés uniquement) : alimente le tableau de bord administrateur
 * — temps passé (une pulsation par minute active), générations, exports, demandes de devis…
 */

interface TrackEvent {
  type: string;
  park_id?: number;
  data?: Record<string, unknown>;
}

const queue: TrackEvent[] = [];
let lastInput = Date.now();

export function track(type: string, data?: Record<string, unknown>) {
  if (!account.loggedIn) return;
  queue.push({ type, park_id: account.currentParkId ?? undefined, data });
  if (queue.length >= 20) void flush();
}

export async function flush() {
  if (!queue.length || !account.loggedIn) return;
  const events = queue.splice(0);
  try {
    await fetch('/api/events', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ events }),
    });
  } catch {
    /* hors ligne : tant pis pour ces événements */
  }
}

export function initTracking() {
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => (lastInput = Date.now()), { passive: true });
  setInterval(() => {
    // une minute « active » = onglet visible et interaction dans la dernière minute
    if (document.visibilityState === 'visible' && Date.now() - lastInput < 60_000) track('heartbeat');
    void flush();
  }, 60_000);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}
