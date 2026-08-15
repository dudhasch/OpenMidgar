import { describe, expect, it } from 'vitest';
import {
  LOCALE_VERBUND,
  loeseLocale,
  localeAusPfad,
  localeKandidaten,
  normalisierePfad,
  pruefeVerbund,
  verfuegbareLocales,
  waehleLocale,
  type LocaleAuswahl,
} from './locale.js';

/**
 * Der Baum einer echten Installation, auf die hier geprüften Dateien
 * eingedampft: `lang-en` führt nur eine Teilmenge, und genau daraus entsteht
 * der Mischungsfehler, gegen den `pruefeVerbund` steht.
 */
const BAUM = [
  'data/kernel/KERNEL.BIN',
  'data/kernel/kernel2.bin',
  'data/kernel/WINDOW.BIN',
  'data/battle/scene.bin',
  'data/battle/co.bin',
  'data/battle/camdat0.bin',
  'data/battle/battle.lgp',
  'data/field/flevel.lgp',
  'data/lang-en/kernel/KERNEL.BIN',
  'data/lang-en/kernel/kernel2.bin',
  'data/lang-en/kernel/WINDOW.BIN',
  'data/lang-en/battle/scene.bin',
  'data/lang-en/battle/co.bin',
  'data/lang-en/battle/camdat0.bin',
];
const existiert = (p: string): boolean => BAUM.includes(p);

describe('Pfadnormalisierung', () => {
  it('vereinheitlicht die gemischten Trenner des Originals', () => {
    // Genau die Form, die im Original zusammengesetzt wird: '/' aus der
    // Wurzel, '\' aus dem festverdrahteten Teil.
    expect(normalisierePfad('C:/FF7\\data\\BATTLE')).toBe('C:/FF7/data/BATTLE');
    expect(normalisierePfad('data//kernel///KERNEL.BIN')).toBe('data/kernel/KERNEL.BIN');
    expect(normalisierePfad('./data/battle/')).toBe('data/battle');
  });
});

describe('Locale aus dem Pfad', () => {
  it('erkennt den Sprachzweig, auch mit Wurzelvorsatz und Rückstrichen', () => {
    expect(localeAusPfad('data/lang-en/kernel/KERNEL.BIN')).toBe('en');
    expect(localeAusPfad('C:\\Spiele\\FF7\\data\\lang-de\\battle\\scene.bin')).toBe('de');
    expect(localeAusPfad('data/kernel/KERNEL.BIN')).toBeNull();
  });

  it('hält `lang-` außerhalb von data/ nicht für einen Sprachzweig', () => {
    // Kontrolle: Das Präfix allein darf nicht reichen — sonst würde jede
    // beliebige Ordnerebene mit diesem Namen mitgezählt.
    expect(localeAusPfad('mods/lang-en/kernel/KERNEL.BIN')).toBeNull();
    expect(localeAusPfad('data/battle/lang-en/scene.bin')).toBeNull();
  });

  it('zählt die Zweige der Installation', () => {
    expect(verfuegbareLocales(BAUM)).toEqual(['en']);
    expect(verfuegbareLocales([...BAUM, 'data/lang-de/kernel/KERNEL.BIN'])).toEqual(['de', 'en']);
  });
});

describe('Sprachwahl', () => {
  it('nimmt den Wunsch, wenn die Installation ihn führt', () => {
    expect(waehleLocale(['de', 'en', 'fr'], 'fr')).toBe('fr');
    expect(waehleLocale(['de', 'en'], 'FR')).toBe('en'); // nicht vorhanden ⇒ Vorgabe
  });

  it('entscheidet nicht, wo es nichts zu entscheiden gibt', () => {
    expect(waehleLocale(['de'])).toBe('de');
    expect(waehleLocale([])).toBeNull();
  });

  it('bevorzugt en nur bei echter Auswahl', () => {
    expect(waehleLocale(['de', 'en'])).toBe('en');
    expect(waehleLocale(['de', 'fr'])).toBe('de');
  });
});

describe('Auflösung', () => {
  it('nimmt den Sprachzweig vor der Wurzel und nennt beide Kandidaten', () => {
    const a = loeseLocale('kernel/KERNEL.BIN', 'en', existiert)!;
    expect(a.pfad).toBe('data/lang-en/kernel/KERNEL.BIN');
    expect(a.locale).toBe('en');
    expect(a.geprueft).toEqual(['data/lang-en/kernel/KERNEL.BIN', 'data/kernel/KERNEL.BIN']);
  });

  it('fällt auf die Wurzel zurück, wo der Zweig die Datei nicht führt', () => {
    // Genau der belegte Fall: `lang-en` führt kein battle.lgp.
    const a = loeseLocale('battle/battle.lgp', 'en', existiert)!;
    expect(a.pfad).toBe('data/battle/battle.lgp');
    expect(a.locale).toBeNull();
  });

  it('liefert null statt einer Ausnahme, wenn die Datei nirgends liegt', () => {
    expect(loeseLocale('kernel/GIBTESNICHT.BIN', 'en', existiert)).toBeNull();
  });

  it('kennt ohne Sprachzweig nur einen Kandidaten', () => {
    expect(localeKandidaten('battle/scene.bin', null)).toEqual(['data/battle/scene.bin']);
  });
});

describe('Verbundprüfung', () => {
  const auswahl = (rel: string, locale: string | null): LocaleAuswahl => ({
    pfad: locale ? `data/lang-${locale}/${rel}` : `data/${rel}`,
    rel,
    locale,
    geprueft: [],
  });

  it('lässt einen einheitlichen Zweig durch', () => {
    expect(pruefeVerbund(LOCALE_VERBUND.map((r) => auswahl(r, 'en')))).toBeNull();
    expect(pruefeVerbund(LOCALE_VERBUND.map((r) => auswahl(r, null)))).toBeNull();
  });

  it('schlägt bei der Mischung an, die den Blockindex entwertet', () => {
    const grund = pruefeVerbund([
      auswahl('kernel/KERNEL.BIN', 'en'),
      auswahl('battle/scene.bin', null),
    ]);
    expect(grund).toContain('gemischt');
    expect(grund).toContain('data/lang-en/kernel/KERNEL.BIN');
    expect(grund).toContain('data/battle/scene.bin');
  });

  it('wertet eine Lücke nicht als Verstoß', () => {
    // Eine unvollständige Installation ist kein Mischungsfehler.
    expect(pruefeVerbund([auswahl('kernel/KERNEL.BIN', 'en')])).toBeNull();
  });

  it('sieht nur den Verbund an, nicht jede beliebige Datei', () => {
    // camdat ist zwischen den Zweigen byteidentisch und steht deshalb
    // absichtlich NICHT im Verbund — sonst meldete die Probe einen Fehler,
    // der nachweislich keiner ist.
    expect(
      pruefeVerbund([auswahl('kernel/KERNEL.BIN', 'en'), auswahl('battle/camdat0.bin', null)]),
    ).toBeNull();
  });
});
