/**
 * Fähigkeitsprüfung (S18, R3). Jede Pflichtfähigkeit wird **einzeln** geprüft
 * und einzeln benannt — eine pauschale Meldung „Browser nicht unterstützt"
 * hilft niemandem beim Beheben.
 *
 * Die Prüfung ist eine reine Funktion über ein Umgebungsobjekt, damit alle
 * Ausfallpfade in Node testbar sind, ohne einen Browser zu simulieren.
 */

export type CapabilityId = 'webgl2' | 'fileAccess' | 'indexedDb' | 'moduleWorker' | 'compression';

export interface CapabilityProbe {
  webgl2: () => boolean;
  /** File System Access API ODER der Rückfallpfad über ein Verzeichnisfeld. */
  fileAccess: () => boolean;
  indexedDb: () => boolean;
  moduleWorker: () => boolean;
  /** `DecompressionStream` — nötig für den Kernel-Pfad. */
  compression: () => boolean;
}

export interface CapabilityResult {
  id: CapabilityId;
  available: boolean;
  /** Warum sie gebraucht wird und was ohne sie fehlt — für die Nutzerdiagnose. */
  message: string;
}

const MESSAGES: Record<CapabilityId, string> = {
  webgl2:
    'WebGL2 fehlt. Ohne sie lässt sich der Hintergrund nicht mit Tiefenpuffer zeichnen — ' +
    'Figuren würden nicht korrekt hinter Vordergrundkacheln verschwinden.',
  fileAccess:
    'Weder die File System Access API noch ein Verzeichnisfeld stehen bereit. ' +
    'Ohne einen der beiden Wege lässt sich die lokale Installation nicht einlesen.',
  indexedDb:
    'IndexedDB fehlt. Der Index müsste dann bei jedem Start neu aufgebaut werden, ' +
    'und Spielstände ließen sich nicht sichern.',
  moduleWorker:
    'Module-Worker fehlen. Entpacken und Parsen liefen dann im Hauptthread und würden ' +
    'die Darstellung sichtbar blockieren.',
  compression:
    'DecompressionStream fehlt. Die Kerneldaten sind gzip-komprimiert und ließen sich nicht lesen.',
};

/** Prüft alle Fähigkeiten in stabiler Reihenfolge. */
export function checkCapabilities(probe: CapabilityProbe): CapabilityResult[] {
  const ids: CapabilityId[] = ['webgl2', 'fileAccess', 'indexedDb', 'moduleWorker', 'compression'];
  return ids.map((id) => {
    let available = false;
    try {
      available = probe[id]();
    } catch {
      // Eine werfende Prüfung ist eine fehlende Fähigkeit, kein Absturz.
      available = false;
    }
    return { id, available, message: MESSAGES[id] };
  });
}

export function missingCapabilities(results: readonly CapabilityResult[]): CapabilityResult[] {
  return results.filter((r) => !r.available);
}

/** Prüfungen gegen echte Browser-Globals; im Test durch Attrappen ersetzbar. */
export function browserProbe(scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): CapabilityProbe {
  return {
    webgl2: () => {
      const doc = scope['document'] as { createElement?: (t: string) => unknown } | undefined;
      if (!doc?.createElement) return false;
      const canvas = doc.createElement('canvas') as { getContext?: (t: string) => unknown };
      return Boolean(canvas.getContext?.('webgl2'));
    },
    fileAccess: () => 'showDirectoryPicker' in scope || 'webkitdirectory' in ((scope['HTMLInputElement'] as { prototype?: object } | undefined)?.prototype ?? {}),
    indexedDb: () => 'indexedDB' in scope && scope['indexedDB'] != null,
    moduleWorker: () => 'Worker' in scope,
    compression: () => 'DecompressionStream' in scope,
  };
}
