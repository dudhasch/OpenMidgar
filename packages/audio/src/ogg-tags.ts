/**
 * Lesen der Vorbis-Kommentare eines OGG-Stroms (S16) — **ohne Audiodekodierung**.
 *
 * Gebraucht werden nur die Schleifenmarken. Der Dekoder überspringt die
 * OGG-Seiten bis zum Kommentar-Header und liest die Schlüssel/Wert-Paare; er
 * berührt keine Audiodaten und lädt keine Bibliothek.
 *
 * ✅ Realdaten-Befund (94 Titel der Nutzerinstallation, alle lesbar):
 * **87 % tragen `LOOPSTART`, aber KEIN einziger `LOOPLENGTH`.** Das prägt das
 * Schleifenmodell: Es gibt keinen Endpunkt in den Daten, also läuft die
 * Schleife bis zum Dateiende und springt zurück auf `LOOPSTART`.
 */

export interface OggLoopTags {
  /** Startpunkt der Schleife in Samples; null = kein Tag. */
  loopStart: number | null;
  /** Länge der Schleife in Samples; im Bestand nie vorhanden (🔴). */
  loopLength: number | null;
  /** Alle gefundenen Kommentarschlüssel (Großschreibung) — für Diagnosen. */
  keys: string[];
}

const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53]; // "OggS"

/**
 * Liest die Kommentare aus den ersten Seiten. `maxPages` begrenzt den Aufwand:
 * Der Kommentar-Header steht immer am Anfang, ein Durchlauf durch die ganze
 * Datei wäre reine Verschwendung.
 */
export function readOggLoopTags(bytes: Uint8Array, maxPages = 8): OggLoopTags {
  const keys: string[] = [];
  let loopStart: number | null = null;
  let loopLength: number | null = null;

  let offset = 0;
  let pages = 0;
  // Nutzdaten der ersten Seiten zusammenführen: Der Kommentar-Header kann
  // über eine Seitengrenze laufen.
  const payload: number[] = [];
  while (offset + 27 <= bytes.length && pages < maxPages) {
    if (!OGG_MAGIC.every((b, i) => bytes[offset + i] === b)) break;
    const segments = bytes[offset + 26]!;
    const tableAt = offset + 27;
    if (tableAt + segments > bytes.length) break;
    let dataLen = 0;
    for (let i = 0; i < segments; i++) dataLen += bytes[tableAt + i]!;
    const dataAt = tableAt + segments;
    if (dataAt + dataLen > bytes.length) break;
    for (let i = 0; i < dataLen; i++) payload.push(bytes[dataAt + i]!);
    offset = dataAt + dataLen;
    pages++;
  }

  const buf = Uint8Array.from(payload);
  // Der Kommentar-Header beginnt mit 0x03 gefolgt von "vorbis".
  const marker = [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73];
  let at = -1;
  outer: for (let i = 0; i + marker.length <= buf.length; i++) {
    for (let k = 0; k < marker.length; k++) if (buf[i + k] !== marker[k]) continue outer;
    at = i + marker.length;
    break;
  }
  if (at < 0) return { loopStart, loopLength, keys };

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const readU32 = (o: number): number => (o + 4 <= buf.length ? view.getUint32(o, true) : 0);
  const vendorLen = readU32(at);
  let cursor = at + 4 + vendorLen;
  const count = readU32(cursor);
  cursor += 4;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  for (let i = 0; i < count && cursor + 4 <= buf.length; i++) {
    const len = readU32(cursor);
    cursor += 4;
    if (cursor + len > buf.length) break;
    const entry = decoder.decode(buf.subarray(cursor, cursor + len));
    cursor += len;
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    const key = entry.slice(0, eq).toUpperCase();
    const value = entry.slice(eq + 1);
    keys.push(key);
    if (key === 'LOOPSTART') loopStart = Number.parseInt(value, 10);
    else if (key === 'LOOPLENGTH') loopLength = Number.parseInt(value, 10);
  }
  return {
    loopStart: Number.isFinite(loopStart ?? NaN) ? loopStart : null,
    loopLength: Number.isFinite(loopLength ?? NaN) ? loopLength : null,
    keys,
  };
}

export interface LoopPlan {
  /** Schleifenanfang in Samples. */
  start: number;
  /** Schleifenende in Samples; `null` = bis zum Dateiende. */
  end: number | null;
  /** Warum dieser Plan gilt — für Diagnosen und die Doku. */
  reason: 'tagged-range' | 'tagged-start-to-end' | 'whole-file';
}

/**
 * Leitet den Schleifenplan aus den Tags ab.
 *
 * Die Rückfallregel ist ausdrücklich festgelegt statt „irgendwie": Ohne
 * `LOOPSTART` läuft die ganze Datei in der Schleife. Das ist im Bestand der
 * Regelfall für 13 % der Titel — eine undefinierte Behandlung würde dort
 * hörbar auffallen.
 */
export function planLoop(tags: OggLoopTags, totalSamples: number | null): LoopPlan {
  if (tags.loopStart !== null && tags.loopLength !== null) {
    return { start: tags.loopStart, end: tags.loopStart + tags.loopLength, reason: 'tagged-range' };
  }
  if (tags.loopStart !== null) {
    return { start: tags.loopStart, end: totalSamples, reason: 'tagged-start-to-end' };
  }
  return { start: 0, end: totalSamples, reason: 'whole-file' };
}
