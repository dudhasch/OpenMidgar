import { missingCapabilities, type CapabilityResult } from './capabilities.js';

/**
 * Import-Ablauf als Zustandsmaschine (S18).
 *
 * Der Zugriff auf lokale Dateien ist im Browser an einen Berechtigungs-
 * lebenszyklus gebunden (R3): Ein gespeicherter Verzeichnis-Handle überlebt
 * den Neustart, die **Erlaubnis** dazu aber nicht — sie muss neu erteilt
 * werden, und das geht nur aus einer Nutzergeste heraus. Genau diese Feinheit
 * ist der Grund, warum der Ablauf eine explizite Maschine ist und keine
 * Aneinanderreihung von `await`: Jeder Zustand benennt, worauf gewartet wird
 * und was der Nutzer tun muss.
 *
 * Die Maschine ist rein: keine DOM-Zugriffe, keine Zeitquelle. Alle
 * Übergänge kommen als Ereignisse herein.
 */

export type ImportState =
  /** Fähigkeiten noch nicht geprüft. */
  | { kind: 'start' }
  /** Mindestens eine Pflichtfähigkeit fehlt — Ende der Fahnenstange. */
  | { kind: 'unsupported'; missing: CapabilityResult[] }
  /** Kein gespeicherter Handle: Der Nutzer muss ein Verzeichnis wählen. */
  | { kind: 'awaiting-directory' }
  /** Handle vorhanden, Erlaubnis fehlt: eine Geste genügt. */
  | { kind: 'awaiting-regrant'; handleId: string }
  /** Verzeichnis steht, Index wird aufgebaut. */
  | { kind: 'scanning'; handleId: string; fromCache: boolean }
  | { kind: 'ready'; handleId: string; sourceFingerprint: string; archives: number }
  | { kind: 'failed'; reason: string; retryable: boolean };

export type ImportEvent =
  | { kind: 'capabilities'; results: CapabilityResult[] }
  /** Ergebnis der Handle-Wiederherstellung aus IndexedDB. */
  | { kind: 'stored-handle'; handleId: string | null }
  /** Antwort auf die Berechtigungsabfrage. */
  | { kind: 'permission'; granted: boolean }
  /** Nutzer hat ein Verzeichnis gewählt. */
  | { kind: 'directory-chosen'; handleId: string }
  | { kind: 'scan-started'; fromCache: boolean }
  | { kind: 'scan-done'; sourceFingerprint: string; archives: number }
  | { kind: 'error'; reason: string; retryable?: boolean | undefined }
  /** Nutzer will neu beginnen. */
  | { kind: 'reset' };

export const INITIAL_IMPORT_STATE: ImportState = { kind: 'start' };

/**
 * Ein Übergang. Unbekannte Kombinationen ändern **nichts** — die Maschine
 * verschluckt Ereignisse lieber, als in einen ausgedachten Zustand zu fallen.
 */
export function importTransition(state: ImportState, event: ImportEvent): ImportState {
  if (event.kind === 'reset') return { kind: 'start' };
  if (event.kind === 'error') {
    return { kind: 'failed', reason: event.reason, retryable: event.retryable ?? true };
  }

  switch (state.kind) {
    case 'start':
      if (event.kind === 'capabilities') {
        const missing = missingCapabilities(event.results);
        return missing.length > 0 ? { kind: 'unsupported', missing } : { kind: 'awaiting-directory' };
      }
      return state;

    case 'awaiting-directory':
      if (event.kind === 'stored-handle') {
        // Ein gespeicherter Handle überspringt die Verzeichniswahl, aber nicht
        // die Berechtigungsfrage.
        return event.handleId ? { kind: 'awaiting-regrant', handleId: event.handleId } : state;
      }
      if (event.kind === 'directory-chosen') {
        return { kind: 'scanning', handleId: event.handleId, fromCache: false };
      }
      return state;

    case 'awaiting-regrant':
      if (event.kind === 'permission') {
        return event.granted
          ? { kind: 'scanning', handleId: state.handleId, fromCache: true }
          : // Verweigert: zurück zur Wahl. Der Handle bleibt gespeichert, der
            // Nutzer kann es später erneut versuchen.
            { kind: 'awaiting-directory' };
      }
      if (event.kind === 'directory-chosen') {
        return { kind: 'scanning', handleId: event.handleId, fromCache: false };
      }
      return state;

    case 'scanning':
      if (event.kind === 'scan-started') {
        return { kind: 'scanning', handleId: state.handleId, fromCache: event.fromCache };
      }
      if (event.kind === 'scan-done') {
        return {
          kind: 'ready',
          handleId: state.handleId,
          sourceFingerprint: event.sourceFingerprint,
          archives: event.archives,
        };
      }
      return state;

    case 'ready':
      if (event.kind === 'directory-chosen') {
        return { kind: 'scanning', handleId: event.handleId, fromCache: false };
      }
      return state;

    case 'unsupported':
    case 'failed':
      // Aus diesen Zuständen führt nur ein bewusster Neustart heraus.
      return state;
  }
}

/** Was der Nutzer als Nächstes tun muss — die einzige Textquelle der Schale. */
export function importHint(state: ImportState): string {
  switch (state.kind) {
    case 'start':
      return 'Fähigkeiten werden geprüft …';
    case 'unsupported':
      return `Dieser Browser kann WebMidgar nicht ausführen:\n${state.missing.map((m) => `• ${m.message}`).join('\n')}`;
    case 'awaiting-directory':
      return 'Bitte das Installationsverzeichnis wählen. Die Daten bleiben auf diesem Gerät.';
    case 'awaiting-regrant':
      return 'Das zuletzt genutzte Verzeichnis ist bekannt. Ein Klick genügt, um den Zugriff erneut zu erlauben.';
    case 'scanning':
      return state.fromCache ? 'Index wird aus dem Zwischenspeicher geladen …' : 'Archive werden eingelesen …';
    case 'ready':
      return `Bereit — ${state.archives} Archive.`;
    case 'failed':
      return state.retryable ? `Fehlgeschlagen: ${state.reason}. Erneut versuchen?` : `Fehlgeschlagen: ${state.reason}`;
  }
}
