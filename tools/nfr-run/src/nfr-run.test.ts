import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildLgp } from '@webmidgar/fixture-gen';
import { scanLgp } from '@webmidgar/formats-lgp';
import { MemorySourceFile } from '@webmidgar/io';
import {
  BEKANNTE_RELEASES,
  archivProfil,
  baueFakeInstallation,
  berechneReplayVektoren,
  berichtIstAssetfrei,
  bewerte,
  bilanziere,
  klassifiziere,
  kontrollLauf,
  kurz,
  messeMathExposition,
  perzentile,
  profilMitFingerprint,
  releaseFingerprint,
  VramBuchfuehrung,
  atlasBytes,
  ERWARTETE_DIGESTS,
  vergleicheGegenErwartung,
} from './index.js';

describe('NFR-Sollwerte: Bewertung', () => {
  it('unterscheidet erfüllt, grenzwertig und verfehlt', () => {
    expect(bewerte('field-wechsel-warm', 400, 'desktop', 'test').urteil).toBe('erfüllt');
    expect(bewerte('field-wechsel-warm', 550, 'desktop', 'test').urteil).toBe('grenzwertig');
    expect(bewerte('field-wechsel-warm', 700, 'desktop', 'test').urteil).toBe('verfehlt');
    // Mobile hat eigene Grenzen — derselbe Messwert kann dort erfüllt sein.
    expect(bewerte('field-wechsel-warm', 700, 'mobile', 'test').urteil).toBe('erfüllt');
  });

  it('behandelt eine fehlende Messung als ungemessen, nie als erfüllt', () => {
    const b = bewerte('ttff-cold', null, 'mobile', 'kein Referenzgerät');
    expect(b.urteil).toBe('ungemessen');
    expect(b.messwert).toBeNull();
    expect(bilanziere([b]).vollstaendigErfuellt).toBe(false);
  });

  it('kennt bei Sollwert 0 nur „genau 0 oder verfehlt"', () => {
    expect(bewerte('long-tasks', 0, 'desktop', 't').urteil).toBe('erfüllt');
    expect(bewerte('long-tasks', 1, 'desktop', 't').urteil).toBe('verfehlt');
    expect(bewerte('long-tasks', 1, 'desktop', 't').abweichungProzent).toBeNull();
  });

  it('rechnet die Abweichung vorzeichenrichtig', () => {
    expect(bewerte('asset-warm', 60, 'desktop', 't').abweichungProzent).toBeCloseTo(20, 6);
    expect(bewerte('asset-warm', 25, 'desktop', 't').abweichungProzent).toBeCloseTo(-50, 6);
  });
});

describe('Perzentile', () => {
  it('liefert p50, p95 und max', () => {
    const p = perzentile([5, 1, 3, 2, 4]);
    expect(p.n).toBe(5);
    expect(p.p50).toBe(3);
    expect(p.max).toBe(5);
    expect(p.summeMs).toBe(15);
  });

  it('meldet für eine leere Stichprobe NaN statt 0', () => {
    // 0 wäre ein „erfüllt"-aussehender Messwert für eine Messung, die nie
    // stattgefunden hat — genau der Nullwert-Fallstrick.
    expect(Number.isNaN(perzentile([]).p50)).toBe(true);
  });
});

describe('VRAM-/GPU-Registry-Buchführung', () => {
  it('zählt Bytes je Ressource genau einmal und gibt refcount-korrekt frei', () => {
    const b = new VramBuchfuehrung();
    b.erwirb('a', 1000, 1);
    b.erwirb('a', 1000, 1);
    b.erwirb('b', 500, 1);
    expect(b.bytes).toBe(1500);
    b.gibFrei('a');
    expect(b.bytes).toBe(1500); // noch eine Referenz offen
    b.gibFrei('a');
    expect(b.bytes).toBe(500); // 'a' ist weg, 'b' bleibt
    b.gibFrei('b');
    expect(b.bytes).toBe(0);
    expect(b.stand().fehlfreigaben).toBe(0);
  });

  it('gibt beim Generationswechsel genau die fremden Generationen frei', () => {
    const b = new VramBuchfuehrung();
    b.erwirb('alt', 100, 1);
    b.erwirb('neu', 200, 2);
    const befreit = b.gibFremdeGenerationenFrei(2);
    expect(befreit).toBe(100);
    expect(b.bytes).toBe(200);
    expect(b.eintraege).toBe(1);
  });

  it('meldet Freigaben unbekannter Schlüssel statt sie zu verschlucken', () => {
    const b = new VramBuchfuehrung();
    b.gibFrei('gibtsnicht');
    expect(b.stand().fehlfreigaben).toBe(1);
    expect(b.bytes).toBe(0);
  });

  it('schätzt Atlasbytes als Seiten × Kante² × RGBA8', () => {
    expect(atlasBytes(2, 2048)).toBe(2 * 2048 * 2048 * 4);
  });
});

describe('Synthetische Fake-Installation', () => {
  it('erzeugt ein scanbares Archiv mit Fields und maplist', async () => {
    const install = baueFakeInstallation({ fields: 4, kacheln: 64 });
    const datei = new MemorySourceFile(install.archivPfad, new Uint8Array(0));
    expect(install.fieldNamen).toHaveLength(4);
    expect(install.archivBytes).toBeGreaterThan(0);
    // Scan über die echte Quelle (nicht über die Attrappe oben).
    const quelle = install.quelle;
    const dateien = [];
    for await (const f of quelle.files()) dateien.push(f);
    expect(dateien).toHaveLength(1);
    const scan = await scanLgp(dateien[0]!, 'flevel', { mode: 'deep' });
    expect(scan.ok).toBe(true);
    const namen = scan.archive!.entries.map((e) => e.name);
    expect(namen).toContain('maplist');
    expect(namen).toContain('nfr000');
    expect(datei.size).toBe(0);
  });
});

describe('R5: Release-Fingerprint', () => {
  const archivMit = (namen: string[]): ReturnType<typeof buildLgp> =>
    buildLgp({ entries: namen.map((n) => ({ name: n, data: new TextEncoder().encode(`payload-${n}`) })) });

  it('ist stabil gegen Pfad und mtime, aber sensitiv gegen Inhaltsstruktur', async () => {
    const bytes = archivMit(['a.p', 'b.tex', 'c.hrc']).bytes;
    const a = await scanLgp(new MemorySourceFile('data/field/x.lgp', bytes, 1), 'x', { mode: 'deep' });
    const b = await scanLgp(new MemorySourceFile('ganz/woanders/y.lgp', bytes, 999_999), 'y', { mode: 'deep' });
    const fpA = await releaseFingerprint(a.archive!);
    const fpB = await releaseFingerprint(b.archive!);
    expect(fpA).toBe(fpB);

    // Kontrollhypothese: eine echte Variante MUSS einen anderen Wert liefern.
    const anders = archivMit(['a.p', 'b.tex', 'c.hrc', 'd.a']).bytes;
    const c = await scanLgp(new MemorySourceFile('data/field/x.lgp', anders, 1), 'x', { mode: 'deep' });
    expect(await releaseFingerprint(c.archive!)).not.toBe(fpA);
  });

  it('führt unbekannte Varianten in den best-effort-Pfad statt in den Abbruch', async () => {
    const bytes = archivMit(['unbekannt.p', 'variante.tex']).bytes;
    const scan = await scanLgp(new MemorySourceFile('data/field/flevel.lgp', bytes, 1), 'flevel', {
      mode: 'deep',
    });
    const profil = await profilMitFingerprint(scan.archive!);
    const urteil = klassifiziere(profil);
    expect(urteil.urteil).toBe('unbekannte-variante');
    expect(urteil.bestEffort).toBe(true);
    // Trotz unbekannter Variante bleibt das Archiv strukturell nutzbar:
    // Einträge sind aufgelöst, nichts ist quarantänisiert.
    expect(profil.eintraege).toBe(2);
    expect(profil.quarantaene).toBe(0);
    expect(profil.terminatorOk).toBe(true);
  });

  it('erkennt einen registrierten Fingerprint als bekannt', async () => {
    const bytes = archivMit(['a.p']).bytes;
    const scan = await scanLgp(new MemorySourceFile('data/field/flevel.lgp', bytes, 1), 'flevel', {
      mode: 'deep',
    });
    const profil = await profilMitFingerprint(scan.archive!);
    const registry = [
      { kurz: kurz(profil.releaseFingerprint), archiv: 'flevel', bezeichnung: 'testrelease', herkunft: 'test' },
    ];
    expect(klassifiziere(profil, registry).urteil).toBe('bekannt');
    // Derselbe Fingerprint unter anderem Archivnamen ist NICHT dasselbe Release.
    expect(klassifiziere({ ...profil, archiv: 'char' }, registry).urteil).toBe('unbekannte-variante');
  });

  it('erzeugt einen beweisbar assetfreien Bericht', async () => {
    const bytes = archivMit(['geheim.p', 'auch_geheim.tex']).bytes;
    const scan = await scanLgp(new MemorySourceFile('data/field/flevel.lgp', bytes, 1), 'flevel', {
      mode: 'deep',
    });
    const profil = await profilMitFingerprint(scan.archive!);
    const pruefung = berichtIstAssetfrei(profil);
    expect(pruefung.ok, pruefung.stelle).toBe(true);
    // Gegenprobe: ein Dateiname im Bericht muss auffallen.
    expect(berichtIstAssetfrei({ ...profil, leck: 'geheim.p' }).ok).toBe(false);
  });

  it('hält die Registry bekannter Releases konsistent', () => {
    for (const r of BEKANNTE_RELEASES) {
      expect(r.kurz).toMatch(/^[0-9a-f]{16}$/);
      expect(r.herkunft.length).toBeGreaterThan(0);
    }
  });

  it('trennt Profil und Fingerprint sauber', async () => {
    const bytes = archivMit(['a.p']).bytes;
    const scan = await scanLgp(new MemorySourceFile('a.lgp', bytes, 1), 'a', { mode: 'deep' });
    expect(archivProfil(scan.archive!).releaseFingerprint).toBe('');
  });
});

describe('R9: Math-Expositionsanalyse', () => {
  it('zählt implementierungsdefinierte Aufrufe und stellt Math wieder her', () => {
    const originalAtan2 = Math.atan2;
    const { exposition } = messeMathExposition(() => {
      Math.atan2(1, 2);
      Math.hypot(3, 4);
      Math.sqrt(16);
      return 0;
    });
    expect(exposition.unsicher['atan2']).toBe(1);
    expect(exposition.unsicher['hypot']).toBe(1);
    expect(exposition.sicher['sqrt']).toBe(1);
    expect(Math.atan2).toBe(originalAtan2);
  });

  it('meldet für den Kontrolllauf ohne unsichere Mathematik exakt 0', () => {
    const { exposition } = messeMathExposition(() => kontrollLauf());
    expect(exposition.summeUnsicher).toBe(0);
    expect(exposition.summeSicher).toBeGreaterThan(0);
    expect(exposition.anteilUnsicherProzent).toBe(0);
  });

  it('stellt Math auch bei einem Fehler im Messlauf wieder her', () => {
    const originalHypot = Math.hypot;
    expect(() =>
      messeMathExposition(() => {
        throw new Error('absichtlich');
      }),
    ).toThrow('absichtlich');
    expect(Math.hypot).toBe(originalHypot);
  });
});

describe('R9: Replay-Digest-Vektoren', () => {
  it('sind reproduzierbar innerhalb derselben Engine', () => {
    const a = berechneReplayVektoren();
    const b = berechneReplayVektoren();
    expect(a.map((v) => v.digest)).toEqual(b.map((v) => v.digest));
    expect(a).toHaveLength(3);
    for (const v of a) expect(v.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('stimmen mit den festgehaltenen Erwartungswerten überein', () => {
    const vergleich = vergleicheGegenErwartung(berechneReplayVektoren());
    // Sichtbare Zahlen im Fehlerfall: welcher Vektor abweicht, steht im Diff.
    expect(vergleich.filter((v) => !v.gleich)).toEqual([]);
    expect(Object.keys(ERWARTETE_DIGESTS)).toHaveLength(3);
  });

  it('berührt nachweislich implementierungsdefinierte Mathematik', () => {
    // Ohne diese Gegenprobe wäre nicht belegt, dass die Vektoren das
    // R9-Risiko überhaupt treffen — ein Digest über reine Ganzzahlarithmetik
    // wäre trivial portabel und damit aussagelos.
    const { exposition } = messeMathExposition(() => berechneReplayVektoren());
    expect(exposition.summeUnsicher).toBeGreaterThan(0);
  });
});
