// Tiny DOM helpers shared by the educational-mode UI. All text goes through textContent (spec strings,
// URLs and translations are treated as data), never innerHTML, except for the diagram SVG strings that
// this module itself builds from escaped text.
import { t, fmt } from '../i18n.ts';
import { hostOf, keyValue, type Badge } from './keys.ts';
import { templateVars } from './vars.ts';

type Child = Node | string | null | undefined | false;
interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: any) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Translate with the live template variables filled in ({name} placeholders). */
export function tv(key: string, extra?: Record<string, string | number>): string {
  return t(key, { ...templateVars(), ...(extra ?? {}) });
}

let uid = 0;
export const nextId = (prefix: string): string => `${prefix}-${++uid}`;

/** Provenance badge: a link for sourced values, a button that reveals the note for estimates and model values. */
export function badge(b: Badge, noteHost?: (note: HTMLElement) => void): HTMLElement {
  if (b.kind === 'src') {
    const a = h('a', { class: 'edu-badge is-src', text: t('edu.badge.src') + ' ↗', attrs: { target: '_blank', rel: 'noopener noreferrer', title: t('edu.badge.src.tip') + (b.url ? ` (${hostOf(b.url)})` : '') } });
    if (b.url) a.href = b.url; else a.removeAttribute('href');
    if (!b.url) { a.setAttribute('role', 'text'); a.title = b.text; }
    return a;
  }
  const label = b.kind === 'model' ? t('edu.badge.model') : t('edu.badge.est');
  const noteText = b.kind === 'model' ? t('edu.badge.model.tip') : t('edu.badge.est.tip', { note: b.text });
  const btn = h('button', { class: `edu-badge is-${b.kind}`, text: label, attrs: { type: 'button', title: noteText, 'aria-expanded': 'false' } });
  if (noteHost) {
    const note = h('p', { class: 'edu-note', text: noteText, attrs: { hidden: '' } });
    btn.addEventListener('click', () => {
      const open = note.hasAttribute('hidden');
      note.toggleAttribute('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
    });
    noteHost(note);
  }
  return btn;
}

/** One "key number" row: label, live value + unit, provenance badge (+ a "sources differ" note when the research conflicted). */
export function keyRow(key: string): HTMLElement | null {
  const kv = keyValue(key);
  if (!kv) return null;
  const li = h('li', { class: 'edu-kn' });
  const badges = h('span', { class: 'edu-kn-badges' });
  const notes: HTMLElement[] = [];
  badges.append(badge(kv.badge, (n) => notes.push(n)));
  if (kv.differs) {
    const noteText = tv(kv.differs);
    const b = h('button', { class: 'edu-badge is-differs', text: t('edu.differs.label'), attrs: { type: 'button', title: noteText, 'aria-expanded': 'false' } });
    const note = h('p', { class: 'edu-note', text: noteText, attrs: { hidden: '' } });
    b.addEventListener('click', () => { const open = note.hasAttribute('hidden'); note.toggleAttribute('hidden', !open); b.setAttribute('aria-expanded', String(open)); });
    badges.append(b); notes.push(note);
  }
  li.append(
    h('span', { class: 'edu-kn-label', text: t(`edu.k.${key}`) }),
    h('span', { class: 'edu-kn-val' }, h('b', { text: kv.text }), kv.unit ? h('i', { text: ` ${kv.unit}` }) : null),
    badges,
    ...notes,
  );
  return li;
}

/** Split a translated body into paragraphs. */
export function paragraphs(text: string): HTMLElement[] {
  return text.split(/\n\n+/).map((p) => h('p', { text: p }));
}

export { fmt, t };
