import { kdiag, type KernelDiagnostic, type KernelDiagnosticCode } from './diagnostics.js';

/**
 * `kernel.bin` — Containerformat der Spieldatenbasis (S13).
 *
 * Der Container ist eine reine Folge von Sektionen; jede trägt einen 6-Byte-Kopf
 * und danach einen gzip-Strom. Über die Belegung des Kopfes gibt es zwei
 * plausible Auslegungen, und der Parser **entscheidet sie selbst** statt sie
 * anzunehmen: Er probiert beide und nimmt die, deren Accounting exakt auf die
 * Dateigröße aufgeht. Geht keine auf, ist die Datei fatal — nicht halb geraten.
 *
 * Entpackt wird mit `DecompressionStream('gzip')`. Das ist bewusst kein
 * `node:zlib`: derselbe Code muss im Browser laufen. Dadurch ist der Parser
 * asynchron — als einziger im Projekt, und aus gutem Grund.
 */

export const KERNEL_SECTION_HEADER_LEN = 6;

/** Wie der 6-Byte-Sektionskopf gelesen wird. */
export type KernelHeaderLayout =
  /** u16 komprimiert, u16 entpackt, u16 Dateityp. */
  | 'u16-triple'
  /** u32 komprimiert, u16 Dateityp. */
  | 'u32-len';

export interface KernelSection {
  index: number;
  /** Länge des gzip-Stroms laut Kopf. */
  compressedLength: number;
  /** Entpackte Länge laut Kopf; null, wenn das Layout sie nicht führt. */
  declaredLength: number | null;
  /** Drittes Kopffeld (Dateityp) — roh konserviert (🟡). */
  typeRaw: number;
  /** Entpackte Nutzdaten; leer, wenn die Sektion quarantänisiert wurde. */
  data: Uint8Array;
  ok: boolean;
}

export interface KernelContainer {
  schemaVersion: 1;
  layout: KernelHeaderLayout;
  sections: KernelSection[];
  diagnostics: KernelDiagnostic[];
}

interface HeaderReader {
  layout: KernelHeaderLayout;
  read: (view: DataView, offset: number) => { compressed: number; declared: number | null; typeRaw: number };
}

const READERS: readonly HeaderReader[] = [
  {
    layout: 'u16-triple',
    read: (view, o) => ({
      compressed: view.getUint16(o, true),
      declared: view.getUint16(o + 2, true),
      typeRaw: view.getUint16(o + 4, true),
    }),
  },
  {
    layout: 'u32-len',
    read: (view, o) => ({
      compressed: view.getUint32(o, true),
      declared: null,
      typeRaw: view.getUint16(o + 4, true),
    }),
  },
];

/**
 * Prüft, ob eine Kopfauslegung die Datei restlos ausläuft. Rückgabe: Anzahl
 * Sektionen oder null. Genau dieses Accounting hat schon in S8/S10 die
 * Formatentscheidungen getragen — eine Auslegung ist erst richtig, wenn sie
 * byteexakt aufgeht.
 */
/**
 * Nullbytes, die die Originaldatei hinter der letzten Sektion trägt.
 * ✅ Realdaten-Befund (S13): `kernel.bin` rechnet mit 27 Sektionen exakt
 * 22.102 von 22.104 Byte ab — die letzten **zwei** Bytes sind 0 und gehören
 * keiner Sektion. Der Parser lässt genau diesen Rest zu (und nur, wenn er
 * wirklich genullt ist), statt die Datei deswegen abzulehnen.
 */
export const KERNEL_MAX_TRAILER = 2;

function accountSections(bytes: Uint8Array, reader: HeaderReader): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let count = 0;
  while (bytes.length - offset > KERNEL_MAX_TRAILER) {
    if (offset + KERNEL_SECTION_HEADER_LEN > bytes.length) return null;
    const { compressed } = reader.read(view, offset);
    if (compressed <= 0) return null;
    const next = offset + KERNEL_SECTION_HEADER_LEN + compressed;
    if (next > bytes.length) return null;
    // gzip-Magic als zusätzliche Absicherung gegen zufällig passende Längen.
    if (bytes[offset + KERNEL_SECTION_HEADER_LEN] !== 0x1f || bytes[offset + KERNEL_SECTION_HEADER_LEN + 1] !== 0x8b) {
      return null;
    }
    offset = next;
    count++;
    if (count > 256) return null;
  }
  // Der Rest muss vollständig genullt sein — sonst ist es kein Trailer,
  // sondern eine nicht verstandene Struktur, und die wird nicht überlesen.
  for (let i = offset; i < bytes.length; i++) {
    if (bytes[i] !== 0) return null;
  }
  return count > 0 ? count : null;
}

/**
 * Wie oft nennt der Kopf dieser Auslegung die tatsächliche entpackte Länge?
 * Auslegungen ohne Längenfeld erreichen naturgemäß 0 — sie gewinnen damit nur,
 * wenn die Alternative ebenfalls nie trifft.
 */
async function scoreDeclaredLengths(bytes: Uint8Array, reader: HeaderReader): Promise<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let hits = 0;
  while (bytes.length - offset > KERNEL_MAX_TRAILER) {
    const { compressed, declared } = reader.read(view, offset);
    const start = offset + KERNEL_SECTION_HEADER_LEN;
    if (declared !== null) {
      try {
        const data = await gunzip(bytes.subarray(start, start + compressed));
        if (data.length === declared) hits++;
      } catch {
        /* defekte Sektion zählt nicht */
      }
    }
    offset = start + compressed;
  }
  return hits;
}

async function gunzip(chunk: Uint8Array): Promise<Uint8Array> {
  // Kopie in einen eigenen ArrayBuffer: `subarray` kann auf einen
  // SharedArrayBuffer zeigen, den Blob nicht annimmt.
  const owned = new Uint8Array(chunk.length);
  owned.set(chunk);
  const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream('gzip'));
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = value as Uint8Array;
    parts.push(part);
    total += part.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function parseKernelContainer(bytes: Uint8Array, asset: string): Promise<KernelContainer | null> {
  const diagnostics: KernelDiagnostic[] = [];
  if (bytes.length < KERNEL_SECTION_HEADER_LEN + 2) {
    diagnostics.push(kdiag('E-KRN-HDR', asset, `Datei zu kurz (${bytes.length} B)`));
    return { schemaVersion: 1, layout: 'u16-triple', sections: [], diagnostics };
  }

  const candidates = READERS.map((r) => ({ reader: r, count: accountSections(bytes, r) })).filter(
    (c) => c.count !== null,
  );
  if (candidates.length === 0) {
    diagnostics.push(
      kdiag('E-KRN-ACCOUNT', asset, 'keine Kopfauslegung läuft die Datei byteexakt aus'),
    );
    return { schemaVersion: 1, layout: 'u16-triple', sections: [], diagnostics };
  }
  // **Mehrdeutigkeit, die auffallen muss:** Solange eine Sektion unter 64 KB
  // komprimiert, sind beide Auslegungen BYTEIDENTISCH lesbar — das u32-Feld
  // hat dann null in den oberen 16 Bit, was als `declared = 0` durchgeht.
  // Die Sektionsanzahl unterscheidet sie deshalb nicht. Entschieden wird über
  // das entpackte Ergebnis: Nur unter `u16-triple` nennt der Kopf die
  // entpackte Länge, und die muss stimmen. Trifft sie nie, gilt `u32-len`.
  let reader = candidates[0]!.reader;
  let declaredHits = await scoreDeclaredLengths(bytes, reader);
  for (const candidate of candidates.slice(1)) {
    const score = await scoreDeclaredLengths(bytes, candidate.reader);
    if (score > declaredHits) {
      declaredHits = score;
      reader = candidate.reader;
    }
  }
  // Wann ist eine Abweichung meldenswert? Liest man eine `u32-len`-Datei
  // versehentlich als `u16-triple`, steht im vermeintlichen Längenfeld das
  // obere Halbwort der Kompressionslänge — bei Sektionen unter 64 KB also
  // **0**. Genau dieser Fall wird stillgehalten, sofern kein einziger Kopf
  // getroffen hat. Ein von 0 verschiedener, aber falscher Wert bleibt dagegen
  // eine echte Meldung.
  const declaredTrustworthy = declaredHits > 0;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections: KernelSection[] = [];
  let offset = 0;
  let index = 0;
  while (bytes.length - offset > KERNEL_MAX_TRAILER) {
    const { compressed, declared, typeRaw } = reader.read(view, offset);
    const start = offset + KERNEL_SECTION_HEADER_LEN;
    const raw = bytes.subarray(start, start + compressed);
    let data: Uint8Array = new Uint8Array(0);
    let ok = true;
    try {
      data = new Uint8Array(await gunzip(raw));
    } catch (err) {
      ok = false;
      diagnostics.push(
        kdiag(`E-KRN-SEC${index}` as KernelDiagnosticCode, asset, `gzip-Strom defekt: ${(err as Error).message}`, index),
      );
    }
    const declaredIsNoise = declared === 0 && !declaredTrustworthy;
    if (ok && declared !== null && declared !== data.length && !declaredIsNoise) {
      // Kein Abbruch: die Nutzdaten sind da, nur das Kopffeld passt nicht.
      diagnostics.push(
        kdiag('E-KRN-GZIP', asset, `entpackt ${data.length} B, Kopf nennt ${declared} B`, index),
      );
    }
    sections.push({ index, compressedLength: compressed, declaredLength: declared, typeRaw, data, ok });
    offset = start + compressed;
    index++;
  }

  return { schemaVersion: 1, layout: reader.layout, sections, diagnostics };
}
