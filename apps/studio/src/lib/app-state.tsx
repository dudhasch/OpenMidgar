/**
 * Globaler UI-Zustand der Studio-Shell (Mock-Ebene).
 * Hält Projekt-offen-Status, Befund-Dock-Sichtbarkeit/Filter,
 * Autosave-Status und die Command-Palette. Page-Agenten können diesen
 * Store später durch echten studio-core-Zugriff ersetzen — die Komponenten
 * bleiben gleich.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BefundKlasse } from '@webmidgar/studio-core';
import type { SaveStatus } from '@/lib/mock-project';

export type DockFilter = 'alle' | BefundKlasse;

interface AppState {
  projektOffen: boolean;
  oeffneProjekt: () => void;
  schliesseProjekt: () => void;

  dockOffen: boolean;
  setDockOffen: (offen: boolean) => void;
  toggleDock: (filter?: DockFilter) => void;
  dockFilter: DockFilter;
  setDockFilter: (f: DockFilter) => void;

  validierungLaeuft: boolean;
  pruefeErneut: () => void;

  saveStatus: SaveStatus;
  paletteOffen: boolean;
  setPaletteOffen: (offen: boolean) => void;
}

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [projektOffen, setProjektOffen] = useState(false);
  const [dockOffen, setDockOffen] = useState(false);
  const [dockFilter, setDockFilter] = useState<DockFilter>('alle');
  const [validierungLaeuft, setValidierungLaeuft] = useState(false);
  const [paletteOffen, setPaletteOffen] = useState(false);
  const [saveStatus] = useState<SaveStatus>('gespeichert');

  const toggleDock = useCallback((filter?: DockFilter) => {
    if (filter) setDockFilter(filter);
    setDockOffen((v) => (filter ? true : !v));
  }, []);

  const pruefeErneut = useCallback(() => {
    setValidierungLaeuft(true);
    window.setTimeout(() => setValidierungLaeuft(false), 1400);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      projektOffen,
      oeffneProjekt: () => setProjektOffen(true),
      schliesseProjekt: () => setProjektOffen(false),
      dockOffen,
      setDockOffen,
      toggleDock,
      dockFilter,
      setDockFilter,
      validierungLaeuft,
      pruefeErneut,
      saveStatus,
      paletteOffen,
      setPaletteOffen,
    }),
    [projektOffen, dockOffen, toggleDock, dockFilter, validierungLaeuft, pruefeErneut, saveStatus, paletteOffen],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState muss innerhalb von AppStateProvider verwendet werden');
  return ctx;
}
