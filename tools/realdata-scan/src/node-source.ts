import { open, readdir, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { DirectorySource, SourceFile } from '@webmidgar/io';

/**
 * Node-Adapter der IO-Quellenabstraktion für den lokalen Realdaten-Scan.
 * Liest ausschließlich; Originaldaten verlassen nie die Maschine — Ergebnis
 * des Scans sind aggregierte Diagnosen (Masterplan: „Diagnose-Scan").
 *
 * **Dateihandles müssen geschlossen werden.** Node duldet seit v20 nicht mehr,
 * dass ein `FileHandle` von der Speicherbereinigung eingesammelt wird: Wer ein
 * Handle nur wegwirft, statt es zu schließen, bekommt `ERR_INVALID_STATE` als
 * UNBEHANDELTEN Fehler gemeldet — und zwar irgendwann später, in irgendeiner
 * Probe, die zufällig gerade lief. Solche Störfehler kosten nichts an
 * Testergebnissen, aber sie stehen in jedem Protokoll und würden einen echten
 * unbehandelten Fehler überdecken. Deshalb zwei Absicherungen:
 *
 * 1. Jede Probe schließt ihre Quelle selbst — `closeAll()` am Ende des
 *    Lesevorgangs (bei einzelnen Dateien: `close()`).
 * 2. `offeneQuellen` führt zusätzlich Buch. `alleQuellenSchliessen()` räumt am
 *    Ende jeder Testdatei auf (eingehängt in `handle-aufraeumer.ts`, siehe
 *    `setupFiles` in `vitest.realdata.config.ts`). Das Netz fängt ab, was 1.
 *    verfehlt: eine vergessene Probe ebenso wie einen Testabbruch, der den
 *    `closeAll()`-Aufruf überspringt.
 */

/** Alle Dateien mit derzeit offenem Handle — Grundlage des Aufräumnetzes. */
const offeneQuellen = new Set<NodeSourceFile>();

/**
 * Schließt jedes noch offene Handle dieses Prozesses. Idempotent: Wurde bereits
 * alles geschlossen, tut der Aufruf nichts.
 */
export async function alleQuellenSchliessen(): Promise<void> {
  await Promise.all([...offeneQuellen].map((f) => f.close()));
}

export class NodeSourceFile implements SourceFile {
  /**
   * Das laufende oder bereits erfüllte `open()`; `null`, solange nichts offen
   * ist. Bewusst die PROMISE und nicht das fertige Handle: Zwei gleichzeitige
   * `read()` würden sonst beide ein `open()` starten, das zweite Handle das
   * erste überschreiben — und das erste wäre unschließbar verloren.
   */
  #oeffnung: Promise<FileHandle> | null = null;

  constructor(
    private readonly absPath: string,
    public readonly path: string,
    public readonly size: number,
    public readonly lastModified: number,
  ) {}

  get name(): string {
    return this.path.split('/').pop()!;
  }

  async read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new RangeError(`read out of bounds: ${offset}+${length} > ${this.size}`);
    }
    const handle = await this.#oeffnen();
    const buf = new Uint8Array(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await handle.read(buf, done, length - done, offset + done);
      if (bytesRead === 0) throw new Error(`EOF bei ${offset + done} in ${this.path}`);
      done += bytesRead;
    }
    return buf;
  }

  /** Öffnet höchstens einmal; nach `close()` wird bei Bedarf neu geöffnet. */
  #oeffnen(): Promise<FileHandle> {
    if (!this.#oeffnung) {
      this.#oeffnung = open(this.absPath, 'r');
      offeneQuellen.add(this);
    }
    return this.#oeffnung;
  }

  async close(): Promise<void> {
    const oeffnung = this.#oeffnung;
    this.#oeffnung = null;
    offeneQuellen.delete(this);
    // Ein noch laufendes `open()` muss abgewartet werden — sonst entsteht das
    // Handle erst hinterher, und dann schließt es niemand mehr. Ein zuvor
    // gescheitertes `open()` hat den Lesevorgang bereits scheitern lassen und
    // darf hier nicht ein zweites Mal auffallen.
    await oeffnung?.then(
      (h) => h.close(),
      () => undefined,
    );
  }
}

export class NodeDirectorySource implements DirectorySource {
  readonly opened: NodeSourceFile[] = [];
  constructor(
    private readonly root: string,
    /** Nur diese Unterpfade (relativ, '/'-getrennt) aufzählen; leer = alles. */
    private readonly includePrefixes: string[] = [],
  ) {}

  async *files(signal?: AbortSignal): AsyncIterable<SourceFile> {
    yield* this.walk(this.root, '', signal);
  }

  private async *walk(abs: string, rel: string, signal?: AbortSignal): AsyncIterable<SourceFile> {
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const childAbs = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (
          this.includePrefixes.length === 0 ||
          this.includePrefixes.some((p) => p.startsWith(childRel) || childRel.startsWith(p))
        ) {
          yield* this.walk(childAbs, childRel, signal);
        }
      } else if (
        this.includePrefixes.length === 0 ||
        this.includePrefixes.some((p) => childRel.startsWith(p))
      ) {
        const s = await stat(childAbs);
        const file = new NodeSourceFile(childAbs, childRel, s.size, s.mtimeMs);
        this.opened.push(file);
        yield file;
      }
    }
  }

  /** Schließt alle aufgezählten Dateien; danach darf weitergelesen werden. */
  async closeAll(): Promise<void> {
    await Promise.all(this.opened.map((f) => f.close()));
  }
}
