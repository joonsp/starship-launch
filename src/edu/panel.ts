// The "Physics of this moment" panel: tabs for Moment (stat tiles + small-multiple charts), Explainers
// (accordion of diagrams and live-number prose) and Sources (every spec value shown, flight caveat,
// research decisions). Docked to the right on desktop, a bottom sheet under 640 px. Everything is built
// with textContent and re-rendered on language change.
import { fmt, t, h, tv, nextId, paragraphs } from './dom.ts';
import { MomentCharts, tableRows } from './charts.ts';
import { defaultSim, P } from '../physics/liftoff.ts';
import { allUiKeys, EXPLAINER_DEFS, type ExplainerDef } from './catalog.ts';
import { keyValue, badgeOf, hostOf } from './keys.ts';
import { diagram } from './diagrams.ts';
import { freezeTimeForMass } from './vars.ts';

export type TabId = 'moment' | 'explain' | 'sources';
const TABS: TabId[] = ['moment', 'explain', 'sources'];

export interface PanelOptions {
  /** Called by the header's exit button. */
  onExit: () => void;
  /** Called when collapse state changes. */
  onCollapse?: (collapsed: boolean) => void;
  /** Layer switches (3D overlays). The panel reads the flags and reports changes. */
  layers: { forces: boolean; sound: boolean };
  onLayer: (id: 'forces' | 'sound', on: boolean) => void;
}

interface Tile { id: string; labelKey: string; value: string; unit: string; sub: string; hero?: boolean }

export class EduPanel {
  readonly el: HTMLElement;
  private head!: HTMLElement;
  private tabs!: HTMLElement;
  private body!: HTMLElement;
  private title!: HTMLElement;
  private tabBtns = new Map<TabId, HTMLButtonElement>();
  private tab: TabId = 'moment';
  private collapsed = false;
  private charts: MomentCharts;
  private tF: number;
  private openEx: string | null = 'tw';
  private collapseBtn!: HTMLButtonElement;

  constructor(tF: number, private opts: PanelOptions) {
    this.tF = tF;
    this.charts = new MomentCharts();
    this.charts.setFreezeTime(tF);
    this.el = h('aside', { class: 'edu-panel ui-glass', attrs: { role: 'complementary', 'data-edu': 'panel', 'data-tab': this.tab } });
    this.build();
  }

  // ── structure ───────────────────────────────────────────────────────────────────────────
  private build(): void {
    this.title = h('h2', { class: 'edu-panel-title', attrs: { id: nextId('edu-title') } });
    this.collapseBtn = h('button', { class: 'edu-iconbtn', attrs: { type: 'button', 'aria-expanded': 'true', 'data-edu': 'collapse' }, on: { click: () => this.setCollapsed(!this.collapsed) } });
    const exit = h('button', { class: 'edu-iconbtn', attrs: { type: 'button', 'data-edu': 'exit' }, on: { click: () => this.opts.onExit() } });
    exit.append(h('span', { class: 'edu-x', attrs: { 'aria-hidden': 'true' } }));
    this.head = h('header', { class: 'edu-panel-head' }, this.title, h('span', { class: 'edu-head-spacer' }), this.collapseBtn, exit);
    this.tabs = h('div', { class: 'edu-tabs', attrs: { role: 'tablist' } });
    for (const id of TABS) {
      const b = h('button', { class: 'edu-tab', attrs: { role: 'tab', type: 'button', id: `edu-tab-${id}`, 'aria-controls': 'edu-tabpanel' }, on: { click: () => this.setTab(id) } });
      b.addEventListener('keydown', (e: KeyboardEvent) => {
        const i = TABS.indexOf(id);
        const n = e.key === 'ArrowRight' ? TABS[(i + 1) % 3] : e.key === 'ArrowLeft' ? TABS[(i + 2) % 3] : null;
        if (n) { this.setTab(n); this.tabBtns.get(n)!.focus(); e.preventDefault(); }
      });
      this.tabBtns.set(id, b);
      this.tabs.append(b);
    }
    this.body = h('div', { class: 'edu-panel-body', attrs: { role: 'tabpanel', id: 'edu-tabpanel', tabindex: '-1' } });
    this.el.append(this.head, this.tabs, this.body);
    this.el.setAttribute('aria-labelledby', this.title.id);
  }

  // ── public ──────────────────────────────────────────────────────────────────────────────
  setTab(id: TabId): void {
    this.tab = id;
    this.el.dataset.tab = id;
    this.render();
    if (id === 'moment') this.charts.attach();
  }

  setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.el.toggleAttribute('data-collapsed', c);
    this.collapseBtn.setAttribute('aria-expanded', String(!c));
    this.render();
    this.opts.onCollapse?.(c);
  }
  isCollapsed(): boolean { return this.collapsed; }

  openExplainer(id: string): void {
    this.openEx = id;
    this.setCollapsed(false);
    this.setTab('explain');
    this.body.querySelector<HTMLElement>(`[data-ex="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  /** Rebuild all text (language change) and the active tab. */
  render(): void {
    this.title.textContent = t('edu.panel.title');
    this.el.setAttribute('aria-label', t('edu.panel.aria'));
    this.collapseBtn.title = this.collapseBtn.ariaLabel = this.collapsed ? t('edu.expand') : t('edu.collapse');
    this.collapseBtn.textContent = '';
    this.collapseBtn.append(h('span', { class: 'edu-chevron', attrs: { 'aria-hidden': 'true' } }));
    const exit = this.el.querySelector<HTMLElement>('[data-edu="exit"]')!;
    exit.title = t('edu.exit'); exit.setAttribute('aria-label', t('edu.exit'));
    for (const id of TABS) {
      const b = this.tabBtns.get(id)!;
      b.textContent = t(`edu.tab.${id}`);
      b.setAttribute('aria-selected', String(id === this.tab));
      b.tabIndex = id === this.tab ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', `edu-tab-${this.tab}`);
    if (this.collapsed) return;
    this.body.textContent = '';
    if (this.tab === 'moment') this.body.append(this.momentTab());
    else if (this.tab === 'explain') this.body.append(this.explainTab());
    else this.body.append(this.sourcesTab());
    if (this.tab === 'moment') { this.charts.retitle(); this.charts.attach(); }
  }

  dispose(): void { this.charts.dispose(); this.el.remove(); }

  // ── moment tab ──────────────────────────────────────────────────────────────────────────
  private tiles(): Tile[] {
    const sim = defaultSim();
    const s = sim.stateAt(this.tF);
    const s0 = sim.series[0];
    const ve = P('raptor_exhaust_velocity_sl_mps');
    const lead = P('engine_start_lead_s');
    return [
      { id: 'time', labelKey: 'edu.tile.time', value: `T+${fmt(this.tF, 1)}`, unit: t('edu.unit.s'), sub: t('edu.tile.time.sub', { lead: fmt(lead) }), hero: true },
      { id: 'alt', labelKey: 'edu.tile.alt', value: fmt(s.altitude), unit: 'm', sub: t('edu.tile.alt.sub', { rise: fmt(s.height) }) },
      { id: 'vel', labelKey: 'edu.tile.vel', value: fmt(s.velocity, 1), unit: 'm/s', sub: t('edu.tile.vel.sub', { kmh: fmt(s.velocity * 3.6) }) },
      { id: 'acc', labelKey: 'edu.tile.acc', value: fmt(s.accel, 2), unit: 'm/s²', sub: t('edu.tile.acc.sub', { g: fmt(s.gLoad, 2) }) },
      { id: 'tw', labelKey: 'edu.tile.tw', value: fmt(s.twr, 2), unit: '', sub: t('edu.tile.tw.sub', { tw0: fmt(s0.twr, 2) }) },
      { id: 'thrust', labelKey: 'edu.tile.thrust', value: fmt(s.thrust / 1e6, 1), unit: 'MN', sub: t('edu.tile.thrust.sub', { weight: fmt(s.weight / 1e6, 1) }) },
      { id: 'mass', labelKey: 'edu.tile.mass', value: fmt(s.mass / 1000), unit: 't', sub: t('edu.tile.mass.sub', { m0: fmt(s0.mass / 1000) }) },
      { id: 'burned', labelKey: 'edu.tile.burned', value: fmt(s.burned / 1000, 0), unit: 't', sub: t('edu.tile.burned.sub') },
      { id: 'mdot', labelKey: 'edu.tile.mdot', value: fmt(s.mdot / 1000, 1), unit: 't/s', sub: t('edu.tile.mdot.sub', { lox: fmt(P('mdot_lox_total_kgps') / 1000, 1), ch4: fmt(P('mdot_ch4_total_kgps') / 1000, 1) }) },
      { id: 've', labelKey: 'edu.tile.ve', value: fmt(ve), unit: 'm/s', sub: t('edu.tile.ve.sub', { isp: fmt(P('raptor3_isp_sl_used_s')) }) },
    ];
  }

  private momentTab(): HTMLElement {
    const root = h('div', { class: 'edu-moment' });
    root.append(h('p', { class: 'edu-lede', text: tv('edu.moment.intro') }));
    const layers = h('div', { class: 'edu-layers', attrs: { role: 'group', 'aria-label': t('edu.layers') } });
    for (const id of ['forces', 'sound'] as const) {
      const sw = h('button', { class: 'edu-switch', text: t(`edu.layer.${id}`), attrs: { type: 'button', role: 'switch', 'aria-checked': String(this.opts.layers[id]), 'data-layer': id } });
      sw.addEventListener('click', () => {
        const on = !this.opts.layers[id];
        this.opts.layers[id] = on;
        sw.setAttribute('aria-checked', String(on));
        this.opts.onLayer(id, on);
      });
      layers.append(sw);
    }
    root.append(layers);
    const grid = h('div', { class: 'edu-tiles' });
    for (const tile of this.tiles()) {
      const el = h('div', { class: `edu-tile${tile.hero ? ' is-hero' : ''}`, attrs: { 'data-tile': tile.id } });
      el.append(
        h('div', { class: 'edu-tile-label', text: t(tile.labelKey) }),
        h('div', { class: 'edu-tile-value' }, h('span', { class: 'edu-num', text: tile.value }), tile.unit ? h('i', { text: ` ${tile.unit}` }) : null),
      );
      if (tile.sub) el.append(h('div', { class: 'edu-tile-sub', text: tile.sub }));
      grid.append(el);
    }
    root.append(grid);
    root.append(h('p', { class: 'edu-fine', text: t('edu.force.scale') }));
    root.append(h('h3', { class: 'edu-h3', text: t('edu.chart.title') }));
    root.append(h('p', { class: 'edu-hint', text: t('edu.chart.hint') }));
    root.append(this.charts.el);
    root.append(h('p', { class: 'edu-fine', text: tv('edu.chart.note') }));
    // accessible table view
    const det = h('details', { class: 'edu-table-view' }, h('summary', { text: t('edu.chart.table') }));
    const tbl = h('table', { class: 'edu-table' });
    const thead = h('thead', {}, h('tr', {}, ...['t', 'alt', 'vel', 'acc', 'mass'].map((c) => h('th', { text: t(`edu.chart.col.${c}`), attrs: { scope: 'col' } }))));
    const tbody = h('tbody');
    for (const r of tableRows(this.tF)) {
      tbody.append(h('tr', { class: r.now ? 'is-now' : '' },
        h('th', { text: (r.now ? `${fmt(r.t, 1)} ← ${t('edu.chart.freeze')}` : fmt(r.t)), attrs: { scope: 'row' } }),
        h('td', { text: fmt(r.alt) }), h('td', { text: fmt(r.vel) }), h('td', { text: fmt(r.acc, 1) }), h('td', { text: fmt(r.mass) })));
    }
    tbl.append(thead, tbody);
    det.append(h('div', { class: 'edu-table-wrap' }, tbl));
    root.append(det);
    return root;
  }

  // ── explainers ──────────────────────────────────────────────────────────────────────────
  private explainTab(): HTMLElement {
    const root = h('div', { class: 'edu-explain' });
    root.append(h('p', { class: 'edu-lede', text: t('edu.ex.intro') }));
    for (const def of EXPLAINER_DEFS) root.append(this.explainer(def));
    return root;
  }

  private explainer(def: ExplainerDef): HTMLElement {
    const title = t(`edu.ex.${def.id}.title`);
    const det = h('details', { class: 'edu-ex', attrs: { 'data-ex': def.id } });
    if (this.openEx === def.id) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) this.openEx = def.id; else if (this.openEx === def.id) this.openEx = null; });
    det.append(h('summary', { text: title }));
    const inner = h('div', { class: 'edu-ex-body' });
    const fig = h('figure', { class: 'edu-fig' });
    fig.innerHTML = diagram(def.diagram, title);
    fig.append(h('figcaption', { text: tv(`edu.ex.${def.id}.cap`) }));
    inner.append(fig, ...paragraphs(tv(`edu.ex.${def.id}.body`)));
    if (def.slider) inner.append(this.massSlider());
    det.append(inner);
    return det;
  }

  private massSlider(): HTMLElement {
    const id = nextId('edu-mass');
    const lo = P('liftoff_mass_published_t'), hi = 5650, mid = P('liftoff_mass_used_t');
    const wrap = h('div', { class: 'edu-slider' });
    const label = h('label', { text: t('edu.ex.tw.slider'), attrs: { for: id } });
    const input = h('input', { attrs: { type: 'range', id, min: String(lo), max: String(hi), step: '10', value: String(mid) } });
    const out = h('p', { class: 'edu-slider-out', attrs: { 'aria-live': 'polite' } });
    const upd = () => {
      const m = Number(input.value);
      const r = freezeTimeForMass(m);
      out.textContent = t('edu.ex.tw.result', { m: fmt(m), tf: fmt(r.tf, 1), v: fmt(r.vAt), tw: fmt(r.twr, 2) });
    };
    input.addEventListener('input', upd);
    upd();
    wrap.append(label, input, out);
    return wrap;
  }

  // ── sources ─────────────────────────────────────────────────────────────────────────────
  private sourcesTab(): HTMLElement {
    const root = h('div', { class: 'edu-sources' });
    root.append(h('p', { class: 'edu-lede', text: t('edu.src.intro') }));
    root.append(h('section', { class: 'edu-callout' }, h('h3', { class: 'edu-h3', text: t('edu.src.flight.title') }), h('p', { text: tv('edu.src.flight.body') })));
    const dec = h('ul', { class: 'edu-list' });
    for (const k of ['thrust', 'mass', 'tower', 'sun', 'height', 'ship', 'freeze']) dec.append(h('li', { text: tv(`edu.src.dec.${k}`) }));
    root.append(h('h3', { class: 'edu-h3', text: t('edu.src.decisions.title') }), dec);
    root.append(h('h3', { class: 'edu-h3', text: t('edu.src.model.title') }), h('p', { text: tv('edu.src.model.body') }));
    // values table
    root.append(h('h3', { class: 'edu-h3', text: t('edu.src.values.title') }));
    const table = h('table', { class: 'edu-table edu-src-table' });
    table.append(h('thead', {}, h('tr', {}, h('th', { text: '', attrs: { scope: 'col' } }), h('th', { text: t('edu.src.col.value'), attrs: { scope: 'col' } }), h('th', { text: t('edu.src.col.status'), attrs: { scope: 'col' } }))));
    const tb = h('tbody');
    for (const key of allUiKeys()) {
      const kv = keyValue(key);
      if (!kv) continue;
      const b = badgeOf(key);
      const noteBits: (Node | string)[] = [];
      if (b.kind === 'src') noteBits.push(b.url ? h('a', { class: 'edu-link', text: hostOf(b.url), attrs: { href: b.url, target: '_blank', rel: 'noopener noreferrer' } }) : b.text);
      else noteBits.push(b.text);
      const statusCell = h('td', {}, badgeStatic(b.kind), h('div', { class: 'edu-src-note' }, ...noteBits));
      tb.append(h('tr', {},
        h('th', { text: t(`edu.k.${key}`), attrs: { scope: 'row' } }),
        h('td', { class: 'edu-src-val' }, h('b', { text: kv.text }), kv.unit ? h('i', { text: ` ${kv.unit}` }) : null),
        statusCell));
    }
    table.append(tb);
    root.append(h('div', { class: 'edu-table-wrap' }, table));
    root.append(h('p', { class: 'edu-fine', text: t('edu.src.model.note') }));
    return root;
  }
}

/** A non-interactive status chip for the Sources table. */
function badgeStatic(kind: 'src' | 'est' | 'model'): HTMLElement {
  const text = kind === 'src' ? t('edu.badge.src') : kind === 'model' ? t('edu.badge.model') : t('edu.badge.est');
  return h('span', { class: `edu-badge is-${kind}`, text });
}
