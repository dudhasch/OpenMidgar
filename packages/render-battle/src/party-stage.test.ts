import { describe, expect, it } from 'vitest';
import { composeP, composeTex } from '@webmidgar/fixture-gen';
import {
  CHARACTER_ID,
  linearPrefixGuess,
  PARTY_MODELS,
  partyModelByPrefix,
  partyModelPrefix,
} from './party-models.js';
import {
  loadBattleStage,
  stageBand,
  stagePrefixForLocation,
  STAGE_COUNT,
  STAGE_PREFIX_FIRST,
  STAGE_PREFIX_LAST,
  type BattleEntrySource,
} from './model-loader.js';
import { buildBattleStage, BATTLE_STAGE_ROTATION_X } from './stage-actor.js';
import { PARTY_ROW_DEPTH, PARTY_SLOT_SPACING, placeParty } from './composition.js';

/**
 * K3/K4/K5 — Abnahme der Zuordnung und des Bühnenpfads OHNE Realdaten.
 *
 * Die Messungen selbst stehen in `tools/realdata-scan` (sie brauchen
 * battle.lgp und scene.bin). Hier wird festgehalten, was aus ihnen als REGEL
 * geworden ist — samt der Kontrollhypothese, damit sie nicht in Prosa
 * verdunstet: Wer die K4-Tabelle irgendwann durch die naheliegende lineare
 * Regel ersetzen will, bricht diesen Test.
 */

/** Das gemessene Präfixraster von battle.lgp, soweit hier gebraucht. */
function praefixbandBauen(): string[] {
  const out: string[] = [];
  for (let a = 0; a < 26; a++)
    for (let b = 0; b < 26; b++) out.push(String.fromCharCode(97 + a) + String.fromCharCode(97 + b));
  return out.filter((p) => p <= 'sm');
}

describe('K4: Zuordnung Präfix → Spielfigur', () => {
  it('liefert für jede belegte Charakter-ID das gemessene Präfix', () => {
    expect(partyModelPrefix(CHARACTER_ID.cloud)).toBe('rt');
    expect(partyModelPrefix(CHARACTER_ID.barret)).toBe('sb');
    expect(partyModelPrefix(CHARACTER_ID.tifa)).toBe('ru');
    expect(partyModelPrefix(CHARACTER_ID.aerith)).toBe('rv');
    expect(partyModelPrefix(CHARACTER_ID.redXiii)).toBe('rw');
    expect(partyModelPrefix(CHARACTER_ID.yuffie)).toBe('rx');
    expect(partyModelPrefix(CHARACTER_ID.caitSith)).toBe('ry');
    expect(partyModelPrefix(CHARACTER_ID.vincent)).toBe('sf');
    expect(partyModelPrefix(CHARACTER_ID.cid)).toBe('rz');
  });

  it('rät nicht: unbekannte ID ergibt null', () => {
    expect(partyModelPrefix(99)).toBeNull();
    expect(partyModelPrefix(-1)).toBeNull();
  });

  it('erkennt die Waffenvarianten als dieselbe Figur', () => {
    for (const p of ['sb', 'sc', 'sd', 'se']) expect(partyModelByPrefix(p)?.label).toBe('Barret');
    for (const p of ['sf', 'sg', 'sh']) expect(partyModelByPrefix(p)?.label).toBe('Vincent');
    expect(partyModelByPrefix('rt')?.label).toBe('Cloud');
    expect(partyModelByPrefix('zz')).toBeNull();
  });

  it('deckt das dritte Präfixband vollständig und überschneidungsfrei ab', () => {
    const alle = PARTY_MODELS.flatMap((e) => [e.prefix, ...e.weaponVariants]).sort();
    expect(alle.length).toBe(21); // 21 Präfixe im Band rs…sm
    expect(new Set(alle).size).toBe(21); // keine Doppelbelegung
    expect(alle[0]).toBe('rs');
    expect(alle[alle.length - 1]).toBe('sm');
  });

  it('KONTROLLHYPOTHESE „Bandindex = charakterId" fällt (Kontrollniveau 5/9)', () => {
    // Bandindex im dritten Band rs…sm; die lineare Regel wird gegen die
    // gemessene Tabelle gerechnet. Sie darf NICHT vollständig treffen —
    // sonst wäre die Tabelle überflüssig und dieser Test hätte nichts gezeigt.
    const band = ['rs', 'rt', 'ru', 'rv', 'rw', 'rx', 'ry', 'rz', 'sa', 'sb', 'sc', 'sd', 'se', 'sf', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm'];
    let treffer = 0;
    const daneben: string[] = [];
    for (let id = 0; id <= 8; id++) {
      const echt = partyModelPrefix(id)!;
      const geraten = linearPrefixGuess(id, band);
      if (geraten === echt) treffer++;
      else daneben.push(`${id}: linear ${geraten} statt ${echt}`);
    }
    expect(treffer).toBe(5); // Tifa, Aerith, Red XIII, Yuffie, Cait Sith
    expect(daneben).toEqual([
      '0: linear rs statt rt',
      '1: linear rt statt sb',
      '7: linear rz statt sf',
      '8: linear sa statt rz',
    ]);
  });
});

describe('K5: location → Bühnenpräfix', () => {
  const praefixe = praefixbandBauen();

  it('schneidet das Bühnenband am gemessenen Namensbereich', () => {
    const band = stageBand(praefixe);
    expect(band.length).toBe(STAGE_COUNT);
    expect(band[0]).toBe(STAGE_PREFIX_FIRST);
    expect(band[band.length - 1]).toBe(STAGE_PREFIX_LAST);
  });

  it('bildet den vollen Wertebereich 0…89 ab und nichts darüber hinaus', () => {
    expect(stagePrefixForLocation(0, praefixe)).toBe('og');
    expect(stagePrefixForLocation(89, praefixe)).toBe('rr');
    // Die Kontrollen der Realdatenprobe als Regel: ±1 verlässt das Band.
    expect(stagePrefixForLocation(90, praefixe)).toBeNull();
    expect(stagePrefixForLocation(-1, praefixe)).toBeNull();
    expect(stagePrefixForLocation(1.5, praefixe)).toBeNull();
  });

  it('bleibt gegen eingefügte Fremdpräfixe stabil (Namensbereich statt Platz)', () => {
    // Ein Mod, der vor dem Band ein Präfix einfügt, verschiebt die
    // Sortierplätze — die Namen aber nicht. Genau deshalb schneidet der Code
    // über den Namensbereich.
    const mitMod = [...praefixe, 'ba', 'bb'].sort();
    expect(stagePrefixForLocation(0, mitMod)).toBe('og');
    expect(stagePrefixForLocation(89, mitMod)).toBe('rr');
  });
});

describe('K5: Bühnenlader und Bühnenbau', () => {
  function mesh(n: number): Uint8Array {
    const vertices: [number, number, number][] = [];
    const groups = [];
    for (let i = 0; i < n; i++) {
      vertices.push([i, 0, 0], [i + 1, 0, 0], [i, 1, 0]);
      groups.push({
        vertexStart: i * 3,
        vertexCount: 3,
        polys: [{ v: [0, 1, 2] as [number, number, number], n: [0, 0, 0] as [number, number, number] }],
      });
    }
    return composeP({ vertices, normals: [[0, 0, 1]], groups });
  }
  function tex(): Uint8Array {
    return composeTex({
      width: 2,
      height: 2,
      palettes: [[[255, 0, 0, 255], [0, 255, 0, 255]]],
      pixels: [0, 1, 1, 0],
    });
  }

  const eintraege = new Map<string, Uint8Array>([
    ['ogac', tex()],
    ['ogad', tex()],
    ['ogam', mesh(2)],
    ['ogan', mesh(3)],
    ['ogbz', mesh(1)], // Lücke im Suffixraum: der Lader darf nicht abbrechen.
  ]);
  const quelle: BattleEntrySource = {
    listBattleEntries: (p) => [...eintraege.keys()].filter((n) => n.startsWith(p)),
    readBattleEntry: (n) => Promise.resolve(eintraege.get(n) ?? null),
  };

  it('lädt Bühnenteile OHNE Skelett und in Suffixordnung', async () => {
    const stage = await loadBattleStage('og', quelle);
    expect(stage).toBeTruthy();
    expect(stage!.parts.length).toBe(3);
    expect(stage!.textures.length).toBe(2);
    // Suffixordnung: `am` (2 Dreiecke) vor `an` (3) vor `bz` (1).
    expect(stage!.parts.map((p) => p.indices.length / 3)).toEqual([2, 3, 1]);
  });

  it('meldet null statt einer leeren Bühne', async () => {
    const leer: BattleEntrySource = { listBattleEntries: () => [], readBattleEntry: () => Promise.resolve(null) };
    expect(await loadBattleStage('zz', leer)).toBeNull();
  });

  it('baut die Bühne mit genau EINER Basiswendung', async () => {
    const stage = await loadBattleStage('og', quelle);
    const gebaut = buildBattleStage('og', stage!);
    expect(gebaut.partCount).toBe(3);
    expect(gebaut.root.children.length).toBe(3);
    expect(gebaut.root.rotation.x).toBeCloseTo(BATTLE_STAGE_ROTATION_X, 12);
    expect(gebaut.root.rotation.y).toBe(0);
    expect(gebaut.root.rotation.z).toBe(0);
    // Kein Teil bekommt eine eigene Lage — die .p tragen ihre Weltlage selbst.
    for (const kind of gebaut.root.children) {
      expect(kind.position.lengthSq()).toBe(0);
      expect(kind.scale.x).toBe(1);
    }
  });
});

describe('K3: Partyplätze aus der gespiegelten Gegnerseite', () => {
  it('setzt die Party auf die gemessene Gegenseite und Bodenhöhe', () => {
    const plaetze = placeParty(3);
    expect(plaetze.length).toBe(3);
    // battleToScene = (x, −y, −z): Bodenhöhe 0 bleibt 0, Tiefe kippt.
    for (const p of plaetze) expect(Math.abs(p[1])).toBe(0); // −0 ist Bodenhöhe
    for (const p of plaetze) expect(p[2]).toBe(-PARTY_ROW_DEPTH);
    expect(plaetze.map((p) => p[0])).toEqual([-PARTY_SLOT_SPACING, 0, PARTY_SLOT_SPACING]);
  });

  it('bleibt bei einem einzelnen Mitglied mittig', () => {
    const [einzeln] = placeParty(1);
    expect(einzeln![0]).toBe(0);
    expect(Math.abs(einzeln![1])).toBe(0);
    expect(einzeln![2]).toBe(-PARTY_ROW_DEPTH);
  });
});
