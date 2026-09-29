// Minimal i18n registry. OWNER: orchestrator. Each module registers its own strings:
//   registerStrings({ en: { 'ui.orbit': 'Orbit' }, fi: { 'ui.orbit': 'Kiertokamera' } });
// then calls t('ui.orbit'). Keys are namespaced by module (ui.*, edu.*, lens.*, preset.*, ...).
// Components re-render on language change via onLangChange().
import type { Lang } from './contracts.ts';

const dict: Record<Lang, Record<string, string>> = { en: {}, fi: {} };
let lang: Lang = 'en';
const listeners = new Set<(l: Lang) => void>();

export function registerStrings(s: Partial<Record<Lang, Record<string, string>>>): void {
  for (const l of Object.keys(s) as Lang[]) Object.assign(dict[l], s[l]);
}

/** Translate; {name} placeholders are filled from vars. Falls back to English, then the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dict[lang][key] ?? dict.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

export function getLang(): Lang { return lang; }
export function setLang(l: Lang): void { lang = l; document.documentElement.lang = l; listeners.forEach((f) => f(l)); }
export function onLangChange(f: (l: Lang) => void): () => void { listeners.add(f); return () => listeners.delete(f); }

/** Keys present in English but missing in Finnish (for QA). */
export function missingTranslations(): string[] { return Object.keys(dict.en).filter((k) => !(k in dict.fi)); }

/** Format a number with the locale's decimal separator (fi uses a comma and a narrow no-break space for thousands). */
export function fmt(n: number, digits = 0): string {
  return n.toLocaleString(lang === 'fi' ? 'fi-FI' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
