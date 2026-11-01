import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildRealSite, type LatLon, type RealSiteResult } from '../core/realsite';
import type { Site } from '../core/types';
import { icon } from './icons';
import { esc } from './panels';

/*
 * Fenêtre « Mon site réel » : on cherche une adresse ou on se déplace librement sur la carte
 * satellite, on pose un point à l'endroit du parc ; le contour réel du plan d'eau est détecté
 * (OpenStreetMap) ou dessiné à la main, puis converti en terrain 3D texturé.
 */

interface SearchResult {
  name: string;
  lat: number;
  lon: number;
  bbox?: number[];
  water: boolean;
  rings: LatLon[][];
}

const ZONES: Record<string, [number, number, string]> = {
  all: [0, 0, 'Tout le plan d’eau (jusqu’à 1,5 km)'],
  s: [200, 140, 'Compacte · 200 × 140 m'],
  m: [320, 200, 'Standard · 320 × 200 m'],
  l: [500, 320, 'Large · 500 × 320 m'],
};

export interface SiteMapHost {
  current: Site;
  onApply: (site: Site, label: string) => void;
  toast: (msg: string) => void;
}

export function openSiteMap(host: SiteMapHost) {
  const dlg = document.getElementById('map-dialog') as HTMLDialogElement;
  dlg.innerHTML = `
    <div class="map-layout">
      <aside class="map-side">
        <div class="map-head"><h2>Mon site réel</h2><button class="icon-btn" data-a="close" title="Fermer">${icon('x', 18)}</button></div>
        <div class="map-step"><b>1</b><span>Cherchez une adresse, une commune ou un lac — ou déplacez-vous librement sur la carte.</span></div>
        <div class="search-wrap"><span>${icon('search', 16)}</span><input data-k="q" placeholder="Ex. Lac de Serre-Ponçon, Annecy…" spellcheck="false"></div>
        <div class="map-results"></div>
        <div class="map-step"><b>2</b><span>Cliquez sur l'eau, à l'endroit du futur parc (le point se déplace à la souris).</span></div>
        <div class="map-step"><b>3</b><span>Le contour du plan d'eau est détecté automatiquement (sinon, dessinez-le). Ses berges sont reprises dans la 3D, avec le décor habituel.</span></div>
        <div class="map-status muted">Aucun point posé.</div>
        <div class="btn-row"><button class="btn" data-a="draw">${icon('pen', 15)} Dessiner le contour de l'eau</button></div>
        <div class="fields" style="margin-top:14px">
          <label class="field full">Zone de travail<select data-k="zone">${Object.entries(ZONES)
            .map(([k, v]) => `<option value="${k}" ${k === 'all' ? 'selected' : ''}>${v[2]}</option>`)
            .join('')}</select></label>
          <label class="field">Profondeur (m)<input type="number" min="0.8" max="15" step="0.1" data-k="depth" value="${host.current.depth}"></label>
        </div>
        <div class="map-foot"><button class="btn" data-a="cancel">Annuler</button><button class="btn primary" data-a="apply" disabled>Utiliser ce site</button></div>
      </aside>
      <div class="map-canvas"></div>
    </div>`;
  dlg.showModal();

  const $ = <T extends HTMLElement>(s: string) => dlg.querySelector<T>(s)!;
  const status = (html: string) => ($('.map-status').innerHTML = html);
  const start = host.current.geo ? ([host.current.geo.lat, host.current.geo.lon] as LatLon) : ([46.6, 2.4] as LatLon);
  const map = L.map($('.map-canvas'), { zoomControl: true, attributionControl: true }).setView(start, host.current.geo ? 16 : 6);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics',
  }).addTo(map);
  const plan = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  L.control.layers({ Satellite: sat, Plan: plan }, {}, { position: 'topright' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);

  let point: LatLon | null = null;
  let marker: L.Marker | null = null;
  let rings: LatLon[][] = [];
  let searchRings: LatLon[][] = [];
  let drawn: LatLon[] = [];
  let drawing = false;
  let result: RealSiteResult | null = null;
  const layer = L.layerGroup().addTo(map);
  const drawLayer = L.layerGroup().addTo(map);

  const zoneSize = () => ZONES[$<HTMLSelectElement>('[data-k=zone]').value];
  const preview = () => {
    layer.clearLayers();
    result = null;
    $<HTMLButtonElement>('[data-a=apply]').disabled = true;
    if (!point) return;
    const all = drawn.length >= 3 ? [[...drawn, drawn[0]]] : [...searchRings, ...rings];
    if (!all.length) return;
    const key = $<HTMLSelectElement>('[data-k=zone]').value;
    const [len, wid] = zoneSize();
    result = buildRealSite({ point, rings: all, zone: key === 'all' ? 'all' : { length: len, width: wid }, depth: Number($<HTMLInputElement>('[data-k=depth]').value) || 3 });
    if (!result) {
      status('Le plan d\'eau détecté ne recouvre pas la zone : déplacez le point ou dessinez le contour.');
      return;
    }
    for (const r of all) if (r !== result.ring) L.polygon(r, { color: '#7fb3d5', weight: 1, fillOpacity: 0.05 }).addTo(layer);
    L.polygon(result.ring, { color: '#4ea8ff', weight: 2, fillColor: '#005ee9', fillOpacity: 0.18 }).addTo(layer);
    L.polygon(result.zone, { color: '#c8d400', weight: 2, dashArray: '6 6', fill: false }).addTo(layer);
    // côté plage de la zone (bas de la scène 3D)
    L.polyline([result.zone[2], result.zone[3]], { color: '#c8d400', weight: 5 }).addTo(layer);
    $<HTMLButtonElement>('[data-a=apply]').disabled = false;
    const size = `${Math.round(result.extent)} m`;
    status(
      result.whole
        ? `Plan d'eau de ${size} repris en entier : ses berges deviennent celles du projet. <b>Trait plein = côté plage</b> (en bas dans la scène 3D).`
        : `Plan d'eau de ${size}${key === 'all' ? ' : trop grand pour être repris en entier, zone de 500 × 320 m' : ''}. Zone de travail en pointillés, <b>trait plein = côté plage</b>. Les vraies berges autour restent visibles en 3D.`,
    );
  };

  const detect = async () => {
    if (!point) return;
    if (drawn.length >= 3) return preview();
    // contour déjà connu par la recherche (lac nommé) : aperçu immédiat, affiné ensuite
    if (searchRings.length) preview();
    else status('Recherche du plan d’eau…');
    try {
      const r = await fetch(`/api/geo/water?lat=${point[0]}&lon=${point[1]}&r=900`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      rings = (j.water as { rings: LatLon[][] }[]).flatMap((w) => w.rings);
    } catch (e) {
      rings = [];
      if (!searchRings.length) {
        status(`${esc((e as Error).message || 'Détection impossible')} Utilisez « Dessiner le contour de l'eau ».`);
        return;
      }
    }
    if (!rings.length && !searchRings.length) {
      status('Aucun plan d’eau cartographié ici (mer, gravière récente…). Utilisez « Dessiner le contour de l’eau ».');
      return;
    }
    preview();
  };

  const setPoint = (ll: LatLon) => {
    point = ll;
    if (!marker) {
      marker = L.marker(ll, {
        draggable: true,
        icon: L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(map);
      marker.on('dragend', () => {
        const p = marker!.getLatLng();
        setPoint([p.lat, p.lng]);
      });
    } else marker.setLatLng(ll);
    void detect();
  };

  map.on('click', (e: L.LeafletMouseEvent) => {
    const ll: LatLon = [e.latlng.lat, e.latlng.lng];
    if (drawing) {
      drawn.push(ll);
      drawLayer.clearLayers();
      L.polyline(drawn, { color: '#c8d400', weight: 2 }).addTo(drawLayer);
      for (const p of drawn) L.circleMarker(p, { radius: 4, color: '#003865', fillColor: '#c8d400', fillOpacity: 1 }).addTo(drawLayer);
      return;
    }
    setPoint(ll);
  });

  // dessin manuel du contour
  $('[data-a=draw]').onclick = () => {
    if (!drawing) {
      drawing = true;
      drawn = [];
      drawLayer.clearLayers();
      $('[data-a=draw]').innerHTML = `${icon('check', 15)} Terminer le contour`;
      status('Cliquez le long de la berge pour poser les points du contour, puis « Terminer le contour ».');
      return;
    }
    drawing = false;
    $('[data-a=draw]').innerHTML = `${icon('pen', 15)} Redessiner le contour`;
    drawLayer.clearLayers();
    if (drawn.length < 3) {
      drawn = [];
      status('Il faut au moins 3 points pour un contour.');
      return;
    }
    L.polygon(drawn, { color: '#c8d400', weight: 2, fillOpacity: 0.1 }).addTo(drawLayer);
    if (!point) {
      const c = drawn.reduce((a, p) => [a[0] + p[0] / drawn.length, a[1] + p[1] / drawn.length], [0, 0]) as LatLon;
      setPoint(c);
    } else preview();
  };

  // recherche d'adresse
  let timer = 0;
  const q = $<HTMLInputElement>('[data-k=q]');
  const results = $('.map-results');
  const runSearch = async () => {
    const v = q.value.trim();
    if (v.length < 3) return (results.innerHTML = '');
    results.innerHTML = '<div class="muted">Recherche…</div>';
    try {
      const r = await fetch(`/api/geo/search?q=${encodeURIComponent(v)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const list = j.results as SearchResult[];
      results.innerHTML = list.length ? '' : '<div class="muted">Aucun résultat.</div>';
      for (const res of list) {
        const b = document.createElement('button');
        b.className = 'map-result';
        b.innerHTML = `${res.water ? '<span class="tag">plan d’eau</span>' : ''}${esc(res.name)}`;
        b.onclick = () => {
          results.innerHTML = '';
          searchRings = res.water ? res.rings : [];
          if (res.bbox) map.fitBounds([
            [res.bbox[0], res.bbox[2]],
            [res.bbox[1], res.bbox[3]],
          ]);
          else map.setView([res.lat, res.lon], 16);
          status(res.water ? 'Lac trouvé : cliquez à l’endroit du parc, près de la plage.' : 'Cliquez sur l’eau à l’endroit du parc.');
        };
        results.appendChild(b);
      }
    } catch (e) {
      results.innerHTML = `<div class="muted">${esc((e as Error).message || 'Recherche indisponible')}</div>`;
    }
  };
  q.oninput = () => {
    clearTimeout(timer);
    timer = window.setTimeout(runSearch, 450);
  };
  q.onkeydown = (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      void runSearch();
    }
  };
  $<HTMLSelectElement>('[data-k=zone]').onchange = preview;
  $<HTMLInputElement>('[data-k=depth]').onchange = preview;

  const close = () => {
    map.remove();
    dlg.close();
  };
  $('[data-a=close]').onclick = close;
  $('[data-a=cancel]').onclick = close;
  $('[data-a=apply]').onclick = () => {
    if (!result) return;
    const label = q.value.trim() || 'Site réel';
    host.onApply(result.site, label);
    close();
  };
  dlg.addEventListener('cancel', () => map.remove(), { once: true });
  if (host.current.geo) setPoint([host.current.geo.lat, host.current.geo.lon]);
}
