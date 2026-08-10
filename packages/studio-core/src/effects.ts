/**
 * Effekt-Taxonomie (MS11/ADR-020, geteilt von Item-, Party- und
 * Battle-Pfad): geschlossene, deklarative Record-Liste — kein Code,
 * keine freien Parameterlisten. Die Taxonomie wird als eigenes
 * versioniertes Schema geführt (MS11-Regel, analog glTF-Subset/MS6):
 * `EFFECT_TAXONOMY_VERSION` wird bei jeder Erweiterung erhöht, der
 * Migrationspfad ist dokumentiert. Unbekannte Einträge (art, ziel,
 * element, status) sind Strukturfehler — die Engine verweigert sie
 * später mit Diagnose, das Studio schon beim Laden.
 */

/** Aktuelle Version der Effekt-Taxonomie (eigenes versioniertes Schema). */
export const EFFECT_TAXONOMY_VERSION = 1;

export const EFFECT_ARTEN = [
  'heil_hp',
  'heil_mp',
  'schaden',
  'buff',
  'debuff',
  'status_setzen',
  'status_heilen',
] as const;
export type EffectArt = (typeof EFFECT_ARTEN)[number];

/**
 * Ziel-Auswahl: `wahl_*` = Spieler wählt (Item/Menü), `party`/`selbst`
 * sprechen die eigene Seite an, `gegner_*` sind feste Gegner-Adressierung
 * (typisch für Gegner-Angriffe ohne Wahl).
 */
export const EFFECT_ZIELE = [
  'wahl_einzeln',
  'wahl_gruppe',
  'party',
  'selbst',
  'gegner_einzeln',
  'gegner_gruppe',
] as const;
export type EffectZiel = (typeof EFFECT_ZIELE)[number];

/** Geschlossene Elementliste (MS15: feuer|eis|blitz|… — keine Erweiterung ohne Versionserhöhung). */
export const ELEMENTE = [
  'feuer',
  'eis',
  'blitz',
  'erde',
  'wind',
  'wasser',
  'heilig',
  'schatten',
  'gift',
  'schwerkraft',
] as const;
export type Element = (typeof ELEMENTE)[number];

/**
 * Geschlossene Statusliste des Studios (Studio-eigene Taxonomie, bis das
 * Battle-Modul die Engine-Status-Enumeration liefert — RS13-Migrationspfad
 * über EFFECT_TAXONOMY_VERSION).
 */
export const STATUSWERTE = [
  'gift',
  'schlaf',
  'blind',
  'stumm',
  'frosch',
  'mini',
  'langsam',
  'hast',
  'stop',
  'regen',
  'reflekt',
  'barriere',
  'todesurteil',
  'berserk',
  'paralyse',
  'stein',
  'verwirrung',
  'tod',
] as const;
export type StatusWert = (typeof STATUSWERTE)[number];

/** Effektstärke: absoluter Wert oder Prozent der Zielgröße (geschlossene Alternative). */
export type EffektStaerke = { fest: number } | { prozent: number };

export interface Effekt {
  art: EffectArt;
  ziel: EffectZiel;
  staerke: EffektStaerke;
  element?: Element | undefined;
  status?: StatusWert | undefined;
  /** Wahrscheinlichkeit 0..1 (z. B. für status_setzen). */
  trefferquote?: number | undefined;
}

/**
 * Strukturprüfung eines Effekts gegen die Taxonomie (ADR-020: unbekannte
 * Werte = Strukturfehler). Meldet über die Sink-Signatur von documents.ts,
 * ohne das Modul zu importieren (keine Import-Schleife).
 */
export function checkEffekt(sink: (pfad: string, meldung: string) => void, effekt: unknown, pfad: string): void {
  if (typeof effekt !== 'object' || effekt === null || Array.isArray(effekt)) {
    sink(pfad, 'effekt ist kein Objekt.');
    return;
  }
  const rec = effekt as Record<string, unknown>;
  const art = rec['art'];
  if (typeof art !== 'string' || !(EFFECT_ARTEN as readonly string[]).includes(art)) {
    sink(`${pfad}.art`, `effekt.art muss einer der Taxonomie-Arten sein (${EFFECT_ARTEN.join(' | ')}).`);
  }
  const ziel = rec['ziel'];
  if (typeof ziel !== 'string' || !(EFFECT_ZIELE as readonly string[]).includes(ziel)) {
    sink(`${pfad}.ziel`, `effekt.ziel muss eines der Taxonomie-Ziele sein (${EFFECT_ZIELE.join(' | ')}).`);
  }
  const staerke = rec['staerke'];
  if (typeof staerke !== 'object' || staerke === null || Array.isArray(staerke)) {
    sink(`${pfad}.staerke`, 'effekt.staerke muss {fest: number} oder {prozent: number} sein.');
  } else {
    const s = staerke as Record<string, unknown>;
    const fest = typeof s['fest'] === 'number' && Number.isFinite(s['fest']);
    const prozent = typeof s['prozent'] === 'number' && Number.isFinite(s['prozent']);
    if (fest === prozent) {
      sink(`${pfad}.staerke`, 'effekt.staerke braucht genau eine der Alternativen fest | prozent.');
    }
    if (prozent && ((s['prozent'] as number) < 0 || (s['prozent'] as number) > 100)) {
      sink(`${pfad}.staerke.prozent`, 'effekt.staerke.prozent muss in 0..100 liegen.');
    }
  }
  const element = rec['element'];
  if (element !== undefined && (typeof element !== 'string' || !(ELEMENTE as readonly string[]).includes(element))) {
    sink(`${pfad}.element`, `effekt.element muss aus der geschlossenen Elementliste sein (${ELEMENTE.join(' | ')}).`);
  }
  const status = rec['status'];
  if (status !== undefined && (typeof status !== 'string' || !(STATUSWERTE as readonly string[]).includes(status))) {
    sink(`${pfad}.status`, `effekt.status muss aus der geschlossenen Statusliste sein (${STATUSWERTE.join(' | ')}).`);
  }
  const quote = rec['trefferquote'];
  if (quote !== undefined && (typeof quote !== 'number' || !Number.isFinite(quote) || quote < 0 || quote > 1)) {
    sink(`${pfad}.trefferquote`, 'effekt.trefferquote muss eine Zahl in 0..1 sein.');
  }
}
