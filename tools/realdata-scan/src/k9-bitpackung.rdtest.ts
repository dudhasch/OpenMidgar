import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { enemyModelPrefix, parseBattleAnimBank, parseBattleSkeleton, parseSceneBin } from '@webmidgar/formats-battle';
import { REAL_DIR, realPfad } from './real-pfade.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * K9 — die Bitpackung der Kampfanimationen, gegen den ganzen Bestand.
 *
 * **Die Gütefunktion ist eine doppelte Abrechnung, keine Statistik.**
 *
 * 1. **Container:** `4 + Σ (12 + packedSize)` muss die Dateilänge byteexakt
 *    treffen. Ein falscher Satzkopf kann das nicht zufällig.
 * 2. **Bitstrom:** Der Strom nennt seine Rahmenzahl **nicht** — er endet,
 *    wenn `(bitCursor + 7) / 8` das Maß `stromBytes` erreicht. Die Zahl der
 *    dabei dekodierten Rahmen muss `frameCount` aus dem Satzkopf **auf den
 *    Rahmen genau** treffen. Jeder Fehler in Bitbreite, Reihenfolge oder
 *    Deltacode verschiebt den Cursor und verfehlt sie.
 *
 * Abrechnung 2 ist das eigentliche Argument: Sie prüft nicht, ob die Zahlen
 * plausibel aussehen, sondern ob der Dekoder **denselben Weg durch den Strom
 * nimmt** wie das Original.
 *
 * **Drei Kontrollniveaus**, alle mit intaktem Container — sie greifen also
 * ausschließlich die Bitpackung an:
 *
 * | | was verfälscht wird | was das prüft |
 * |---|---|---|
 * | K1 | `shift`-Byte je Block um 1 erhöht | die Bitbreiten |
 * | K2 | Stromsbytes je Block umgedreht | die Bitfolge |
 * | K3 | derselbe Parser auf die `ab`-Familie | die Suchmenge |
 *
 * Trifft die Abrechnung unter K1/K2 ähnlich oft, misst sie nur die
 * Containerform und nicht die Packung.
 *
 * Urheberrecht: Ausgegeben werden Zähler, Kopffelder und Wertebereiche —
 * keine Rahmendaten.
 */

const available = existsSync(REAL_DIR);

interface Datei {
  name: string;
  bytes: Uint8Array;
}

async function ladeFamilie(suffix: string): Promise<Datei[]> {
  const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
  const index = new IndexService();
  await index.openSource(dir, { deep: false });
  const out: Datei[] = [];
  for (const e of index.listEntries('battle')) {
    if (e.name.length !== 4 || e.name.slice(2).toLowerCase() !== suffix) continue;
    try {
      out.push({ name: e.name.toLowerCase(), bytes: await index.readEntry(e.canonicalId) });
    } catch {
      /* quarantänisiert — zählt nirgends mit */
    }
  }
  await dir.closeAll();
  return out;
}

/** Läuft die Satzkette ab und ruft `f` für jeden Blockanfang auf. */
function jeBlock(bytes: Uint8Array, f: (blockAb: number, packedSize: number) => void): boolean {
  if (bytes.length < 4) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(0, true);
  let at = 4;
  for (let i = 0; i < n; i++) {
    if (at + 12 > bytes.length) return false;
    const packedSize = v.getUint32(at + 8, true);
    if (at + 12 + packedSize > bytes.length) return false;
    f(at + 12, packedSize);
    at += 12 + packedSize;
  }
  return at === bytes.length;
}

/** Kontrolle 1: `shift` je Block um 1 erhöhen, Container unangetastet. */
function verstelleShift(bytes: Uint8Array): Uint8Array {
  const kopie = bytes.slice();
  jeBlock(kopie, (ab) => {
    kopie[ab + 4] = (kopie[ab + 4]! + 1) % 12;
  });
  return kopie;
}

/** Kontrolle 2: die Strombytes je Block umdrehen — Länge und Kopf bleiben. */
function drehStrom(bytes: Uint8Array): Uint8Array {
  const kopie = bytes.slice();
  const v = new DataView(kopie.buffer, kopie.byteOffset, kopie.byteLength);
  jeBlock(kopie, (ab, packedSize) => {
    const len = Math.min(v.getUint16(ab + 2, true), packedSize - 5);
    const teil = kopie.subarray(ab + 5, ab + 5 + len);
    teil.reverse();
  });
  return kopie;
}

function quote(treffer: number, gesamt: number): string {
  return `${treffer}/${gesamt} (${((100 * treffer) / Math.max(1, gesamt)).toFixed(1)} %)`;
}

describe.skipIf(!available)('K9 — Bitpackung der Kampfanimationen', () => {
  it('rechnet Container und Bitstrom über den ganzen da-Bestand ab', async () => {
    const dateien = await ladeFamilie('da');
    expect(dateien.length).toBe(391);

    let ok = 0;
    let anims = 0;
    let leere = 0;
    let leereMitEinemRahmen = 0;
    let frames = 0;
    const gruende = new Map<string, number>();
    const shifts = new Map<number, number>();
    let maxGelenke = 0;
    let maxRahmen = 0;
    let kopfGleichRahmen = 0;
    let ausrichtung = 0;
    const kopfAbweichung: string[] = [];

    for (const d of dateien) {
      const { bank, diagnostics } = parseBattleAnimBank(d.bytes, d.name);
      if (!bank) {
        const grund = (diagnostics.at(-1)?.message ?? 'ohne Diagnose').replace(/\d+/g, '#');
        gruende.set(grund, (gruende.get(grund) ?? 0) + 1);
        continue;
      }
      ok++;
      for (const a of bank.animations) {
        if (a.leer) {
          leere++;
          if (a.frameCount === 1) leereMitEinemRahmen++;
          continue;
        }
        anims++;
        frames += a.frames.length;
        shifts.set(a.shift, (shifts.get(a.shift) ?? 0) + 1);
        maxGelenke = Math.max(maxGelenke, a.jointCount);
        maxRahmen = Math.max(maxRahmen, a.frameCount);
        if (a.packedSize === Math.ceil((5 + a.stromBytes) / 4) * 4) ausrichtung++;
        if (a.kopfWort === a.frameCount) kopfGleichRahmen++;
        else if (kopfAbweichung.length < 8) kopfAbweichung.push(`${d.name}: ${a.kopfWort} statt ${a.frameCount}`);
      }
    }

    console.log(`[K9-BP] da-Dateien vollständig abgerechnet: ${quote(ok, dateien.length)}`);
    console.log(
      `[K9-BP] ${anims} Animationen mit Strom · ${frames} Rahmen · ${leere} Platzhalter ` +
        `(davon frameCount==1: ${leereMitEinemRahmen}) · max Gelenke ${maxGelenke} · max Rahmen ${maxRahmen}`,
    );
    console.log(
      `[K9-BP] shift-Verteilung: ${[...shifts.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${n}`).join(', ')}`,
    );
    console.log(
      `[K9-BP] packedSize == align4(5+stromBytes): ${quote(ausrichtung, anims)} · ` +
        `kopfWort == frameCount: ${quote(kopfGleichRahmen, anims)}` +
        (kopfAbweichung.length ? ` · Abweichungen: ${kopfAbweichung.join(', ')}` : ''),
    );
    if (gruende.size) console.log('[K9-BP] Fehlgründe:', [...gruende.entries()].map(([g, n]) => `${n}× ${g}`).join(' | '));

    // Die drei Kontrollen — Container intakt, nur die Packung verfälscht.
    const k1 = dateien.filter((d) => parseBattleAnimBank(verstelleShift(d.bytes), d.name).bank !== null).length;
    const k2 = dateien.filter((d) => parseBattleAnimBank(drehStrom(d.bytes), d.name).bank !== null).length;
    console.log(`[K9-BP] Kontrolle 1 (shift+1): ${quote(k1, dateien.length)}`);
    console.log(`[K9-BP] Kontrolle 2 (Strom umgedreht): ${quote(k2, dateien.length)}`);

    /**
     * DAUERBEFUND 🟢 — die Abrechnung geht über den ganzen Bestand auf.
     *
     * Sinkt diese Zahl, ist entweder der Dekoder oder der Bestand verändert
     * worden. Die Kontrollen halten den Nachweis, dass die Abrechnung wirklich
     * die Packung misst und nicht bloß die Containerform.
     */
    expect(ok).toBe(dateien.length);
    expect(k1).toBeLessThan(dateien.length / 3);
    expect(k2).toBeLessThan(dateien.length / 3);
    // Der Kratzpuffer des Originals fasst 50 Sätze — der Bestand bleibt darunter.
    expect(maxGelenke).toBeLessThanOrEqual(50);
  }, 600_000);

  it('scheitert an der ab-Familie — die Suchmenge ist nicht beliebig', async () => {
    const dateien = await ladeFamilie('ab');
    expect(dateien.length).toBeGreaterThan(300);
    const ok = dateien.filter((d) => parseBattleAnimBank(d.bytes, d.name).bank !== null).length;
    console.log(`[K9-BP] Kontrolle 3 (ab-Familie): ${quote(ok, dateien.length)}`);

    /**
     * DAUERBEFUND: `ab` ist **keine** Animationsbank. Die Namensbildung des
     * Originals vergibt Suffixcode 0 an `.D` (→ `aa`), **1 an `.B`** (→ `ab`)
     * und 78 an `.A` (→ `da`). `ab` ist also der Infoblock des Modells, nicht
     * die zweite Animationsfamilie — womit sich der alte K9-Posten „das
     * `ab`-Format vollständig" als falsch gestellt erweist.
     */
    expect(ok).toBe(0);
  }, 300_000);

  it('bestätigt die Gelenkzahl gegen das Skelett und misst die Ausreißer neu', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const nachName = new Map<string, string>();
    for (const e of index.listEntries('battle')) {
      if (e.name.length === 4) nachName.set(e.name.toLowerCase(), e.canonicalId);
    }
    const lies = async (n: string): Promise<Uint8Array | null> => {
      const id = nachName.get(n);
      if (!id) return null;
      try {
        return await index.readEntry(id);
      } catch {
        return null;
      }
    };

    let paare = 0;
    let einheitlich = 0;
    let einheitlichPasst = 0;
    let uneinheitlich = 0;
    /** Liegen die abweichenden Gelenkzahlen UNTER `boneCount + 1` oder darüber? */
    let uneinheitlichNurDarunter = 0;
    let einKnochen = 0;
    let einKnochenPasst = 0;
    const spannen: string[] = [];
    const praefixe = [...new Set([...nachName.keys()].map((n) => n.slice(0, 2)))].sort();
    for (const p of praefixe) {
      const skb = await lies(`${p}aa`);
      const dab = await lies(`${p}da`);
      if (!skb || !dab) continue;
      const { skeleton } = parseBattleSkeleton(skb, `${p}aa`);
      const { bank } = parseBattleAnimBank(dab, `${p}da`);
      if (!skeleton || !bank) continue;
      paare++;
      // Platzhalter bleiben draußen, damit die Streuung nicht auf sie
      // geschoben werden kann. Gemessen: Es ändert nichts — die 35
      // uneinheitlichen Banken bleiben 35. Die Spanne steckt in den Sätzen
      // MIT Bitstrom.
      const echte = bank.animations.filter((a) => !a.leer);
      if (!echte.length) continue;
      const gelenke = [...new Set(echte.map((a) => a.jointCount))].sort((a, b) => a - b);
      const soll = skeleton.boneCount + 1;
      if (gelenke.length === 1) {
        einheitlich++;
        if (gelenke[0] === soll) einheitlichPasst++;
      } else {
        uneinheitlich++;
        if (gelenke.every((g) => g <= soll)) uneinheitlichNurDarunter++;
        if (spannen.length < 5) spannen.push(`${p}da: {${gelenke.join(',')}} bei soll ${soll}`);
      }
      if (skeleton.boneCount === 1) {
        einKnochen++;
        if (gelenke.every((g) => g === soll)) einKnochenPasst++;
      }
    }
    await dir.closeAll();

    console.log(
      `[K9-BP] Banken ${paare} · einheitliche Gelenkzahl ${quote(einheitlich, paare)}, davon == boneCount+1: ` +
        `${quote(einheitlichPasst, einheitlich)}`,
    );
    console.log(
      `[K9-BP] uneinheitliche Banken ${uneinheitlich}, davon alle Werte ≤ boneCount+1: ${uneinheitlichNurDarunter} · ` +
        `Einknochenfälle ${einKnochenPasst}/${einKnochen} · Beispiele: ${spannen.join(' | ')}`,
    );

    /**
     * DAUERBEFUND 🟢 — **die Gelenkzahl ist ein Parameter der einzelnen
     * Animation, kein Verweis auf das Skelett.** Das Original übergibt sie als
     * `boneCountPlus1` an `BattleModel_DecodeAnimation` und fragt das Skelett
     * dabei nie.
     *
     * Diese Messung war der Prüfstein dafür, und sie hat zwei geratene
     * Erwartungen umgeworfen: **35 Banken tragen mehrere verschiedene
     * Gelenkzahlen** — dieselbe Datei, dasselbe Skelett, unterschiedlich
     * breite Sätze. Und **alle Abweichungen liegen unterhalb** von
     * `boneCount + 1`: Es sind Animationen, die nur einen vorderen Teil der
     * Knochenkette bewegen, nie mehr Knochen als vorhanden.
     *
     * Damit ist auch der alte Einknochen-Sonderfall aufgelöst: Ein Modell mit
     * einem Knochen kann Sätze mit `jointCount == 1` (nur Wurzel) tragen. Das
     * ist kein Defekt, sondern derselbe Mechanismus am unteren Rand.
     */
    expect(paare).toBeGreaterThan(300);
    // Wo die Bank einheitlich ist, gilt die Regel ausnahmslos bis auf den
    // Einknochenrand — die Zahl ist gemessen, nicht gewünscht.
    expect(einheitlichPasst / einheitlich).toBeGreaterThan(0.95);
    expect(uneinheitlichNurDarunter).toBe(uneinheitlich);
  }, 600_000);

  it('prüft die Animationsindizes der Gegnerrecords gegen die belegte animCount', async () => {
    const container = await parseSceneBin(await readFile(realPfad('battle/scene.bin')), 'scene.bin');
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const nachName = new Map<string, string>();
    for (const e of index.listEntries('battle')) {
      if (e.name.length === 4) nachName.set(e.name.toLowerCase(), e.canonicalId);
    }

    const bankCache = new Map<string, number | null>();
    const holeAnimCount = async (prefix: string): Promise<number | null> => {
      if (bankCache.has(prefix)) return bankCache.get(prefix)!;
      const id = nachName.get(`${prefix}da`);
      let out: number | null = null;
      if (id) {
        try {
          const { bank } = parseBattleAnimBank(await index.readEntry(id), `${prefix}da`);
          out = bank ? bank.animations.length : null;
        } catch {
          out = null;
        }
      }
      bankCache.set(prefix, out);
      return out;
    };

    let geprueft = 0;
    let enthalten = 0;
    let ueberzaehlig = 0;
    const gesehen = new Set<number>();
    for (const scene of container.scenes) {
      if (!scene) continue;
      for (let slot = 0; slot < scene.enemyTypeIds.length; slot++) {
        const typId = scene.enemyTypeIds[slot]!;
        if (typId === 0xffff || gesehen.has(typId)) continue;
        const rec = scene.enemies[slot];
        if (!rec || rec.hp === 0 || rec.hp === 0xffffffff) continue;
        gesehen.add(typId);
        const ids = [...rec.raw.subarray(0x38, 0x48)].filter((v) => v !== 0xff);
        if (!ids.length) continue;
        const n = await holeAnimCount(enemyModelPrefix(typId));
        if (n === null) continue;
        geprueft++;
        if (Math.max(...ids) < n) enthalten++;
        else ueberzaehlig++;
      }
    }
    await dir.closeAll();

    console.log(`[K9-BP] animationIds < animCount: ${quote(enthalten, geprueft)} · darüber: ${ueberzaehlig}`);

    /**
     * 🟡 **Offen und ausdrücklich als offen festgehalten.** `animCount` ist
     * jetzt belegt (Containerabrechnung), also ist diese Prüfung nicht mehr
     * blind — aber sie geht **nicht** auf: Ein Teil der Gegner nennt Indizes
     * jenseits der eigenen Bank. Das heißt entweder, dass `animationIds` nicht
     * direkt in die eigene Bank zeigt, oder dass `0xFF` nicht die einzige
     * Füllung ist. Die Frage gehört zur Attackenanbindung, nicht zum Format.
     *
     * Diese Erwartung hält nur fest, was gemessen wurde — sie behauptet nichts.
     */
    expect(geprueft).toBeGreaterThan(200);
    expect(enthalten + ueberzaehlig).toBe(geprueft);
  }, 600_000);
});
