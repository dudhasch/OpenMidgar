import { mdiag, type ModelDiagnostic } from './diagnostics.js';
import { fnv1a32Numbers, type Skeleton, type SkeletonBone } from './nam.js';

/**
 * `.hrc`-Parser (🟢 Textformat, Masterplan 1.2): Headerblock + flache
 * Bone-Records (Name, Parent, Länge, Ressourcenliste). Hierarchie über
 * benannte Parent-Referenz, "root" markiert die Wurzel. Rest-/Bindpose ist
 * implizit — das Format enthält keine Rotationen.
 */

export interface ParseResult<T> {
  value: T | null;
  diagnostics: ModelDiagnostic[];
}

const decoder = new TextDecoder('ascii');

export function parseHrc(bytes: Uint8Array, asset: string): ParseResult<Skeleton> {
  const diagnostics: ModelDiagnostic[] = [];
  const failed = (message: string): ParseResult<Skeleton> => {
    diagnostics.push(mdiag('E-HRC-GRAMMAR', asset, message));
    return { value: null, diagnostics };
  };
  // Kommentar-/Leerzeilen tolerieren (# als dokumentierter Kommentarmarker).
  const lines = decoder
    .decode(bytes)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  let name = '';
  let boneCount = -1;
  let cursor = 0;
  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor]!;
    if (line.startsWith(':HEADER_BLOCK')) continue;
    if (line.startsWith(':SKELETON')) {
      name = line.slice(':SKELETON'.length).trim();
      continue;
    }
    if (line.startsWith(':BONES')) {
      boneCount = Number.parseInt(line.slice(':BONES'.length).trim(), 10);
      cursor++;
      break;
    }
    return failed(`Unerwartete Headerzeile: ${line.slice(0, 40)}`);
  }
  if (boneCount < 0 || Number.isNaN(boneCount)) {
    return failed(':BONES fehlt oder unlesbar');
  }

  interface RawBone {
    name: string;
    parent: string;
    length: number;
    resources: string[];
  }
  const raw: RawBone[] = [];
  for (let b = 0; b < boneCount; b++) {
    if (cursor + 4 > lines.length) {
      return failed(`Bone ${b}: Datei endet vor dem 4-Zeilen-Record`);
    }
    const boneName = lines[cursor]!.toLowerCase();
    const parent = lines[cursor + 1]!.toLowerCase();
    const length = Number.parseFloat(lines[cursor + 2]!);
    const resLine = lines[cursor + 3]!.split(/\s+/);
    const resCount = Number.parseInt(resLine[0]!, 10);
    if (Number.isNaN(length) || Number.isNaN(resCount) || resLine.length < 1 + resCount) {
      return failed(`Bone ${b} (${boneName}): Länge/Ressourcenzeile unlesbar`);
    }
    raw.push({
      name: boneName,
      parent,
      length,
      resources: resLine.slice(1, 1 + resCount).map((r) => r.toLowerCase()),
    });
    cursor += 4;
  }

  // Parent-Auflösung über Namen. Bones dürfen Namen wiederverwenden —
  // aufgelöst wird gegen die jüngste VORHERIGE Definition (Dateireihenfolge);
  // Vorwärts-/Selbstreferenz wäre ein Zyklus → E-HRC-CYCLE.
  const bones: SkeletonBone[] = [];
  const indexByName = new Map<string, number>();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!;
    let parentIndex: number;
    if (r.parent === 'root') {
      parentIndex = -1;
    } else {
      const found = indexByName.get(r.parent);
      if (found === undefined) {
        diagnostics.push(mdiag('E-HRC-CYCLE', asset, `Bone ${i} (${r.name}): Parent "${r.parent}" nicht vorher definiert`));
        return { value: null, diagnostics };
      }
      parentIndex = found;
    }
    bones.push({ name: r.name, parentIndex, length: r.length, resourceRefs: r.resources, fileOrder: i });
    indexByName.set(r.name, i);
  }

  return {
    value: {
      schemaVersion: 1,
      name,
      bones,
      topologyHash: fnv1a32Numbers([bones.length, ...bones.map((b) => b.parentIndex + 1)]),
      diagnostics,
    },
    diagnostics,
  };
}
