import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scanLgp, type LgpEntry } from '@webmidgar/formats-lgp';
import { NodeDirectorySource } from './node-source.js';

/**
 * O5 — der „Check-Code" im LGP-TOC (1 Byte je Eintrag).
 *
 * Ausgangslage: Vier Implementierungen (Landscaper, PyFF7, Makou Reactor,
 * WebMidgar) lesen das Byte und verwenden es nicht; die Community-Quellen
 * widersprechen sich zwischen „Prüfwert" und „Ordnungshinweis". Die Recherche
 * ist erschöpft, es bleibt eine **Messfrage** — und die beiden Hypothesen
 * machen gegensätzliche Vorhersagen, eine muss zwingend durchfallen.
 *
 * Gemessen wird über **alle** LGP-Archive der Installation (Haupt- und
 * Sicherungsbaum), Fast-Scan für TOC + Deep-Scan für Payloadlängen.
 *
 * Methodische Auflagen des Projekts, hier alle eingelöst:
 *
 *  - **Kontrollhypothese ist Pflicht.** Jede Prüfwert-Funktion wird zweimal
 *    gerechnet: über den eigenen Eintrag UND über den **Nachbareintrag**.
 *    Eine Quote ohne Kontrolle wäre wertlos.
 *  - **Zweitrechnung ohne die trivialen Fälle.** Das Byte ist nicht oft 0,
 *    aber es ist stark einseitig verteilt — der Platz der „leeren Slots" von
 *    S14 nimmt hier die **Mehrheitsklasse** ein. Eine Funktion, die konstant
 *    den häufigsten Wert liefert, besteht jeden Test trivial. Deshalb wird
 *    jede Quote zusätzlich **nur über die Minderheitsklasse** gerechnet und
 *    die Konstantvorhersage als Nullmodell mitgeführt.
 *  - **Blinde Gütefunktion.** Die Trefferquote allein ist gegenüber der
 *    gesuchten Eigenschaft blind, sobald das Byte fast konstant ist; deshalb
 *    zusätzlich Wertevielfalt, Entropie und Partitionstreue.
 *  - **Falsche Suchmenge ausgesprochen.** Die Suchmenge ist EINE
 *    Installation. Ein Teil der Archive liegt als byteidentische Kopie
 *    mehrfach vor; deshalb wird neben der Dateizahl auch die Zahl der
 *    **inhaltlich verschiedenen** Archive berichtet.
 *
 * Assetfreiheit: Ausgabe sind ausschließlich Zähler, Quoten und
 * Endungshistogramme. Keine Dateipfade, keine Eintragsnamen, keine Rohbytes.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

// --- billige Funktionsfamilie ------------------------------------------------

function crc8Table(poly: number): Uint8Array {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ poly) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
}

const CRC8 = {
  /** CRC-8/SMBUS */ p07: crc8Table(0x07),
  /** CRC-8/MAXIM-Polynom, unreflektiert */ p31: crc8Table(0x31),
  /** CRC-8/DVB-S2 */ pd5: crc8Table(0xd5),
  /** CRC-8/CDMA2000-Polynom */ p9b: crc8Table(0x9b),
};

function crc8(bytes: Uint8Array, table: Uint8Array, init = 0): number {
  let r = init;
  for (const b of bytes) r = table[(r ^ b) & 0xff]!;
  return r;
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Aggregate über den Payload — in EINEM Durchlauf, damit 400 MiB einmal reichen. */
interface InhaltsAggregat {
  summe: number;
  xor: number;
  crc07: number;
  crc31: number;
  ersteBytes: string;
}

function aggregiereInhalt(bytes: Uint8Array): InhaltsAggregat {
  let summe = 0;
  let xor = 0;
  let c07 = 0;
  let c31 = 0;
  const t07 = CRC8.p07;
  const t31 = CRC8.p31;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    summe += b;
    xor ^= b;
    c07 = t07[(c07 ^ b) & 0xff]!;
    c31 = t31[(c31 ^ b) & 0xff]!;
  }
  let sig = '';
  for (let i = 0; i < Math.min(8, bytes.length); i++) {
    const b = bytes[i]!;
    sig += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
  }
  return { summe: summe & 0xff, xor, crc07: c07, crc31: c31, ersteBytes: sig };
}

/** Ein Messpunkt je TOC-Eintrag — nur abgeleitete Zahlen, keine Originaldaten. */
interface Messpunkt {
  archiv: number;
  tocIndex: number;
  checkByte: number;
  endung: string;
  ersteBytes: string;
  /** Kandidatenwerte der Prüfwert-Familie, Reihenfolge = KANDIDATEN. */
  kandidaten: number[];
  /** Für die dritte Auslegung: markiert das Byte Konflikt-/Duplikateinträge? */
  imKonflikt: boolean;
  verschattet: boolean;
}

/** Name der Kandidatenfunktionen — Index-gleich zu `Messpunkt.kandidaten`. */
const KANDIDATEN = [
  'name: Bytesumme & 0xFF',
  'name: XOR',
  'name: CRC-8 (0x07)',
  'name: CRC-8 (0x31)',
  'name: CRC-8 (0xD5)',
  'name: CRC-8 (0x9B, init 0xFF)',
  'name: Länge',
  'name: Bytesumme mod 15',
  'name: Bytesumme mod 16',
  'inhalt: Bytesumme & 0xFF',
  'inhalt: XOR',
  'inhalt: CRC-8 (0x07)',
  'inhalt: CRC-8 (0x31)',
  'inhalt: Länge & 0xFF',
  'inhalt: Länge >> 8 & 0xFF',
  'inhalt: Länge mod 15',
  'toc: Offset & 0xFF',
  'name+inhalt: Bytesumme & 0xFF',
] as const;

function kandidatenWerte(name: string, laenge: number, offset: number, inh: InhaltsAggregat): number[] {
  const nb = asciiBytes(name);
  let nSumme = 0;
  let nXor = 0;
  for (const b of nb) {
    nSumme += b;
    nXor ^= b;
  }
  return [
    nSumme & 0xff,
    nXor,
    crc8(nb, CRC8.p07),
    crc8(nb, CRC8.p31),
    crc8(nb, CRC8.pd5),
    crc8(nb, CRC8.p9b, 0xff),
    nb.length,
    nSumme % 15,
    nSumme % 16,
    inh.summe,
    inh.xor,
    inh.crc07,
    inh.crc31,
    laenge & 0xff,
    (laenge >>> 8) & 0xff,
    laenge % 15,
    offset & 0xff,
    (nSumme + inh.summe) & 0xff,
  ];
}

function endungVon(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '(keine)';
}

function quote(treffer: number, gesamt: number): string {
  return gesamt === 0 ? '—' : `${((treffer / gesamt) * 100).toFixed(2)} %`;
}

describe.skipIf(!available)('Realdaten: LGP-Check-Code (O5)', () => {
  it(
    'O5: Prüfwert gegen Ordnungshinweis über den vollen Archivbestand',
    { timeout: 3_600_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, []);
      const punkte: Messpunkt[] = [];
      /** Erster/letzter Messpunkt-Index je Archiv, für die Nachbarkontrolle. */
      const archivSpannen: { von: number; bis: number; eintraege: number }[] = [];
      const archivFingerprints = new Set<string>();
      let lgpDateien = 0;
      let fatale = 0;
      let uebersprungeneEintraege = 0;

      for await (const datei of dir.files()) {
        if (!datei.name.toLowerCase().endsWith('.lgp')) continue;
        lgpDateien++;
        const archivName = datei.name.toLowerCase().replace(/\.lgp$/, '');
        const scan = await scanLgp(datei, archivName, { mode: 'deep' });
        if (!scan.ok || !scan.archive) {
          fatale++;
          continue;
        }
        const arc = scan.archive;
        // Identitätsschlüssel: Größe + TOC. Byteidentische Kopien fallen zusammen.
        const h = createHash('sha256');
        h.update(`${arc.fileSize}|${arc.entryCount}`);
        for (const e of arc.entries) h.update(`${e.rawName}|${e.offset}|${e.checkByte}|${e.conflictIndex}`);
        archivFingerprints.add(h.digest('hex'));

        const archivIdx = archivSpannen.length;
        const von = punkte.length;
        for (const e of arc.entries as LgpEntry[]) {
          if (e.quarantined || e.length === undefined || e.dataOffset === undefined) {
            uebersprungeneEintraege++;
            continue;
          }
          const payload = await datei.read(e.dataOffset, e.length);
          const inh = aggregiereInhalt(payload);
          punkte.push({
            archiv: archivIdx,
            tocIndex: e.tocIndex,
            checkByte: e.checkByte,
            endung: endungVon(e.name),
            ersteBytes: inh.ersteBytes,
            kandidaten: kandidatenWerte(e.name, e.length, e.offset, inh),
            imKonflikt: e.conflictIndex > 0,
            verschattet: e.shadowed === true,
          });
        }
        archivSpannen.push({ von, bis: punkte.length, eintraege: arc.entryCount });
      }
      await dir.closeAll();

      expect(punkte.length).toBeGreaterThan(1000);

      // ------------------------------------------------------------------
      // 1) Verteilung — die blinde Gütefunktion zuerst entschärfen
      // ------------------------------------------------------------------
      const histogramm = new Map<number, number>();
      for (const p of punkte) histogramm.set(p.checkByte, (histogramm.get(p.checkByte) ?? 0) + 1);
      const werte = [...histogramm.entries()].sort((a, b) => b[1] - a[1]);
      const mehrheitswert = werte[0]![0];
      const mehrheitsAnteil = werte[0]![1] / punkte.length;
      const minderheit = punkte.filter((p) => p.checkByte !== mehrheitswert);
      let entropie = 0;
      for (const [, n] of werte) {
        const q = n / punkte.length;
        entropie -= q * Math.log2(q);
      }
      // Je Archiv konstant?
      const archiveKonstant = archivSpannen.filter((s) => {
        const menge = new Set(punkte.slice(s.von, s.bis).map((p) => p.checkByte));
        return menge.size <= 1;
      }).length;

      // ------------------------------------------------------------------
      // 2) Prüfwert-Hypothese, jede Funktion MIT Nachbarkontrolle
      //    und MIT Zweitrechnung ohne die Mehrheitsklasse
      // ------------------------------------------------------------------
      const nachbarIndex = (i: number): number => {
        const s = archivSpannen[punkte[i]!.archiv]!;
        return i + 1 < s.bis ? i + 1 : s.von; // letzter Eintrag wickelt auf den ersten
      };

      const pruefwert = KANDIDATEN.map((name, k) => {
        let eigen = 0;
        let kontrolle = 0;
        let eigenMinderheit = 0;
        let kontrolleMinderheit = 0;
        const bild = new Set<number>();
        for (let i = 0; i < punkte.length; i++) {
          const p = punkte[i]!;
          const eigenerWert = p.kandidaten[k]!;
          const nachbarWert = punkte[nachbarIndex(i)]!.kandidaten[k]!;
          bild.add(eigenerWert);
          if (eigenerWert === p.checkByte) {
            eigen++;
            if (p.checkByte !== mehrheitswert) eigenMinderheit++;
          }
          if (nachbarWert === p.checkByte) {
            kontrolle++;
            if (p.checkByte !== mehrheitswert) kontrolleMinderheit++;
          }
        }
        // Der Vorsprung vor der EIGENEN Nachbarkontrolle ist die einzige
        // aussagekräftige Größe: eine Funktion mit kleinem Bild trifft schon
        // zufällig oft (Bild 15 ⇒ ~6,7 %), und zwar eigen wie kontrolliert.
        const vorsprung =
          minderheit.length === 0 ? 0 : (eigenMinderheit - kontrolleMinderheit) / minderheit.length;
        return {
          funktion: name,
          bildgroesse: bild.size,
          treffer: quote(eigen, punkte.length),
          kontrolleNachbar: quote(kontrolle, punkte.length),
          nurMinderheit: quote(eigenMinderheit, minderheit.length),
          kontrolleNurMinderheit: quote(kontrolleMinderheit, minderheit.length),
          vorsprungPunkte: (vorsprung * 100).toFixed(2),
          _eigen: eigen,
          _vorsprung: vorsprung,
        };
      });
      const besteQuote = Math.max(...pruefwert.map((r) => r._eigen)) / punkte.length;
      const besterVorsprung = Math.max(...pruefwert.map((r) => r._vorsprung));

      // ------------------------------------------------------------------
      // 3) Ordnungshypothese: Funktion der Position?
      // ------------------------------------------------------------------
      // (a) Monotonie: ein Sortierschlüssel dürfte nie absteigen.
      let abstiege = 0;
      // (b) Blockstruktur: Wechsel zwischen Nachbarn, beobachtet gegen den
      //     Erwartungswert bei zufälliger Reihenfolge gleicher Zusammensetzung
      //     (E = 2·n1·n2/n). Blöcke ⇒ Verhältnis ≪ 1.
      let wechselBeobachtet = 0;
      let wechselErwartet = 0;
      for (const s of archivSpannen) {
        const reihe = punkte.slice(s.von, s.bis).sort((a, b) => a.tocIndex - b.tocIndex);
        const n = reihe.length;
        if (n < 2) continue;
        let n1 = 0;
        for (let i = 1; i < n; i++) {
          if (reihe[i]!.checkByte < reihe[i - 1]!.checkByte) abstiege++;
          if (reihe[i]!.checkByte !== reihe[i - 1]!.checkByte) wechselBeobachtet++;
        }
        for (const p of reihe) if (p.checkByte !== mehrheitswert) n1++;
        wechselErwartet += (2 * n1 * (n - n1)) / n;
      }
      // (c) Positionsfunktion: bestmögliche Reinheit über tocIndex mod k.
      let bestesModul = { k: 0, reinheit: 0 };
      for (let k = 2; k <= 32; k++) {
        const klassen = new Map<number, Map<number, number>>();
        for (const p of punkte) {
          const key = p.tocIndex % k;
          const m = klassen.get(key) ?? new Map<number, number>();
          m.set(p.checkByte, (m.get(p.checkByte) ?? 0) + 1);
          klassen.set(key, m);
        }
        let rein = 0;
        for (const m of klassen.values()) rein += Math.max(...m.values());
        const r = rein / punkte.length;
        if (r > bestesModul.reinheit) bestesModul = { k, reinheit: r };
      }
      // (d) Anfangsbuchstabe (Lookup-Zeile): trennt der erste Namensbuchstabe?
      //     Gemessen über die Endung ist das die Gegenprobe zu (e) unten.

      // ------------------------------------------------------------------
      // 4) Was die Verteilung nahelegt: Partition nach Eintragsart.
      //    Auch hier Kontrolle über den Nachbareintrag.
      // ------------------------------------------------------------------
      const nachEndung = new Map<string, Map<number, number>>();
      for (const p of punkte) {
        const m = nachEndung.get(p.endung) ?? new Map<number, number>();
        m.set(p.checkByte, (m.get(p.checkByte) ?? 0) + 1);
        nachEndung.set(p.endung, m);
      }
      const gemischteEndungen = [...nachEndung.entries()].filter(([, m]) => m.size > 1).length;
      const minderheitsEndungen = [...nachEndung.entries()]
        .filter(([, m]) => [...m.keys()].some((v) => v !== mehrheitswert))
        .map(([ext, m]) => ({ endung: ext, verteilung: [...m.entries()] }));

      // Vorhersager „Endung ⇒ Byte" gegen Vorhersager „Endung des NACHBARN ⇒ Byte".
      const endungsRegel = new Map<string, number>();
      for (const [ext, m] of nachEndung) {
        endungsRegel.set(ext, [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
      }
      let endungEigen = 0;
      let endungKontrolle = 0;
      let endungEigenMinderheit = 0;
      let endungKontrolleMinderheit = 0;
      let signaturEigen = 0;
      let signaturKontrolle = 0;
      // Inhaltssignatur statt Name: erste acht Bytes des Payloads.
      const minderheitswert = werte.find(([v]) => v !== mehrheitswert)?.[0] ?? mehrheitswert;
      const sigRegel = (s: string): number => (s.startsWith(':HEADER_') ? minderheitswert : mehrheitswert);
      for (let i = 0; i < punkte.length; i++) {
        const p = punkte[i]!;
        const nachbar = punkte[nachbarIndex(i)]!;
        if (endungsRegel.get(p.endung) === p.checkByte) {
          endungEigen++;
          if (p.checkByte !== mehrheitswert) endungEigenMinderheit++;
        }
        if (endungsRegel.get(nachbar.endung) === p.checkByte) {
          endungKontrolle++;
          if (p.checkByte !== mehrheitswert) endungKontrolleMinderheit++;
        }
        if (sigRegel(p.ersteBytes) === p.checkByte) signaturEigen++;
        if (sigRegel(nachbar.ersteBytes) === p.checkByte) signaturKontrolle++;
      }

      // ------------------------------------------------------------------
      // 5) Dritte Auslegung aus den Quellen: markiert das Byte Einträge mit
      //    Namenskonflikt bzw. verschattete Einträge? Beides ist im eigenen
      //    Index schon ausgewertet, also eine billige Gegenprobe.
      // ------------------------------------------------------------------
      const konfliktEintraege = punkte.filter((p) => p.imKonflikt).length;
      const konfliktMitMinderheit = punkte.filter((p) => p.imKonflikt && p.checkByte !== mehrheitswert).length;
      const minderheitMitKonflikt = punkte.filter((p) => p.checkByte !== mehrheitswert && p.imKonflikt).length;
      const verschattete = punkte.filter((p) => p.verschattet).length;
      const verschatteteMitMinderheit = punkte.filter(
        (p) => p.verschattet && p.checkByte !== mehrheitswert,
      ).length;

      // ------------------------------------------------------------------
      // Bericht
      // ------------------------------------------------------------------
      console.log(
        'O5 Check-Code — Suchmenge:',
        JSON.stringify({
          lgpDateien,
          fataleArchive: fatale,
          inhaltlichVerschiedeneArchive: archivFingerprints.size,
          gemesseneEintraege: punkte.length,
          uebersprungeneEintraege,
        }),
      );
      console.log(
        'O5 Check-Code — Verteilung:',
        JSON.stringify({
          wertevielfalt: werte.length,
          histogramm: werte,
          mehrheitswert,
          mehrheitsanteil: quote(werte[0]![1], punkte.length),
          entropieBit: entropie.toFixed(4),
          archiveMitKonstantemByte: `${archiveKonstant}/${archivSpannen.length}`,
        }),
      );
      console.log(
        'O5 Prüfwert-Hypothese (Nullmodell „immer Mehrheitswert" = ' +
          quote(werte[0]![1], punkte.length) +
          '):',
      );
      console.table(
        pruefwert.map((r) => ({
          Funktion: r.funktion,
          Bild: r.bildgroesse,
          Treffer: r.treffer,
          'Kontrolle (Nachbar)': r.kontrolleNachbar,
          'nur Minderheit': r.nurMinderheit,
          'Kontrolle Minderheit': r.kontrolleNurMinderheit,
          'Vorsprung (%-Pkt)': r.vorsprungPunkte,
        })),
      );
      console.log(
        'O5 Ordnungshypothese:',
        JSON.stringify({
          abstiege,
          wechselBeobachtet,
          wechselErwartetZufall: wechselErwartet.toFixed(1),
          verhaeltnisBeobachtetZuZufall: (wechselBeobachtet / Math.max(1, wechselErwartet)).toFixed(3),
          besteReinheitUeberTocIndexModK: bestesModul,
        }),
      );
      console.log(
        'O5 Partition nach Eintragsart:',
        JSON.stringify({
          endungenGesamt: nachEndung.size,
          endungenMitGemischtemByte: gemischteEndungen,
          endungenMitMinderheitswert: minderheitsEndungen,
          regelTreffer: quote(endungEigen, punkte.length),
          regelKontrolleNachbar: quote(endungKontrolle, punkte.length),
          regelNurMinderheit: quote(endungEigenMinderheit, minderheit.length),
          regelKontrolleNurMinderheit: quote(endungKontrolleMinderheit, minderheit.length),
          inhaltssignaturTreffer: quote(signaturEigen, punkte.length),
          inhaltssignaturKontrolleNachbar: quote(signaturKontrolle, punkte.length),
        }),
      );

      console.log(
        'O5 Konflikt-/Verschattungsauslegung:',
        JSON.stringify({
          konfliktEintraege,
          konfliktMitMinderheitswert: konfliktMitMinderheit,
          minderheitsEintraegeMitKonflikt: minderheitMitKonflikt,
          verschattete,
          verschatteteMitMinderheitswert: verschatteteMitMinderheit,
        }),
      );

      // ------------------------------------------------------------------
      // Zusicherungen — das gemessene Urteil festschreiben
      // ------------------------------------------------------------------
      // Verteilung: das Byte ist im ganzen Bestand fast konstant.
      expect(werte.length).toBeLessThanOrEqual(2);
      expect(mehrheitsAnteil).toBeGreaterThan(0.9);

      // Prüfwert-Hypothese fällt durch: keine Funktion schlägt das Nullmodell,
      // und keine hat gegenüber ihrer eigenen Nachbarkontrolle einen
      // nennenswerten Vorsprung auf der Minderheitsklasse. Die Schwelle von
      // 10 Prozentpunkten liegt weit über dem gemessenen Rauschen (~3) und
      // weit unter dem, was die Endungsregel unten leistet (~97).
      expect(besteQuote).toBeLessThan(mehrheitsAnteil);
      expect(besterVorsprung).toBeLessThan(0.1);

      // Ordnungshypothese fällt durch: nicht monoton, keine Blockstruktur,
      // keine Positionsfunktion mit kleinem Modul.
      expect(abstiege).toBeGreaterThan(0);
      expect(wechselBeobachtet / Math.max(1, wechselErwartet)).toBeGreaterThan(0.5);
      expect(bestesModul.reinheit).toBeLessThan(mehrheitsAnteil + 0.005);

      // Was stattdessen trägt: die Eintragsart. Perfekte Partition über die
      // Endung, und die Nachbarkontrolle fällt sichtbar ab.
      expect(gemischteEndungen).toBe(0);
      expect(endungEigen).toBe(punkte.length);
      expect(endungEigenMinderheit).toBe(minderheit.length);
      expect(endungKontrolleMinderheit).toBeLessThan(minderheit.length * 0.5);
      // Inhaltssignatur trägt dieselbe Partition — Name und Inhalt sind hier
      // nicht trennbar, das gehört in den Befund.
      expect(signaturEigen).toBe(punkte.length);
      expect(signaturKontrolle).toBeLessThan(punkte.length);

      // Dritte Auslegung („markiert Konflikt-/Duplikateinträge") fällt auch
      // durch: die beiden Mengen sind im Bestand disjunkt.
      expect(konfliktEintraege).toBeGreaterThan(0);
      expect(konfliktMitMinderheit).toBe(0);
      expect(minderheitMitKonflikt).toBe(0);
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
