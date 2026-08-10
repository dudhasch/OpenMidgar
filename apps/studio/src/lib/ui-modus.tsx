/**
 * UiModusContext — Einfach/Profi-Modus-System (MS17, vereinfachung.md §1).
 *
 * - Zwei Modi: 'einfach' (Default) und 'profi'. Profi zeigt die bisherige UI
 *   exakt unverändert; Einfach blendet `data-profi`-Elemente nur per CSS aus.
 * - Persistiert projektübergreifend in localStorage (`studio.ui.mode`).
 * - Der Modus hängt als `data-ui-mode`-Attribut am <html>-Element — ein
 *   Umschalten erfordert kein Re-Render der Panel-Logik, Disclosure-States
 *   bleiben erhalten (siehe index.css + shared/ProfiDisclosure.tsx).
 * - Tastatur: ⌘⇧P / Strg+Umschalt+P toggelt den Modus global.
 *
 * ---------------------------------------------------------------------------
 * AUDIT-NOTIZ „Kein Feature-Verlust" (vereinfachung.md §6):
 * Kernaktionen, die im EINFACH-Modus je Ansicht sichtbar/bleiben
 * (alles andere ist per „Profi-Optionen"-Disclosure oder TopBar-Umschalter
 * in ≤ 1 Klick erreichbar — nichts wurde entfernt):
 *
 * - TopBar (global): Validieren, Kompilieren, ⌘K-Palette, Projekt-Menü,
 *   Befund-Pills, Einfach/Profi-Umschalter selbst.
 * - Home: Neues Projekt / Projekt öffnen / Demo laden, Schnellaktions-Leiste
 *   (5 Wizard-Einstiege + Paket-Karte), Projekt-Übersicht, Schnellzugriff.
 * - Dialoge: Dokument anlegen (Wizard), Eintrag anlegen (Primär-CTA),
 *   Ersetzen→Delta-Flow, Seiten-Editor + Toolbar, FF7-Vorschau,
 *   Sprach-Wechsel, Sortieren, Duplizieren/Löschen (MoreHorizontal).
 *   Profi: guardHash-Detailzeilen im Referenz-Block (Disclosure).
 * - Quests: Knoten hinzufügen (Palette, Drag/Doppelklick), Graph/Quest-Sicht,
 *   Script-Eigenschaften, Slot-Matrix, Operanden-Formular (typisiert),
 *   Variablen anlegen/Quick-Fix, Löschen/Duplizieren, Vorlagen.
 *   Profi: Operanden-Rohform + Knoten-ID-Zeile (Disclosure).
 * - Charaktere: NPC anlegen (Wizard), Auftritt hinzufügen (Primär-CTA),
 *   Platzierung ziehen, Inspektor-Formulare, Löschen (Menü).
 * - Felder: Field anlegen (Wizard; Profi: Popover mit ID-Picker),
 *   Walkmesh-Werkzeuge (Dreieck/Trigger/Gateway/Kamera/Löschen),
 *   Delta-Operationen inkl. „Neu verankern", Kamerapose, Hintergrundbild.
 *   Profi: guardHash-/Anker-Rohzeilen in der Delta-Karte (Disclosure).
 * - Gegner: Gegner anlegen (Wizard; Profi: „Leer anlegen"),
 *   Tab-Primär-CTAs (Angriff/Regel/Beute hinzufügen), alle Tab-Formulare,
 *   Duplizieren/Löschen (MoreHorizontal).
 *   Profi: Mono-Rohwerte (Σ-Zeile), Gewicht-Stepper, Bedingungs-Referenz-
 *   Tabelle (Disclosure „Gewichte & Tiebreak" bzw. Panel-Fuß).
 * - Schlacht: Schlacht anlegen (Wizard), Probekampf starten (Primär-CTA),
 *   Formation-Drag, Regeln/Belohnung/Verknüpfung, Timeline-Steuerung.
 *   Profi: Flucht-Bedingung, Formation-Rohwerte (maxGleichzeitig),
 *   Party-Annahme-Inputs (Disclosure „Rohwerte").
 * - Paket: Manifest-Formular, Validieren, Kompilieren (Primär-CTA),
 *   Download, Befundliste, Audit-Tabelle, Provenienz, Testimport (gesperrt).
 *   Profi: SHA-256-Spalte, Doppellauf-Digest-Details (Disclosure).
 * - Befund-Dock: Klasse-Punkt, Dokument (klickbar), Meldung, Fix-Hint,
 *   Filter-Tabs, „Erneut prüfen".
 *   Profi: Pfad-Spalte, Quellen-Dropdown (Disclosure „Technikspalten").
 * ---------------------------------------------------------------------------
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

export type UiModus = 'einfach' | 'profi';

const STORAGE_KEY = 'studio.ui.mode';

interface UiModusState {
  modus: UiModus;
  setModus: (m: UiModus) => void;
  toggleModus: () => void;
  istEinfach: boolean;
}

const UiModusContext = createContext<UiModusState | null>(null);

function initialModus(): UiModus {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'profi' ? 'profi' : 'einfach';
  } catch {
    return 'einfach';
  }
}

export function UiModusProvider({ children }: { children: ReactNode }) {
  const [modus, setModusState] = useState<UiModus>(initialModus);

  /* Attribut am App-Root (<html>) — CSS-Regel in index.css übernimmt den Rest. */
  useEffect(() => {
    document.documentElement.dataset.uiMode = modus;
    try {
      window.localStorage.setItem(STORAGE_KEY, modus);
    } catch {
      /* localStorage nicht verfügbar — Modus bleibt Sitzungszustand. */
    }
  }, [modus]);

  const setModus = useCallback((m: UiModus) => {
    setModusState((alt) => {
      if (m !== alt && m === 'einfach') {
        toast('Vereinfachte Ansicht aktiv', {
          description: 'Alle Profi-Details bleiben über „Profi-Optionen" erreichbar.',
          duration: 3000,
        });
      }
      return m;
    });
  }, []);

  const toggleModus = useCallback(() => {
    setModusState((alt) => {
      const neu = alt === 'einfach' ? 'profi' : 'einfach';
      if (neu === 'einfach') {
        toast('Vereinfachte Ansicht aktiv', {
          description: 'Alle Profi-Details bleiben über „Profi-Optionen" erreichbar.',
          duration: 3000,
        });
      }
      return neu;
    });
  }, []);

  /* Global: ⌘⇧P / Strg+Umschalt+P toggelt den Modus. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        toggleModus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleModus]);

  const value = useMemo<UiModusState>(
    () => ({ modus, setModus, toggleModus, istEinfach: modus === 'einfach' }),
    [modus, setModus, toggleModus],
  );

  return <UiModusContext.Provider value={value}>{children}</UiModusContext.Provider>;
}

export function useUiModus(): UiModusState {
  const ctx = useContext(UiModusContext);
  if (!ctx) throw new Error('useUiModus muss innerhalb von UiModusProvider verwendet werden');
  return ctx;
}
