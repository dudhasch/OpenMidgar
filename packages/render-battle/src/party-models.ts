/**
 * K4 — ZUORDNUNG BATTLE-PRÄFIX → SPIELFIGUR.
 *
 * Die Party wurde bis hierher als blaue Ersatzquader gezeichnet (F26/F33),
 * nicht weil der Lader fehlte — der ist seit K1/K2 vollständig (8979/8979
 * Teile) —, sondern weil die ZUORDNUNG fehlte: welches der 481 Präfixe in
 * battle.lgp welche Figur trägt. Belegt war nur die BEHAUPTUNG „rt = Cloud"
 * aus `docs/quellen/gears-pdf.md` §9.
 *
 * MESSUNG (`tools/realdata-scan/src/battle-party-id.rdtest.ts`, 2026-08-11),
 * drei unabhängige Achsen:
 *
 *  A. **Sichtbefund.** Alle 21 Präfixe des dritten Bands wurden in Bindpose
 *     gerendert (Produktionsregel +len / Wurzel-Frame-X 270°), Front- und
 *     Seitenansicht, 380×470 px, mit Texturen — und angesehen.
 *  B. **Kennzahlen und Byte-Identität.** Bones, Körperteile (`am`…`cj`),
 *     Waffenteile (`ck`…`cz`), Texturen, Dreiecke, `ab`/`da`-Längen; dazu ein
 *     byteweiser Vergleich aller Körper-, Waffen- und Animationsdateien.
 *  C. **Charakterreihenfolge aus kernel.bin** (Sektion 3, Sätze à 132 B,
 *     Name bei +16): Platz 1 Barret, 2 Tifa, 3 Aerith, 5 Yuffie, 7 Sephiroth,
 *     8 Cid; Platz 0/4 belegt aber nicht in der Erwartungsliste, Platz 6 leer.
 *     Das ist die Achse, gegen die die Kontrollhypothese geprüft wird.
 *
 * ```text
 * Präfix Figur          Sichtbefund                          Zweitbeleg
 * ------ -------------- ------------------------------------ --------------------------------
 * rs     🔴 unbestimmt   grün/cremefarbenes Amphibien-        einziges Präfix des Bands ohne
 *                       Kleinmodell, große einfarbige Augen,  Textur UND ohne Waffenteile;
 *                       kein Text auf der Haut                286 Dreiecke = kleinstes Modell
 *                                                             des Bands (nächstes: 1284)
 * rt     Cloud          Stachelhaar blond, blaue Augen,       17 Körperteile + 16 Waffen,
 *                       Schulterpanzer, großes Schwert        2 Texturen; `da` byteidentisch
 *                                                             mit si (s. u.)
 * ru     Tifa           dunkles langes Haar, helles Top,      23 Körperteile + 16 Waffen,
 *                       schwarze Handschuhe                   2 Texturen, 32 Bones
 * rv     Aerith         rosa Kleid, brauner Zopf, rote Jacke  23 Körperteile + 16 Waffen,
 *                                                             2 Texturen, 31 Bones
 * rw     Red XIII       VIERBEINER: rotes Fell, Mähne,        37 Körperteile (mit Abstand die
 *                       Federschmuck, langer Schweif          meisten der „Tiere"), 46 Bones
 * rx     Yuffie         kurzes dunkles Haar, grünes Oberteil, 21 Körperteile + 16 Waffen,
 *                       helle Stiefel                         2 Texturen, 31 Bones
 * ry     Cait Sith      ZWEI KÖRPER: weißer Mogry mit         46 Bones bei nur 29 Körperteilen
 *                       Fledermausflügeln und Krone, Katze    (zwei Skelettäste), 1 Textur
 *                       obenauf
 * rz     Cid            Fliegerbrille auf der Stirn, blaue    19 Körperteile + 16 Waffen,
 *                       Jacke, blondes Haar, Bart             3 Texturen (meiste des Bands)
 * sa     Sephiroth      langer schwarzer Mantel mit weiten    35 Körperteile, 47 Bones,
 *                       Schößen, silbernes langes Haar,       3824 Dreiecke = größtes
 *                       sehr lange dünne Klinge               Menschmodell des Bands
 * sb     Barret         dunkle Haut, Bart, ärmellose Weste,   nur 16 Körperteile (die wenigsten
 * sc     (4 Präfixe,    Metallgürtel — alle vier Präfixe      aller Menschmodelle des Bands);
 * sd     gleicher       liefern ein PIXELIDENTISCHES Bild     Körperdateien NICHT byteidentisch,
 * se     Körper)        (md5-gleiche PNGs)                    Waffensätze zu 0/16 überlappend
 * sf     Vincent        roter Umhang, rotes Stirnband,        34 Körperteile, 47 Bones — auch
 * sg     (3 Präfixe,    schwarzes Haar, hoher Kragen          hier drei pixelidentische Bilder
 * sh     gleicher                                            und drei disjunkte Waffensätze
 *        Körper)
 * si     🟡 Cloud in    dasselbe Gesicht und Haar wie rt,     `da` (Animationsdatei) BYTEGLEICH
 *        anderer Kluft  andere Gürtelschnalle, kein           mit rt, `ab` ebenfalls; gleiche
 *        (Rückblende)   Schulterpanzer                        Bone-Zahl 23, gleiche Teilezahl 33,
 *                                                             aber 5386 statt 3166 Dreiecke
 * sj     🟡 Vincent-    violettes gehörntes Wesen mit roter   keine Textur, KEINE Waffenteile,
 *        Verwandlung 1  Mähne und gelben Klauen               48 Bones
 * sk     🟡 Vincent-    massiger Humanoid, riesiger           keine Textur, keine Waffenteile,
 *        Verwandlung 2  Oberkörper, kleiner Kopf mit Hut      27 Bones
 * sl     Hellmasker     Kapuzengestalt mit Hockeymaske —      keine Textur, keine Waffenteile;
 *        (Vincent)      und einer KETTENSÄGE mit deutlich     die Säge ist Körpergeometrie,
 *                       sichtbaren Sägezähnen                 nicht Waffe
 * sm     Chaos          dunkle Gestalt mit zwei großen        keine Textur, keine Waffenteile,
 *        (Vincent)      ROTEN FLÜGELN                         31 Bones
 * ```
 *
 * 🟢 **Was daran fest ist.** Neun der elf Zeilen sind durch ein unverwechselbares
 * Sichtmerkmal getragen (Vierbeiner, zwei Körper, Kettensäge, rote Flügel,
 * Waffenarm, rosa Kleid, Fliegerbrille, Stachelhaar, silbernes Haar mit langer
 * Klinge) UND durch eine unabhängige Kennzahl.
 *
 * 🟡 **Was offen bleibt.** (1) `rs` ist nicht bestimmt — das Bild spricht für
 * einen Frosch (Toad-Zustand), aber es gibt keinen Zweitbeleg dafür, also
 * bleibt die Zeile 🔴. (2) `sj`/`sk` sind als Vincent-Verwandlungen nur über
 * die Gruppe (texturlos, waffenlos, direkt hinter sl/sm) begründet, nicht
 * einzeln. (3) Welches der vier Barret- bzw. drei Vincent-Präfixe die Engine
 * bei welcher Waffe wählt, ist 🔴 — gemessen ist nur, DASS die Waffensätze
 * disjunkt sind (0/16 Überschneidung in allen geprüften Paaren) und dass
 * 4·16 = 64 bzw. 3·16 = 48 Waffenteile zu je 16 Waffen genau 4 bzw. 3 Teile
 * pro Waffe ergäben.
 *
 * 🟢 **KONTROLLHYPOTHESE „Präfixindex = 460 + charakterId" — SIE FÄLLT.**
 * Mit der besten Verschiebung (k = 0, gemessen am Bandindex) trifft die
 * lineare Regel 5 von 9 Figuren: Tifa (2), Aerith (3), Red XIII (4),
 * Yuffie (5), Cait Sith (6). Sie scheitert an Cloud (Bandindex 1 statt 0),
 * Barret (9 statt 1), Vincent (13 statt 7) und Cid (7 statt 8). Ursache ist
 * gemessen: Barret belegt VIER, Vincent DREI aufeinanderfolgende Präfixe;
 * jede Figur dahinter ist um die Differenz verschoben. Eine lineare Regel
 * kann das nicht abbilden — die Tabelle unten ist keine Bequemlichkeit,
 * sondern notwendig.
 */

/**
 * Charakter-IDs in der Reihenfolge der Anfangsdaten aus kernel.bin
 * (Sektion 3, Sätze à 132 B). Plätze 0…8; Platz 7 trägt in den Anfangsdaten
 * Sephiroth (die Rückblende benutzt Vincents Platz) — 🟡 die Doppelbelegung
 * der Plätze 6/7 durch die Rückblendenfiguren ist damit gestützt, aber nicht
 * für beide Plätze einzeln belegt.
 */
export const CHARACTER_ID = {
  cloud: 0,
  barret: 1,
  tifa: 2,
  aerith: 3,
  redXiii: 4,
  yuffie: 5,
  caitSith: 6,
  vincent: 7,
  cid: 8,
} as const;

export interface PartyModelEntry {
  /** Charakter-ID nach kernel.bin-Reihenfolge; `null` für Rückblenden-/Sonderfiguren. */
  characterId: number | null;
  /** Präfix, das die Engine als Grundmodell laden soll. */
  prefix: string;
  /**
   * Weitere Präfixe DERSELBEN Figur (gemessen: pixelidentischer Körper,
   * disjunkte Waffensätze). Welches Präfix bei welcher Waffe gilt, ist 🔴.
   */
  weaponVariants: readonly string[];
  /** Klartextname — nur für Protokolle und Fehlermeldungen. */
  label: string;
  /** Sicherheit der Zeile: belegt (🟢), gestützt (🟡) oder offen (🔴). */
  confidence: 'belegt' | 'gestuetzt' | 'offen';
}

/** 🟢 Die K4-Tabelle, Präfix → Figur. Belege im Dateikopf. */
export const PARTY_MODELS: readonly PartyModelEntry[] = [
  { characterId: CHARACTER_ID.cloud, prefix: 'rt', weaponVariants: [], label: 'Cloud', confidence: 'belegt' },
  { characterId: CHARACTER_ID.barret, prefix: 'sb', weaponVariants: ['sc', 'sd', 'se'], label: 'Barret', confidence: 'belegt' },
  { characterId: CHARACTER_ID.tifa, prefix: 'ru', weaponVariants: [], label: 'Tifa', confidence: 'belegt' },
  { characterId: CHARACTER_ID.aerith, prefix: 'rv', weaponVariants: [], label: 'Aerith', confidence: 'belegt' },
  { characterId: CHARACTER_ID.redXiii, prefix: 'rw', weaponVariants: [], label: 'Red XIII', confidence: 'belegt' },
  { characterId: CHARACTER_ID.yuffie, prefix: 'rx', weaponVariants: [], label: 'Yuffie', confidence: 'belegt' },
  { characterId: CHARACTER_ID.caitSith, prefix: 'ry', weaponVariants: [], label: 'Cait Sith', confidence: 'belegt' },
  { characterId: CHARACTER_ID.vincent, prefix: 'sf', weaponVariants: ['sg', 'sh'], label: 'Vincent', confidence: 'belegt' },
  { characterId: CHARACTER_ID.cid, prefix: 'rz', weaponVariants: [], label: 'Cid', confidence: 'belegt' },
  { characterId: null, prefix: 'sa', weaponVariants: [], label: 'Sephiroth', confidence: 'belegt' },
  { characterId: null, prefix: 'si', weaponVariants: [], label: 'Cloud (Rückblende)', confidence: 'gestuetzt' },
  { characterId: null, prefix: 'sj', weaponVariants: [], label: 'Vincent-Verwandlung 1', confidence: 'gestuetzt' },
  { characterId: null, prefix: 'sk', weaponVariants: [], label: 'Vincent-Verwandlung 2', confidence: 'gestuetzt' },
  { characterId: null, prefix: 'sl', weaponVariants: [], label: 'Hellmasker (Vincent)', confidence: 'belegt' },
  { characterId: null, prefix: 'sm', weaponVariants: [], label: 'Chaos (Vincent)', confidence: 'belegt' },
  { characterId: null, prefix: 'rs', weaponVariants: [], label: 'unbestimmt', confidence: 'offen' },
];

/**
 * Modellpräfix einer Spielfigur. Gibt `null` zurück, wenn die ID nicht belegt
 * ist — es wird KEIN Präfix geraten (das war der Fehler des alten Laders).
 */
export function partyModelPrefix(characterId: number): string | null {
  return PARTY_MODELS.find((e) => e.characterId === characterId)?.prefix ?? null;
}

/** Tabellenzeile zu einem Präfix — für Protokolle und Sichtprüfungen. */
export function partyModelByPrefix(prefix: string): PartyModelEntry | null {
  return PARTY_MODELS.find((e) => e.prefix === prefix || e.weaponVariants.includes(prefix)) ?? null;
}

/**
 * Kontrollhypothese als CODE, damit sie nicht in Prosa verdunstet: die
 * lineare Regel „Bandindex = charakterId". Der Test rechnet ihre Trefferzahl
 * gegen die Tabelle und hält damit das Kontrollniveau fest (5/9).
 */
export function linearPrefixGuess(characterId: number, band: readonly string[]): string | null {
  return band[characterId] ?? null;
}
