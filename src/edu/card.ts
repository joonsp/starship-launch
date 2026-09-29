// The hotspot card: title, body (60-120 words, numbers filled live), key numbers with provenance badges,
// and a "fly to" button. Docked to the left on desktop (the panel takes the right), a bottom sheet on
// phones. Non-modal: focus moves to the card when it opens, Escape or the close button returns it.
import type { Hotspot } from '../contracts.ts';
import { DEF_BY_ID, type HotspotDef } from './catalog.ts';
import { h, keyRow, nextId, paragraphs, t, tv } from './dom.ts';

export interface CardOptions {
  onFly: (hs: Hotspot, def: HotspotDef | undefined) => void;
  onClose: (hs: Hotspot) => void;
}

export class HotspotCard {
  readonly el: HTMLElement;
  private current: Hotspot | null = null;
  private opener: HTMLElement | null = null;

  constructor(private opts: CardOptions) {
    this.el = h('aside', { class: 'edu-card ui-glass', attrs: { role: 'dialog', 'aria-modal': 'false', hidden: '', 'data-edu': 'card' } });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }

  get hotspot(): Hotspot | null { return this.current; }

  open(hs: Hotspot, opener?: HTMLElement | null): void {
    this.current = hs;
    this.opener = opener ?? null;
    this.render();
    this.el.removeAttribute('hidden');
    this.el.querySelector<HTMLElement>('.edu-card-title')?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.current) return;
    const hs = this.current;
    this.current = null;
    this.el.setAttribute('hidden', '');
    this.opts.onClose(hs);
    this.opener?.focus({ preventScroll: true });
    this.opener = null;
  }

  isOpen(): boolean { return this.current !== null; }

  /** Rebuild after a language change. */
  render(): void {
    const hs = this.current;
    if (!hs) return;
    const def = DEF_BY_ID[hs.id];
    const key = hs.contentKey || `edu.hotspot.${hs.id}`;
    const title = t(`${key}.title`) === `${key}.title` ? hs.id : t(`${key}.title`);
    const titleId = nextId('edu-card-title');
    this.el.textContent = '';
    this.el.setAttribute('aria-labelledby', titleId);
    this.el.dataset.cat = hs.category;

    const close = h('button', { class: 'edu-iconbtn', attrs: { type: 'button', title: t('edu.card.close'), 'aria-label': t('edu.card.close') }, on: { click: () => this.close() } },
      h('span', { class: 'edu-x', attrs: { 'aria-hidden': 'true' } }));
    const head = h('header', { class: 'edu-card-head' },
      h('div', { class: 'edu-card-titles' },
        h('span', { class: 'edu-cat', text: t(`edu.cat.${hs.category}`) }),
        h('h2', { class: 'edu-card-title', text: title, attrs: { id: titleId, tabindex: '-1' } })),
      close);
    const body = h('div', { class: 'edu-card-body' }, ...paragraphs(tv(`${key}.body`)));
    this.el.append(head, body);
    if (def && def.keys.length) {
      const list = h('ul', { class: 'edu-kn-list' });
      for (const k of def.keys) { const r = keyRow(k); if (r) list.append(r); }
      this.el.append(h('h3', { class: 'edu-h3', text: t('edu.card.keynums') }), list);
    }
    this.el.append(h('footer', { class: 'edu-card-foot' },
      h('button', { class: 'edu-btn', text: t('edu.card.flyto'), attrs: { type: 'button', 'data-edu': 'fly' }, on: { click: () => this.opts.onFly(hs, def) } })));
  }

  dispose(): void { this.el.remove(); }
}
