// Physics + educational mode (module 'edu'). Off by default; the shell toggles it with the 'edu' event
// (or EduModule.setEnabled). When on it shows:
//   - projected hotspot markers for every entry in ctx.hotspots, with collision-avoiding labels and cards,
//   - force vectors on the vehicle (thrust, weight, net) rendered on top,
//   - the sound-front sphere centred on the ignition point,
//   - the walk HUD (camera mode 'walk'),
//   - the "Physics of this moment" panel (tiles, charts, explainers, sources).
// All text goes through registerStrings / t (English and Finnish), numbers through fmt().
import * as THREE from 'three';
import type { AppContext, CameraModeId, Hotspot, Module } from '../contracts.ts';
import { getLang, onLangChange, registerStrings, t, fmt } from '../i18n.ts';
import { defaultSim, centreOfMassHeight, soundFrontRadius, P } from '../physics/liftoff.ts';
import { en } from './content.en.ts';
import { fi } from './content.fi.ts';
import { DEF_BY_ID, type HotspotDef } from './catalog.ts';
import { HotspotCard } from './card.ts';
import { HotspotMarkers } from './markers.ts';
import { EduPanel } from './panel.ts';
import { WalkHud } from './hud.ts';
import { ForceVectors } from './forces.ts';
import { SoundFront } from './soundfront.ts';
import { h } from './dom.ts';
import './edu.css';

registerStrings({ en, fi });

export interface EduOptions {
  /** Called by the card's "fly to" button; the integrator wires it to controller.focusOn(point, distance). */
  onFocus: (point: THREE.Vector3, distance: number) => void;
}

/** Ignition point: the sound source (on the launch mount deck, above the ground origin). */
const IGNITION = (): THREE.Vector3 => new THREE.Vector3(0, 20, 0);

type ForceKey = 'thrust' | 'weight' | 'net' | 'com' | 'plane';

export class EduModule implements Module {
  readonly name = 'edu';

  /** T_F recomputed by the physics module (spec scene.t_freeze is the cross-check). */
  readonly freezeTime: number;

  private ctx!: AppContext;
  private on = false;
  private mode: CameraModeId = 'photo';
  private root!: HTMLElement;
  private panel!: EduPanel;
  private card!: HotspotCard;
  private markers!: HotspotMarkers;
  private hud!: WalkHud;
  private forces!: ForceVectors;
  private sound!: SoundFront;
  private group = new THREE.Group();
  private flabels!: HTMLElement;
  private flabelEls = new Map<ForceKey, HTMLElement>();
  private soundHotspot!: Hotspot;
  private offs: (() => void)[] = [];
  private layers = { forces: true, sound: true };
  private disposed = false;
  private tmpV = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private lastSig = '';
  private measure = document.createElement('canvas').getContext('2d')!;

  constructor(private opts: EduOptions) {
    this.freezeTime = defaultSim().solveFreezeTime();
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────
  init(ctx: AppContext): void {
    this.ctx = ctx;
    this.root = h('div', { class: 'edu-root', attrs: { hidden: '', 'data-edu': 'root', lang: getLang() } });
    ctx.uiRoot.append(this.root);

    // 3D: forces + sound front, added to the main scene and hidden until enabled
    this.group.name = 'edu-overlay';
    this.forces = new ForceVectors(ctx.anchors);
    this.sound = new SoundFront(IGNITION());
    this.sound.setRadius(soundFrontRadius(this.freezeTime));
    this.group.add(this.forces.group, this.sound.mesh);
    this.group.visible = false;
    ctx.scene.add(this.group);

    // the sound front is itself a hotspot; its pin rides on the sphere (repositioned each frame)
    this.soundHotspot = { id: 'soundfront', position: this.sound.pointAt(new THREE.Vector3(1, 0.1, 0).normalize()), contentKey: 'edu.hotspot.soundfront', category: 'physics', priority: 6 };
    if (!ctx.hotspots.some((x) => x.id === 'soundfront')) ctx.hotspots.push(this.soundHotspot);
    else this.soundHotspot = ctx.hotspots.find((x) => x.id === 'soundfront')!;

    // UI
    this.card = new HotspotCard({
      onFly: (hs, def) => this.fly(hs, def),
      onClose: () => this.markers.setSelected(null),
    });
    this.markers = new HotspotMarkers({ onOpen: (hs, opener) => this.openCard(hs, opener) });
    this.markers.setLabelOverride('soundfront', () => t('edu.sound.label', { r: fmt(this.sound.radius / 1000, 1) }));
    this.panel = new EduPanel(this.freezeTime, {
      onExit: () => this.requestDisable(),
      onCollapse: () => this.markers.invalidate(),
      layers: this.layers,
      onLayer: (id, v) => { this.layers[id] = v; this.applyLayers(); },
    });
    this.hud = new WalkHud();
    this.hud.setFreezeTime(this.freezeTime);
    this.flabels = h('div', { class: 'edu-flabels', attrs: { 'aria-hidden': 'true' } });
    for (const k of ['thrust', 'weight', 'net', 'com', 'plane'] as ForceKey[]) {
      const el = h('div', { class: `edu-flabel is-${k}` });
      this.flabelEls.set(k, el);
      this.flabels.append(el);
    }
    this.root.append(this.markers.el, this.flabels, this.hud.el, this.card.el, this.panel.el);
    this.renderForceLabels();
    this.panel.render();

    // events
    this.offs.push(ctx.events.on('edu', (e) => this.setEnabled(e.enabled)));
    this.offs.push(ctx.events.on('camera-mode', (e) => this.setCameraMode(e.mode)));
    this.offs.push(ctx.events.on('lang', () => this.rerender()));
    this.offs.push(onLangChange(() => this.rerender()));
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.on && this.card.isOpen()) this.card.close(); };
    document.addEventListener('keydown', esc);
    this.offs.push(() => document.removeEventListener('keydown', esc));
    this.onQuality(ctx.quality);
  }

  update(_dt: number, _t: number): void {
    if (!this.on || this.disposed) return;
    const ctx = this.ctx;
    ctx.camera.updateMatrixWorld();
    this.markers.sync(ctx.hotspots);

    // force vectors (in world) and their labels
    const s = defaultSim().stateAt(this.freezeTime);
    if (this.layers.forces) {
      this.forces.update(ctx.camera, s, centreOfMassHeight());
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    const docks: DOMRect[] = [];
    const pr = this.panel.el.getBoundingClientRect(); if (pr.width > 0) docks.push(pr);
    if (this.card.isOpen()) docks.push(this.card.el.getBoundingClientRect());
    if (this.hud.isVisible()) docks.push(this.hud.el.getBoundingClientRect());
    this.placeSoundHotspot(vw, vh, docks);
    const rects = [...docks];
    if (this.layers.forces) rects.push(...this.placeForceLabels(vw, vh));
    this.markers.update(ctx.camera, vw, vh, rects);
    if (this.hud.isVisible()) this.hud.update(ctx.camera.position, ctx.anchors.vehicleBase, IGNITION(), ctx.anchors.plumeImpact);
  }

  onQuality(q: { id: string }): void {
    // the sphere is the only heavy overlay mesh: halve its tessellation on 'low'
    const lowQ = q.id === 'low';
    const seg: [number, number] = lowQ ? [64, 32] : [128, 64];
    this.sound.mesh.geometry.dispose();
    this.sound.mesh.geometry = new THREE.SphereGeometry(1, seg[0], seg[1]);
  }

  dispose(): void {
    this.disposed = true;
    this.offs.forEach((f) => f());
    this.ctx.scene.remove(this.group);
    this.forces.dispose(); this.sound.dispose();
    this.panel.dispose(); this.card.dispose(); this.markers.dispose(); this.hud.dispose();
    this.root.remove();
    const i = this.ctx.hotspots.indexOf(this.soundHotspot);
    if (i >= 0) this.ctx.hotspots.splice(i, 1);
  }

  // ── public controls ─────────────────────────────────────────────────────────────────────
  get enabled(): boolean { return this.on; }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.root.toggleAttribute('hidden', !on);
    this.group.visible = on;
    if (on) {
      this.markers.sync(this.ctx.hotspots);
      this.markers.refreshText();
      this.panel.setCollapsed(window.innerWidth < 640);
      this.panel.render();
      this.updateHud();
    } else {
      this.card.close();
    }
    this.ctx.events.emit({ type: 'reset-accumulation' });
  }

  setCameraMode(mode: CameraModeId): void {
    this.mode = mode;
    this.updateHud();
  }

  /** Open a hotspot card by id (used by tests and the integrator's deep links). */
  openHotspot(id: string): boolean {
    const hs = this.ctx.hotspots.find((x) => x.id === id);
    if (!hs) return false;
    this.openCard(hs, null);
    return true;
  }
  closeCard(): void { this.card.close(); }
  openExplainer(id: string): void { this.panel.openExplainer(id); }
  /** The 3D overlay (force arrows + sound-front sphere). The integrator may reparent it into a post-composite overlay scene. */
  get overlayGroup(): THREE.Group { return this.group; }
  get panelElement(): HTMLElement { return this.panel.el; }
  get cardElement(): HTMLElement { return this.card.el; }
  get hudElement(): HTMLElement { return this.hud.el; }
  get markerLayer(): HotspotMarkers { return this.markers; }
  get forceVectors(): ForceVectors { return this.forces; }
  get soundFront(): SoundFront { return this.sound; }
  get panelControl(): EduPanel { return this.panel; }

  // ── internals ───────────────────────────────────────────────────────────────────────────
  private requestDisable(): void {
    this.setEnabled(false);
    this.ctx.events.emit({ type: 'edu', enabled: false }); // keep the shell's toggle in sync
  }

  private openCard(hs: Hotspot, opener: HTMLElement | null): void {
    this.markers.setSelected(hs.id);
    this.card.open(hs, opener);
    this.markers.invalidate();
  }

  private fly(hs: Hotspot, def: HotspotDef | undefined): void {
    if (hs.id === 'soundfront') { this.opts.onFocus(this.sound.centre.clone(), Math.max(this.sound.radius * 2.3, 6000)); return; }
    this.opts.onFocus(hs.position.clone(), def?.fly ?? DEF_BY_ID[hs.id]?.fly ?? 120);
  }

  private applyLayers(): void {
    this.forces.setVisible(this.layers.forces);
    this.sound.setVisible(this.layers.sound);
    this.flabels.hidden = !this.layers.forces;
    this.soundHotspot.priority = this.layers.sound ? 6 : -1;
    this.markers.invalidate();
  }

  private updateHud(): void {
    const show = this.on && this.mode === 'walk';
    this.hud.show(show);
    if (show) this.hud.update(this.ctx.camera.position, this.ctx.anchors.vehicleBase, IGNITION(), this.ctx.anchors.plumeImpact);
    this.markers.invalidate();
  }

  private rerender(): void {
    this.root.lang = getLang();
    this.panel.render();
    this.card.render();
    this.markers.refreshText();
    this.hud.render();
    this.renderForceLabels();
    this.lastSig = '';
  }

  private renderForceLabels(): void {
    const s = defaultSim().stateAt(this.freezeTime);
    const MN = (v: number) => `${fmt(v / 1e6, 1)} MN`;
    const set = (k: ForceKey, title: string, value?: string, sub?: string) => {
      const el = this.flabelEls.get(k)!;
      el.textContent = '';
      el.append(h('b', { text: title }));
      if (value) el.append(h('span', { class: 'edu-flabel-val', text: value }));
      if (sub) el.append(h('i', { text: sub }));
    };
    set('thrust', t('edu.force.thrust'), MN(s.thrust), t('edu.force.ratio', { ratio: fmt(s.twr, 2) }));
    set('weight', t('edu.force.weight'), MN(s.weight));
    set('net', t('edu.force.net'), MN(s.thrust - s.drag - s.weight));
    set('com', t('edu.force.com'));
    set('plane', t('edu.force.plane'));
  }

  /** Project the force labels; returns their screen rectangles (they are obstacles for the hotspot labels). */
  private placeForceLabels(vw: number, vh: number): DOMRect[] {
    const out: DOMRect[] = [];
    const labels = this.forces.getLabels();
    const cam = this.ctx.camera;
    const sig: string[] = [];
    for (const lb of labels) {
      const el = this.flabelEls.get(lb.id as ForceKey);
      if (!el) continue;
      const v = this.tmpV.copy(lb.world).project(cam);
      const x = (v.x * 0.5 + 0.5) * vw, y = (-v.y * 0.5 + 0.5) * vh;
      const ok = v.z > -1 && v.z < 1 && x > 0 && x < vw && y > 0 && y < vh;
      // small labels (CoM, engine plane) only when the camera is near; big three always
      const big = lb.id === 'thrust' || lb.id === 'weight' || lb.id === 'net';
      const size = this.ctx.camera.position.distanceTo(this.ctx.anchors.vehicleBase);
      const show = ok && size < 2500 && (big || size < 700);
      el.toggleAttribute('hidden', !show);
      if (!show) continue;
      const left = lb.id === 'thrust' || lb.id === 'plane';
      const w = el.offsetWidth || 90, hgt = el.offsetHeight || 34;
      const ox = left ? -w - 12 : 12;
      const oy = lb.id === 'thrust' ? -4 : lb.id === 'weight' ? -hgt + 6 : lb.id === 'net' ? -hgt + 2 : -hgt / 2;
      const px = x + ox, py = y + oy;
      sig.push(`${px | 0},${py | 0}`);
      el.style.transform = `translate(${px}px, ${py}px)`;
      out.push(new DOMRect(px, py, w, hgt));
    }
    void sig;
    return out;
  }

  /** Put the sound-front pin on the part of the sphere that reads best from the current camera. */
  private placeSoundHotspot(vw: number, vh: number, docks: DOMRect[]): void {
    if (!this.layers.sound) return;
    const cam = this.ctx.camera;
    const c = this.sound.centre;
    const r = this.sound.radius;
    const inside = cam.position.distanceTo(c) < r;
    // base azimuth: camera heading (inside) or the direction from the centre toward the camera (outside)
    const fwd = this.tmpD;
    if (inside) { cam.getWorldDirection(fwd); fwd.y = 0; } else { fwd.copy(cam.position).sub(c); fwd.y = 0; }
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const base = Math.atan2(fwd.x, -fwd.z);
    let best = -1, bestScore = Infinity;
    const cand: THREE.Vector3[] = [];
    for (let az = -70; az <= 70; az += 10) {
      for (const el of [3, 9, 18, 32]) {
        const a = base + (az * Math.PI) / 180, e = (el * Math.PI) / 180;
        const d = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
        const p = this.sound.pointAt(d);
        if (!inside && d.dot(new THREE.Vector3().copy(cam.position).sub(c).normalize()) < 0.15) continue;
        const v = p.clone().project(cam);
        const sx = (v.x * 0.5 + 0.5) * vw, sy = (-v.y * 0.5 + 0.5) * vh;
        const hidden = docks.some((d) => sx > d.left - 90 && sx < d.right + 6 && sy > d.top - 20 && sy < d.bottom + 20);
        if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.85 || hidden) { cand.push(p); continue; }
        const score = (v.x - 0.32) ** 2 + (v.y + 0.02) ** 2;
        cand.push(p);
        if (score < bestScore) { bestScore = score; best = cand.length - 1; }
      }
    }
    if (best >= 0) this.soundHotspot.position.copy(cand[best]);
    else this.soundHotspot.position.copy(this.sound.pointAt(new THREE.Vector3(0, 1, 0)));
  }
}

export { P as physicsValue };
