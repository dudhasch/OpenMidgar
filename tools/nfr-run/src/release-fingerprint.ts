/**
 * R5 — Release-Fingerprints und Variantenklassifikation.
 *
 * Der bestehende Archiv-Fingerprint aus `@webmidgar/io` ist ein **Cache-Key**:
 * Er enthält Pfad, Größe und mtime, damit jede Quelländerung einen Rescan
 * erzwingt (ADR-008). Genau das macht ihn als Release-Kennung unbrauchbar —
 * eine Kopie derselben Datei hat einen anderen mtime und damit einen anderen
 * Fingerprint, obwohl es dasselbe Release ist.
 *
 * Der **Release-Fingerprint** hier ist deshalb rein inhaltsstrukturell: er
 * hasht die Verzeichnisstruktur des Archivs (Anzahl, Namen, Offsets,
 * Prüfbytes, Konfliktindizes) und ignoriert alles Dateisystemseitige. Zwei
 * Installationen desselben Releases liefern denselben Wert, eine gepatchte
 * Variante nicht.
 *
 * Assetfreiheit: Ausgabe sind ausschließlich Digests, Zähler und Histogramme
 * über Namensendungen. Es verlässt kein Dateiname und kein Byte des Inhalts
 * diese Funktionen.
 */

import type { ArchiveIndexData, LgpEntry } from '@webmidgar/formats-lgp';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Inhaltsstruktureller Fingerprint eines LGP-Archivs. Bewusst NICHT über die
 * Nutzdaten: das wäre ein Vollscan von über 100 MB je Archiv und würde die
 * Beta-Diagnose unbrauchbar langsam machen. Die TOC-Struktur (welche
 * Einträge, an welchen Offsets, mit welchem Prüfbyte) identifiziert einen
 * Archivbuild bereits eindeutig genug — sie ändert sich bei jedem
 * Neuverpacken.
 */
export async function releaseFingerprint(index: ArchiveIndexData): Promise<string> {
  const zeilen = [...index.entries]
    .sort((a, b) => a.tocIndex - b.tocIndex)
    .map((e) => `${e.rawName}|${e.offset}|${e.checkByte}|${e.conflictIndex}`);
  return sha256Hex(`${index.entryCount}\n${zeilen.join('\n')}`);
}

/** Kurzform für Tabellen — 16 Hexstellen genügen für die Matrix. */
export function kurz(fingerprint: string): string {
  return fingerprint.slice(0, 16);
}

export interface ArchivProfil {
  /** Archivname ohne Endung (klein) — Struktur, kein Nutzerpfad. */
  archiv: string;
  releaseFingerprint: string;
  eintraege: number;
  dateiBytes: number;
  /** Endung → Anzahl (Endungslose zählen als '<ohne>'). */
  endungen: Record<string, number>;
  /** Einträge in Konfliktgruppen (gleicher Kurzname, verschiedene Quellordner). */
  konfliktEintraege: number;
  quarantaene: number;
  verschattet: number;
  terminatorOk: boolean;
  lookupReproduzierbar: boolean;
  diagnoseKlassen: Record<string, number>;
}

export function archivProfil(index: ArchiveIndexData): ArchivProfil {
  const endungen: Record<string, number> = {};
  let konflikt = 0;
  let quarantaene = 0;
  let verschattet = 0;
  for (const e of index.entries as LgpEntry[]) {
    const punkt = e.name.lastIndexOf('.');
    const endung = punkt > 0 ? e.name.slice(punkt + 1).toLowerCase() : '<ohne>';
    endungen[endung] = (endungen[endung] ?? 0) + 1;
    if (e.conflictIndex > 0) konflikt++;
    if (e.quarantined) quarantaene++;
    if (e.shadowed) verschattet++;
  }
  const diagnoseKlassen: Record<string, number> = {};
  for (const d of index.diagnostics) diagnoseKlassen[d.code] = (diagnoseKlassen[d.code] ?? 0) + 1;

  return {
    archiv: index.archiveName,
    releaseFingerprint: '',
    eintraege: index.entryCount,
    dateiBytes: index.fileSize,
    endungen,
    konfliktEintraege: konflikt,
    quarantaene,
    verschattet,
    terminatorOk: index.terminatorOk,
    lookupReproduzierbar: index.lookupReproducible,
    diagnoseKlassen,
  };
}

export async function profilMitFingerprint(index: ArchiveIndexData): Promise<ArchivProfil> {
  return { ...archivProfil(index), releaseFingerprint: await releaseFingerprint(index) };
}

// --- Registry bekannter Releases -------------------------------------------

export interface BekanntesRelease {
  /** Kurzfingerprint (16 Hexstellen). */
  kurz: string;
  archiv: string;
  bezeichnung: string;
  /** Wie der Eintrag belegt ist — nie geraten. */
  herkunft: string;
}

/**
 * Bekannte Release-Fingerprints. Jeder Eintrag stammt aus einer eigenen
 * Messung; es steht hier **kein** Wert, der nicht gemessen wurde. Die Liste
 * wächst mit der Beta (Diagnose-Export der Nutzer), sie ist bewusst kurz und
 * ehrlich statt vollständig und geraten.
 */
export const BEKANNTE_RELEASES: readonly BekanntesRelease[] = [
  {
    kurz: 'e5db628390bfe061',
    archiv: 'flevel',
    bezeichnung: 'flevel-basisvariante-729',
    herkunft: 'Lokale Messung 2026-08-10 (S20-Fingerprint-Lauf), 729 Einträge',
  },
  {
    kurz: 'dacd701ed74d98f6',
    archiv: 'gflevel',
    bezeichnung: 'flevel-zweitvariante-729',
    herkunft: 'Lokale Messung 2026-08-10 (S20-Fingerprint-Lauf), 729 Einträge',
  },
  {
    kurz: '49c43a74eea3ca21',
    archiv: 'char',
    bezeichnung: 'char-basisvariante-12649',
    herkunft: 'Lokale Messung 2026-08-10 (S20-Fingerprint-Lauf), 12.649 Einträge',
  },
  {
    kurz: '683680fd051f2c4b',
    archiv: 'battle',
    bezeichnung: 'battle-basisvariante-11119',
    herkunft: 'Lokale Messung 2026-08-10 (S20-Fingerprint-Lauf), 11.119 Einträge',
  },
  {
    kurz: '8c7f79784b75421a',
    archiv: 'magic',
    bezeichnung: 'magic-basisvariante-5252',
    herkunft: 'Lokale Messung 2026-08-10 (S20-Fingerprint-Lauf), 5.252 Einträge',
  },
];

/**
 * Archivrolle: derselbe Zweck, andere Sprach-/Regionalfassung. Die Rolle ist
 * die Ebene, auf der Release-Varianz überhaupt sichtbar wird — zwei Dateien
 * mit *demselben* Namen sind in einer Installation fast immer identisch,
 * zwei Dateien derselben *Rolle* sind es oft nicht.
 */
export function archivRolle(archiv: string): string {
  const ohneSprache = archiv.replace(/[-_](fr|gm|ge|sp|us|de|en)$/i, '');
  // Minispiel-/Field-Familien tragen die Fassung als Präfixbuchstabe.
  const familie = /^[fgs](flevel|chocobo|condor|sub)$/i.exec(ohneSprache);
  return (familie?.[1] ?? ohneSprache).toLowerCase();
}

export type Variantenurteil = 'bekannt' | 'unbekannte-variante';

export interface Klassifikation {
  archiv: string;
  kurzFingerprint: string;
  urteil: Variantenurteil;
  bezeichnung: string | null;
  /**
   * Im „best effort"-Pfad erhöhte Diagnosetiefe: bei unbekannter Variante
   * wird nicht abgebrochen, sondern strukturell weiterverarbeitet und der
   * Bericht mit zusätzlichen Kennzahlen angereichert.
   */
  bestEffort: boolean;
}

export function klassifiziere(
  profil: ArchivProfil,
  registry: readonly BekanntesRelease[] = BEKANNTE_RELEASES,
): Klassifikation {
  const k = kurz(profil.releaseFingerprint);
  const treffer = registry.find((r) => r.kurz === k && r.archiv === profil.archiv);
  return {
    archiv: profil.archiv,
    kurzFingerprint: k,
    urteil: treffer ? 'bekannt' : 'unbekannte-variante',
    bezeichnung: treffer?.bezeichnung ?? null,
    bestEffort: !treffer,
  };
}

/**
 * Belegt die Assetfreiheit eines Fingerprint-Berichts: erlaubt sind Zahlen,
 * Wahrheitswerte, Hexdigests, Archivnamen (Struktur), Endungskürzel und
 * Diagnosecodes. Freitext ist ausgeschlossen — dort würden sonst Dateinamen
 * durchsickern.
 */
const ERLAUBTE_ZEICHENKETTE = /^(?:[0-9a-f]{8,64}|[a-z0-9_-]{1,24}|<ohne>|[A-Z]-[A-Z0-9-]+|bekannt|unbekannte-variante)$/;

export function berichtIstAssetfrei(wert: unknown, pfad = '$'): { ok: boolean; stelle?: string } {
  if (typeof wert === 'number' || typeof wert === 'boolean' || wert === null) return { ok: true };
  if (typeof wert === 'string') {
    return ERLAUBTE_ZEICHENKETTE.test(wert) ? { ok: true } : { ok: false, stelle: `${pfad}: "${wert}"` };
  }
  if (Array.isArray(wert)) {
    for (const [i, v] of wert.entries()) {
      const r = berichtIstAssetfrei(v, `${pfad}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (typeof wert === 'object') {
    for (const [k, v] of Object.entries(wert as Record<string, unknown>)) {
      const r = berichtIstAssetfrei(v, `${pfad}.${k}`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  return { ok: false, stelle: `${pfad}: ${typeof wert}` };
}
