import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseHrc, parseP, parseRsd } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';

/**
 * Nachgang zur Sichtprüfung (Rückmeldung 2026-08-15: „Knie und Übergänge
 * zwischen Bones überschneiden sich scharf").
 *
 * Feldmodelle sind starr segmentiert — je Bone ein eigenes `.p`, kein Skinning.
 * Dass sich Segmente an Gelenken durchdringen, ist damit bauartbedingt. Die
 * Frage ist, ob wir es SCHLIMMER machen als die Vorlage. Zwei Verdächtige:
 *
 *  J1  Der Aufkleber-Tiefenvorzug (`polygonOffset`) trifft in `render-actor`
 *      jedes TEXTURIERTE Submesh. Gedacht ist er für Gesichtsaufkleber. Wie
 *      viele texturierte Submeshes sind KEINE Aufkleber (also Gouraud)? Die
 *      bekämen den Vorzug zu Unrecht und stächen durch Nachbarsegmente.
 *  J2  Wie tief ragt die Geometrie eines Bones über seine eigene Länge hinaus?
 *      Das ist das Maß der bauartbedingten Durchdringung — gemessen, damit die
 *      Aussage „liegt am Format" eine Zahl hat statt einer Behauptung.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Gelenküberschneidung der Feldmodelle', () => {
  it('J1/J2: Tiefenvorzug-Treffer und Überstand je Bone', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const char = new Map<string, string>();
    for (const e of index.listEntries('char')) char.set(e.name.toLowerCase(), e.canonicalId);
    const lies = async (name: string): Promise<Uint8Array | null> => {
      const id = char.get(name.toLowerCase());
      return id ? index.readEntry(id).catch(() => null) : null;
    };

    const j1 = { texturiert: 0, texturiertUndFlach: 0, texturiertUndGouraud: 0, betroffeneDateien: [] as string[] };
    const j2 = {
      bonesMitMesh: 0,
      ueberstandRelativ: [] as number[], // (Meshtiefe − |Bonelänge|) / |Bonelänge|
      beispiel: null as null | Record<string, unknown>,
    };

    const hrcNamen = [...char.keys()].filter((n) => n.endsWith('.hrc'));
    for (const hrcName of hrcNamen) {
      const hrcBytes = await lies(hrcName);
      if (!hrcBytes) continue;
      const skel = parseHrc(hrcBytes, hrcName).value;
      if (!skel) continue;

      for (const bone of skel.bones) {
        const laenge = Math.abs(bone.length);
        for (const ref of bone.resourceRefs) {
          const rsdBytes = await lies(`${ref}.rsd`);
          if (!rsdBytes) continue;
          const rsd = parseRsd(rsdBytes, `${ref}.rsd`).value;
          if (!rsd) continue;
          const pBytes = await lies(`${rsd.meshRef}.p`);
          if (!pBytes) continue;
          const mesh = parseP(pBytes, `${rsd.meshRef}.p`).value;
          if (!mesh) continue;

          for (const s of mesh.submeshes) {
            if (!s.textured) continue;
            j1.texturiert++;
            if (s.flatShaded) j1.texturiertUndFlach++;
            else {
              j1.texturiertUndGouraud++;
              if (!j1.betroffeneDateien.includes(rsd.meshRef)) j1.betroffeneDateien.push(rsd.meshRef);
            }
          }

          if (laenge > 0.01) {
            // Tiefe der Bone-Geometrie entlang der Kettenachse (Modell-Z).
            let zMin = Infinity;
            let zMax = -Infinity;
            for (let v = 0; v < mesh.positions.length; v += 3) {
              const z = mesh.positions[v + 2]!;
              if (z < zMin) zMin = z;
              if (z > zMax) zMax = z;
            }
            const tiefe = zMax - zMin;
            j2.bonesMitMesh++;
            j2.ueberstandRelativ.push((tiefe - laenge) / laenge);
            if (!j2.beispiel && hrcName === 'beec.hrc') {
              j2.beispiel = { hrc: hrcName, bone: bone.name, laenge: bone.length, meshTiefe: +tiefe.toFixed(2) };
            }
          }
        }
      }
    }

    await dir.closeAll();

    const sortiert = [...j2.ueberstandRelativ].sort((a, b) => a - b);
    const q = (p: number): number => +(sortiert[Math.floor(p * (sortiert.length - 1))] ?? 0).toFixed(3);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          J1: { ...j1, betroffeneDateien: j1.betroffeneDateien.slice(0, 20) },
          J2: {
            bonesMitMesh: j2.bonesMitMesh,
            ueberstandRelativ: { p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(1) },
            anteilLaengerAlsBone: +(sortiert.filter((x) => x > 0).length / sortiert.length).toFixed(3),
            beispiel: j2.beispiel,
          },
        },
        null,
        1,
      ),
    );

    expect(j2.bonesMitMesh).toBeGreaterThan(100);
  });
});
