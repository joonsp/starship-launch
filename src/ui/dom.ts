// Small DOM helpers and accessible widgets (segmented radiogroup, menu, switch, slider). OWNER: src/ui.
// No framework: every widget owns a root element plus imperative setters, so UiShell.update() can
// touch only the controls that changed and never rebuilds DOM.
import { ICONS } from './icons.ts';

type Child = Node | string | null | false | undefined;
type Props = Record<string, string | number | boolean | null | undefined | ((e: any) => void)>;

/** Hyperscript-style element factory. `class`, `html`, `text` and `on*` handlers are special-cased. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

/** Collects text/attribute bindings so a language change can refresh every string in one pass. */
export class Binder {
  private fns: Array<() => void> = [];
  add(fn: () => void): void { this.fns.push(fn); fn(); }
  refresh(): void { for (const f of this.fns) f(); }
}

export const isTextEntry = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button'].includes(el.type);
  return false;
};

let uid = 0;
export const nextId = (p: string): string => `${p}-${++uid}`;

// ── Segmented control (role=radiogroup, roving tabindex, arrow keys) ─────────────────────────────
export interface SegOption<T extends string> { id: T; icon?: string; label: () => string; tip?: () => string; kbd?: string; }

export class Segmented<T extends string> {
  readonly el: HTMLElement;
  private btns = new Map<T, HTMLButtonElement>();
  private labels = new Map<T, HTMLElement>();
  private value: T;
  constructor(private opts: SegOption<T>[], value: T, onSelect: (v: T) => void, cls: string, ariaLabel: () => string, private binder: Binder) {
    this.value = value;
    this.el = h('div', { class: `ui-seg ${cls}`, role: 'radiogroup' });
    binder.add(() => this.el.setAttribute('aria-label', ariaLabel()));
    for (const o of opts) {
      const label = h('span', { class: 'ui-seg-label' });
      const b = h('button', { type: 'button', class: 'ui-seg-btn', role: 'radio', 'data-id': o.id },
        o.icon ? h('span', { class: 'ui-ico', html: o.icon }) : null, label,
        o.kbd ? h('kbd', { class: 'ui-kbd', 'aria-hidden': 'true' }, o.kbd) : null);
      binder.add(() => { label.textContent = o.label(); b.title = o.tip ? o.tip() : o.label(); b.setAttribute('aria-label', o.label()); });
      b.addEventListener('click', () => { this.set(o.id); onSelect(o.id); });
      b.addEventListener('keydown', (e) => {
        const i = opts.findIndex((x) => x.id === this.value);
        let n = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % opts.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i + opts.length - 1) % opts.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = opts.length - 1;
        if (n < 0) return;
        e.preventDefault();
        const id = opts[n].id;
        this.set(id); this.btns.get(id)!.focus(); onSelect(id);
      });
      this.btns.set(o.id, b); this.labels.set(o.id, label); this.el.append(b);
    }
    this.set(value);
  }
  set(v: T): void {
    this.value = v;
    for (const [id, b] of this.btns) {
      const on = id === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('is-on', on);
    }
  }
}

// ── Switch (role=switch) ─────────────────────────────────────────────────────────────────────────
export class Switch {
  readonly el: HTMLButtonElement;
  private on = false;
  constructor(o: { icon?: string; label: () => string; tip?: () => string; kbd?: string; cls?: string }, onToggle: (v: boolean) => void, binder: Binder) {
    const label = h('span', { class: 'ui-sw-label' });
    this.el = h('button', { type: 'button', role: 'switch', class: `ui-btn ui-sw ${o.cls ?? ''}`, 'aria-checked': 'false' },
      o.icon ? h('span', { class: 'ui-ico', html: o.icon }) : null, label,
      h('span', { class: 'ui-sw-track', 'aria-hidden': 'true' }, h('span', { class: 'ui-sw-knob' })),
      o.kbd ? h('kbd', { class: 'ui-kbd', 'aria-hidden': 'true' }, o.kbd) : null);
    binder.add(() => { label.textContent = o.label(); this.el.title = o.tip ? o.tip() : o.label(); });
    this.el.addEventListener('click', () => { this.set(!this.on); onToggle(this.on); });
  }
  set(v: boolean): void { this.on = v; this.el.setAttribute('aria-checked', String(v)); this.el.classList.toggle('is-on', v); }
  get value(): boolean { return this.on; }
}

// ── Button with icon + label ─────────────────────────────────────────────────────────────────────
export function iconButton(o: { icon: string; label: () => string; tip?: () => string; kbd?: string; cls?: string; showLabel?: boolean }, onClick: () => void, binder: Binder): HTMLButtonElement {
  const label = h('span', { class: o.showLabel === false ? 'ui-sr' : 'ui-btn-label' });
  const b = h('button', { type: 'button', class: `ui-btn ${o.cls ?? ''}` }, h('span', { class: 'ui-ico', html: o.icon }), label,
    o.kbd ? h('kbd', { class: 'ui-kbd', 'aria-hidden': 'true' }, o.kbd) : null);
  binder.add(() => { label.textContent = o.label(); b.title = o.tip ? o.tip() : o.label(); });
  b.addEventListener('click', onClick);
  return b;
}

// ── Dropdown menu (menuitemradio) ────────────────────────────────────────────────────────────────
export interface MenuItem<T extends string> { id: T; label: () => string; desc?: () => string; }

export class Menu<T extends string> {
  readonly el: HTMLElement;
  private trigger: HTMLButtonElement;
  private list: HTMLElement;
  private items = new Map<T, HTMLButtonElement>();
  private value: T;
  private valueEl: HTMLElement;
  open = false;
  constructor(private o: { icon: string; caption: () => string; tip: () => string; items: MenuItem<T>[]; cls?: string; shown: (v: T) => string },
    value: T, private onPick: (v: T) => void, private onOpenChange: (m: Menu<T>, open: boolean) => void, private binder: Binder) {
    this.value = value;
    const id = nextId('ui-menu');
    const cap = h('span', { class: 'ui-menu-cap' });
    this.valueEl = h('span', { class: 'ui-menu-val' });
    this.trigger = h('button', { type: 'button', class: 'ui-btn ui-menu-trigger', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': id },
      h('span', { class: 'ui-ico', html: o.icon }), h('span', { class: 'ui-menu-text' }, cap, this.valueEl), h('span', { class: 'ui-ico ui-chev', html: ICONS.chevron }));
    this.list = h('div', { class: 'ui-menu-pop', role: 'menu', id, hidden: true });
    this.el = h('div', { class: `ui-menu ${o.cls ?? ''}` }, this.trigger, this.list);
    binder.add(() => { cap.textContent = o.caption(); this.trigger.title = o.tip(); this.valueEl.textContent = o.shown(this.value); this.list.setAttribute('aria-label', o.caption()); });
    for (const it of o.items) {
      const label = h('span', { class: 'ui-mi-label' });
      const desc = it.desc ? h('span', { class: 'ui-mi-desc' }) : null;
      const b = h('button', { type: 'button', class: 'ui-mi', role: 'menuitemradio', 'aria-checked': 'false', tabindex: '-1' },
        h('span', { class: 'ui-mi-text' }, label, desc), h('span', { class: 'ui-ico ui-mi-check', html: ICONS.check }));
      binder.add(() => { label.textContent = it.label(); if (desc && it.desc) desc.textContent = it.desc(); });
      b.addEventListener('click', () => { this.pick(it.id); });
      b.addEventListener('keydown', (e) => this.onItemKey(e, it.id));
      this.items.set(it.id, b); this.list.append(b);
    }
    this.trigger.addEventListener('click', () => this.setOpen(!this.open, true));
    this.trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.setOpen(true, true); }
    });
    this.set(value);
  }
  private ids(): T[] { return this.o.items.map((i) => i.id); }
  private onItemKey(e: KeyboardEvent, id: T): void {
    const ids = this.ids(); const i = ids.indexOf(id);
    let n = -1;
    if (e.key === 'ArrowDown') n = (i + 1) % ids.length;
    else if (e.key === 'ArrowUp') n = (i + ids.length - 1) % ids.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = ids.length - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.setOpen(false, true); return; }
    else if (e.key === 'Tab') { this.setOpen(false, false); return; }
    if (n >= 0) { e.preventDefault(); this.items.get(ids[n])!.focus(); }
  }
  private pick(id: T): void { this.set(id); this.onPick(id); this.setOpen(false, true); }
  set(v: T): void {
    this.value = v;
    for (const [id, b] of this.items) { const on = id === v; b.setAttribute('aria-checked', String(on)); b.classList.toggle('is-on', on); }
    this.valueEl.textContent = this.o.shown(v);
  }
  /** Re-render the trigger text (language or effective-quality change). */
  refreshText(): void { this.valueEl.textContent = this.o.shown(this.value); }
  setOpen(open: boolean, focus: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.list.hidden = !open;
    this.el.classList.toggle('is-open', open);
    this.trigger.setAttribute('aria-expanded', String(open));
    this.onOpenChange(this, open);
    if (open && focus) (this.items.get(this.value) ?? this.items.values().next().value)?.focus();
    else if (!open && focus) this.trigger.focus();
  }
  contains(n: Node | null): boolean { return !!n && this.el.contains(n); }
}

// ── Slider ───────────────────────────────────────────────────────────────────────────────────────
export class Slider {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private out: HTMLElement;
  dragging = false;
  constructor(o: { label: () => string; min: number; max: number; step: number; value: number; format: (v: number) => string }, private onInput: (v: number) => void, binder: Binder) {
    const id = nextId('ui-sl');
    const lab = h('label', { class: 'ui-sl-label', for: id });
    this.out = h('output', { class: 'ui-sl-out', for: id });
    this.input = h('input', { type: 'range', id, class: 'ui-range', min: o.min, max: o.max, step: o.step, value: o.value }) as HTMLInputElement;
    this.el = h('div', { class: 'ui-sl' }, h('div', { class: 'ui-sl-row' }, lab, this.out), this.input);
    const paint = () => {
      const v = Number(this.input.value);
      this.input.style.setProperty('--p', `${((v - o.min) / (o.max - o.min)) * 100}%`);
      this.out.textContent = o.format(v);
      this.input.setAttribute('aria-valuetext', o.format(v));
    };
    binder.add(() => { lab.textContent = o.label(); paint(); });
    this.input.addEventListener('input', () => { paint(); this.onInput(Number(this.input.value)); });
    this.input.addEventListener('pointerdown', () => { this.dragging = true; });
    const up = () => { this.dragging = false; };
    this.input.addEventListener('pointerup', up); this.input.addEventListener('pointercancel', up); this.input.addEventListener('blur', up);
    this.paint = paint;
  }
  private paint: () => void;
  set(v: number): void {
    if (this.dragging) return;
    if (Math.abs(Number(this.input.value) - v) < 1e-6) return;
    this.input.value = String(v);
    this.paint();
  }
  setDisabled(d: boolean): void { this.input.disabled = d; this.el.classList.toggle('is-disabled', d); }
  repaint(): void { this.paint(); }
}

// ── Modal on top of the native <dialog> (focus trap, Esc, inert page come for free) ────────────
export class Modal {
  readonly el: HTMLDialogElement;
  readonly body: HTMLElement;
  private opener: HTMLElement | null = null;
  constructor(title: () => string, closeLabel: () => string, cls: string, binder: Binder) {
    const id = nextId('ui-dlg');
    const ttl = h('h2', { class: 'ui-modal-title', id });
    const close = h('button', { type: 'button', class: 'ui-btn ui-icon-only', html: ICONS.close });
    this.body = h('div', { class: 'ui-modal-body' });
    const card = h('div', { class: 'ui-modal-card ui-glass', tabindex: '-1' }, h('header', { class: 'ui-modal-head' }, ttl, close), this.body);
    this.el = h('dialog', { class: `ui-modal ${cls}`, 'aria-labelledby': id }, card);
    binder.add(() => { ttl.textContent = title(); close.setAttribute('aria-label', closeLabel()); close.title = closeLabel(); });
    close.addEventListener('click', () => this.close());
    // Click on the backdrop (the dialog element itself, outside the card) closes.
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('close', () => { this.opener?.focus?.(); this.opener = null; });
  }
  get isOpen(): boolean { return this.el.open; }
  show(): void { if (this.el.open) return; this.opener = document.activeElement as HTMLElement | null; this.el.showModal(); (this.el.querySelector('.ui-modal-card') as HTMLElement | null)?.focus({ preventScroll: true }); }
  close(): void { if (this.el.open) this.el.close(); }
}
