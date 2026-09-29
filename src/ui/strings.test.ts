// QA for the UI shell strings: EN/FI parity and no dangling keys. Runs in node (no DOM needed).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getLang, missingTranslations, setLang, t } from '../i18n.ts';
import './strings.ts';
import { LOADING_STAGES, MODE_ORDER, PRESET_ORDER, QUALITY_ORDER } from './types.ts';

// setLang touches document.documentElement; give node a stub.
(globalThis as any).document ??= { documentElement: {} };

describe('ui strings', () => {
  it('every English ui.* key has a Finnish translation', () => {
    expect(missingTranslations().filter((k) => k.startsWith('ui.'))).toEqual([]);
  });

  it('every literal ui.* key used in src/ui resolves', () => {
    const dir = new URL('.', import.meta.url);
    const used = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!/\.ts$/.test(f) || f.endsWith('.test.ts') || f === 'strings.ts') continue;
      for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/['"`](ui\.[a-z]+(?:\.[a-zA-Z]+)*)['"`]/g)) used.add(m[1]);
    }
    for (const k of used) expect(t(k), k).not.toBe(k);
  });

  it('dynamic key families exist in both languages', () => {
    const keys = [
      ...MODE_ORDER.flatMap((m) => [`ui.mode.${m}`, `ui.mode.${m}.tip`]),
      ...PRESET_ORDER.flatMap((p) => [`ui.preset.${p}`, `ui.preset.${p}.s`, `ui.preset.${p}.d`]),
      ...QUALITY_ORDER.flatMap((q) => [`ui.quality.${q}`, `ui.quality.${q}.d`]),
      ...LOADING_STAGES.map((s) => `ui.loading.${s}`),
    ];
    for (const l of ['en', 'fi'] as const) {
      setLang(l);
      expect(getLang()).toBe(l);
      for (const k of keys) expect(t(k), `${l}:${k}`).not.toBe(k);
    }
    setLang('en');
  });

  it('fills placeholders and keeps unknown ones', () => {
    setLang('fi');
    expect(t('ui.badge', { t: '7,2' })).toBe('PYSÄYTYSKUVA · T+7,2 s');
    setLang('en');
    expect(t('ui.badge', { t: '7.2' })).toBe('FREEZE-FRAME · T+7.2 s');
  });
});
