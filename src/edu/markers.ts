// Projected DOM markers for the hotspots, with greedy label-collision avoidance.
//
// Each hotspot is a small pin (a real <button>, so it is in the tab order and has an accessible name) plus
// a text label chip. Labels are placed in priority order (higher first): for each label a ring of candidate
// positions around its pin is tried (right, left, above, below, then farther out on a leader line) and the
// first one that overlaps no already-placed label, no pin, and no docked panel wins. A label that fits nowhere
// is hidden (the pin stays; hover or focus reveals the label). The layout runs only when the camera, the
// viewport, the docked panels or the hotspot set changes, so the frozen scene costs nothing per frame.
import * as THREE from 'three';
import type { Hotspot } from '../contracts.ts';
import { h, t } from './dom.ts';

interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect, pad = 2): boolean =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

interface Item {
  hs: Hotspot;
  wrap: HTMLElement;
  pin: HTMLButtonElement;
  label: HTMLButtonElement;
  width: number;
  px: number; py: number; vis: boolean;
}

const PIN = 18;           // pin hit size (px)
const LABEL_H = 24;

export interface MarkerOptions {
  onOpen: (hs: Hotspot, opener: HTMLElement) => void;
}

export class HotspotMarkers {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private items = new Map<string, Item>();
  private signature = '';
  private selected: string | null = null;
  private labelOverride = new Map<string, () => string>();
  private measure = document.createElement('canvas').getContext('2d')!;
  private vec = new THREE.Vector3();
  private lastCount = -1;

  constructor(private opts: MarkerOptions) {
    this.el = h('div', { class: 'edu-markers', attrs: { role: 'group', 'data-edu': 'markers' } });
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'edu-leaders');
    this.svg.setAttribute('aria-hidden', 'true');
    this.el.append(this.svg);
  }

  /** Text shown for a hotspot label. */
  private textOf(hs: Hotspot): string {
    const o = this.labelOverride.get(hs.id);
    if (o) return o();
    const k = `${hs.contentKey || `edu.hotspot.${hs.id}`}`;
    const short = t(`${k}.short`);
    return short === `${k}.short` ? t(`${k}.title`) : short;
  }
  private titleOf(hs: Hotspot): string {
    const k = `${hs.contentKey || `edu.hotspot.${hs.id}`}`;
    const s = t(`${k}.title`);
    return s === `${k}.title` ? hs.id : s;
  }

  setLabelOverride(id: string, f: () => string): void { this.labelOverride.set(id, f); }

  /** Rebuild the buttons when the hotspot list changes (other modules push theirs during init). */
  sync(list: Hotspot[]): void {
    if (list.length === this.lastCount && list.every((hs) => this.items.get(hs.id)?.hs === hs)) return;
    this.lastCount = list.length;
    for (const it of this.items.values()) it.wrap.remove();
    this.items.clear();
    for (const hs of list) {
      const pin = h('button', { class: 'edu-pin', attrs: { type: 'button', 'data-cat': hs.category, 'data-id': hs.id } });
      const label = h('button', { class: 'edu-hs-label', attrs: { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-id': hs.id } });
      const wrap = h('div', { class: 'edu-hs', attrs: { 'data-cat': hs.category, 'data-id': hs.id } }, pin, label);
      const open = () => this.opts.onOpen(hs, pin);
      pin.addEventListener('click', open);
      label.addEventListener('click', open);
      this.el.append(wrap);
      this.items.set(hs.id, { hs, wrap, pin, label, width: 60, px: 0, py: 0, vis: false });
    }
    this.refreshText();
    this.signature = '';
  }

  /** Re-apply translated text (language change). */
  refreshText(): void {
    this.el.setAttribute('aria-label', t('edu.markers.aria'));
    const ctx = this.measure;
    ctx.font = '600 12px system-ui, sans-serif';
    for (const it of this.items.values()) {
      const txt = this.textOf(it.hs);
      it.label.textContent = txt;
      it.pin.setAttribute('aria-label', t('edu.marker.open', { title: this.titleOf(it.hs) }));
      it.width = Math.ceil(ctx.measureText(txt).width) + 18;
    }
    this.signature = '';
  }

  setSelected(id: string | null): void {
    this.selected = id;
    for (const it of this.items.values()) it.wrap.classList.toggle('is-selected', it.hs.id === id);
  }

  invalidate(): void { this.signature = ''; }

  /** Project and lay out. `obstacles` are viewport-space rectangles (docked panels) that hide pins and labels. */
  update(camera: THREE.PerspectiveCamera, vw: number, vh: number, obstacles: DOMRect[]): void {
    camera.updateMatrixWorld();
    const e = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
    let sig = `${vw}x${vh}|${this.items.size}|`;
    for (let i = 0; i < 16; i++) sig += `${e[i].toFixed(3)},${p[i].toFixed(4)},`;
    for (const o of obstacles) sig += `|${Math.round(o.left)},${Math.round(o.top)},${Math.round(o.width)},${Math.round(o.height)}`;
    for (const it of this.items.values()) sig += `|${it.hs.position.x.toFixed(1)},${it.hs.position.y.toFixed(1)},${it.hs.position.z.toFixed(1)}`;
    if (sig === this.signature) return;
    this.signature = sig;
    this.layout(camera, vw, vh, obstacles);
  }

  private layout(camera: THREE.PerspectiveCamera, vw: number, vh: number, obstacles: DOMRect[]): void {
    const blocked: Rect[] = obstacles.map((o) => ({ x: o.left, y: o.top, w: o.width, h: o.height }));
    const visible: Item[] = [];
    for (const it of this.items.values()) {
      const v = this.vec.copy(it.hs.position).project(camera);
      const x = (v.x * 0.5 + 0.5) * vw, y = (-v.y * 0.5 + 0.5) * vh;
      const inFront = v.z > -1 && v.z < 1;
      const pinRect: Rect = { x: x - PIN / 2, y: y - PIN / 2, w: PIN, h: PIN };
      const onScreen = inFront && x > 6 && x < vw - 6 && y > 6 && y < vh - 6;
      const hidden = !onScreen || blocked.some((b) => overlaps(pinRect, b, 0));
      it.px = x; it.py = y; it.vis = !hidden;
      it.wrap.toggleAttribute('hidden', hidden);
      if (!hidden) { it.pin.style.transform = `translate(${x - PIN / 2}px, ${y - PIN / 2}px)`; visible.push(it); }
    }
    // greedy label placement by priority
    visible.sort((a, b) => b.hs.priority - a.hs.priority || a.hs.id.localeCompare(b.hs.id));
    const placed: Rect[] = visible.map((it) => ({ x: it.px - PIN / 2, y: it.py - PIN / 2, w: PIN, h: PIN }));
    const lines: string[] = [];
    for (const it of visible) {
      const w = it.width, hgt = LABEL_H;
      const cands: [number, number][] = [];
      for (const d of [PIN / 2 + 4, 34, 66]) {
        const r = d;
        cands.push([r, -hgt / 2], [-r - w, -hgt / 2], [-w / 2, -r - hgt], [-w / 2, r]);
        cands.push([r * 0.8, -hgt - r * 0.5], [r * 0.8, r * 0.5], [-r * 0.8 - w, -hgt - r * 0.5], [-r * 0.8 - w, r * 0.5]);
      }
      let chosen: Rect | null = null;
      for (const [dx, dy] of cands) {
        const rect: Rect = { x: it.px + dx, y: it.py + dy, w, h: hgt };
        if (rect.x < 4 || rect.y < 4 || rect.x + w > vw - 4 || rect.y + hgt > vh - 4) continue;
        if (blocked.some((b) => overlaps(rect, b)) || placed.some((p, i) => overlaps(rect, p) && i >= 0)) continue;
        chosen = rect; break;
      }
      const shown = chosen !== null;
      it.label.classList.toggle('is-hidden', !shown);
      const rect = chosen ?? { x: it.px + PIN / 2 + 4, y: it.py - hgt / 2, w, h: hgt };
      it.label.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
      if (chosen) {
        placed.push(chosen);
        const cx = chosen.x + w / 2, cy = chosen.y + hgt / 2;
        const dist = Math.hypot(cx - it.px, cy - it.py);
        if (dist > PIN / 2 + 4 + Math.min(w, 60) * 0.6 + 14) {
          // leader from the pin edge to the nearest point of the label rect
          const tx = Math.min(Math.max(it.px, chosen.x), chosen.x + w), ty = Math.min(Math.max(it.py, chosen.y), chosen.y + hgt);
          lines.push(`<line x1="${it.px.toFixed(1)}" y1="${it.py.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}"/>`);
        }
      }
    }
    this.svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    this.svg.setAttribute('width', String(vw)); this.svg.setAttribute('height', String(vh));
    this.svg.innerHTML = lines.join('');
    if (this.selected) this.setSelected(this.selected);
  }

  get count(): number { return this.items.size; }
  get visibleCount(): number { let n = 0; for (const it of this.items.values()) if (it.vis) n++; return n; }
  get labelledCount(): number { let n = 0; for (const it of this.items.values()) if (it.vis && !it.label.classList.contains('is-hidden')) n++; return n; }

  dispose(): void { this.el.remove(); }
}
