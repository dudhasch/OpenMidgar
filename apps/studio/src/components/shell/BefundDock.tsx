/**
 * BefundDock — zentrales UX-Motiv (design.md 5.4).
 * Unten angedockt (180px, per Drag-Handle bis 320px, einklappbar auf 32px),
 * Filter-Tabs mit Zählern, Quellen-Dropdown, „Erneut prüfen",
 * Tabelle Klasse · Dokument · Pfad · Meldung · Fix-Hint.
 * Zeilen-Klick navigiert zum zuständigen Editor. Niemals blockierend.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import { demoBefunde } from '@/lib/mock-project';
import type { StudioBefund } from '@/lib/mock-project';
import { useAppState } from '@/lib/app-state';
import type { DockFilter } from '@/lib/app-state';
import { cn } from '@/lib/utils';

const KLASSE_FARBE: Record<StudioBefund['klasse'], string> = {
  fehler: 'bg-error',
  warnung: 'bg-warn',
  info: 'bg-info',
};

const TABS: { filter: DockFilter; label: string }[] = [
  { filter: 'alle', label: 'Alle' },
  { filter: 'fehler', label: 'Fehler' },
  { filter: 'warnung', label: 'Warnungen' },
  { filter: 'info', label: 'Info' },
];

export default function BefundDock() {
  const { dockOffen, setDockOffen, dockFilter, setDockFilter, validierungLaeuft, pruefeErneut } = useAppState();
  const navigate = useNavigate();
  const [quelle, setQuelle] = useState<'alle' | 'validierung' | 'kompilierung'>('alle');
  const [hoehe, setHoehe] = useState(180);
  /* Lokale Profi-Disclosure „Technikspalten" (MS17, vereinfachung.md §1.5):
     gestreute data-profi-Elemente (Pfad-Spalte, Quellen-Dropdown) — der
     Container trägt data-profi-offen, solange die Disclosure offen ist. */
  const [technikOffen, setTechnikOffen] = useState(false);
  const dragStart = useRef<{ y: number; h: number } | null>(null);

  const gefiltert = demoBefunde.filter(
    (b) => (dockFilter === 'alle' || b.klasse === dockFilter) && (quelle === 'alle' || b.quelle === quelle),
  );
  const zaehler = (f: DockFilter) => (f === 'alle' ? demoBefunde.length : demoBefunde.filter((b) => b.klasse === f).length);

  const onDragStart = (e: React.PointerEvent) => {
    dragStart.current = { y: e.clientY, h: hoehe };
    const onMove = (ev: PointerEvent) => {
      if (!dragStart.current) return;
      const naechste = dragStart.current.h + (dragStart.current.y - ev.clientY);
      setHoehe(Math.min(320, Math.max(120, naechste)));
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <motion.section
      className="flex shrink-0 flex-col border-t border-subtle bg-panel"
      {...(technikOffen ? { 'data-profi-offen': '' } : {})}
      initial={false}
      animate={{ height: dockOffen ? hoehe : 32 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      aria-label="Befund-Dock"
    >
      {/* Drag-Handle */}
      {dockOffen && (
        <div
          className="h-1 w-full shrink-0 cursor-row-resize transition-colors duration-150 hover:bg-mako/50"
          onPointerDown={onDragStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Dock-Höhe anpassen"
        />
      )}

      {/* Kopfzeile */}
      <div className="relative flex h-8 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => setDockOffen(!dockOffen)}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground transition-colors duration-150 hover:text-mako"
        >
          {dockOffen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          Befunde
        </button>

        {dockOffen && (
          <>
            <div className="flex items-center gap-0.5">
              {TABS.map((tab) => (
                <button
                  key={tab.filter}
                  type="button"
                  onClick={() => setDockFilter(tab.filter)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11px] transition-colors duration-150',
                    dockFilter === tab.filter
                      ? 'bg-elevated text-foreground'
                      : 'text-secondary hover:bg-elevated hover:text-foreground',
                  )}
                >
                  {tab.label}
                  <span className="ml-1 font-mono text-[10px] text-muted">{zaehler(tab.filter)}</span>
                </button>
              ))}
            </div>
            {/* Quellen-Dropdown: Profi-Technikspalte (vereinfachung.md §1.5) */}
            <span data-profi>
              <Select value={quelle} onValueChange={(v) => setQuelle(v as typeof quelle)}>
                <SelectTrigger className="h-6 w-36 border-subtle bg-inset text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-subtle bg-popover">
                  <SelectItem value="alle" className="text-xs">Alle Quellen</SelectItem>
                  <SelectItem value="validierung" className="text-xs">Validierung</SelectItem>
                  <SelectItem value="kompilierung" className="text-xs">Kompilierung</SelectItem>
                </SelectContent>
              </Select>
            </span>
            <ProfiDisclosure
              panelId="befund-dock-technik"
              anzahl={2}
              titel="Technikspalten"
              offen={technikOffen}
              onToggle={setTechnikOffen}
            />
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 gap-1.5 px-2 text-[11px] text-secondary hover:text-foreground"
              onClick={pruefeErneut}
            >
              <RefreshCw className={cn('h-3 w-3', validierungLaeuft && 'animate-spin')} />
              Erneut prüfen
            </Button>
          </>
        )}

        {/* Indeterminierter Mako-Fortschrittsbalken während der Prüfung */}
        {validierungLaeuft && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-inset">
            <div className="h-full w-1/3 animate-shimmer bg-mako" />
          </div>
        )}
      </div>

      {/* Tabelle */}
      <AnimatePresence>
        {dockOffen && (
          <motion.div
            className="min-h-0 flex-1 overflow-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wider text-muted">
                <tr className="border-b border-strong">
                  <th className="w-20 px-3 py-1.5 font-medium">Klasse</th>
                  <th className="px-2 py-1.5 font-medium">Dokument</th>
                  <th className="px-2 py-1.5 font-medium" data-profi>Pfad</th>
                  <th className="px-2 py-1.5 font-medium">Meldung</th>
                  <th className="px-3 py-1.5 font-medium">Fix-Hint</th>
                </tr>
              </thead>
              <tbody>
                {gefiltert.map((b, i) => (
                  <tr
                    key={`${b.dokument}-${b.pfad}-${i}`}
                    onClick={() => navigate(b.zielRoute)}
                    className="cursor-pointer border-b border-subtle/60 transition-colors duration-150 hover:bg-elevated"
                  >
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', KLASSE_FARBE[b.klasse])} />
                        <span className="capitalize text-secondary">{b.klasse}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-engine">{b.dokument}</td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-muted" data-profi>{b.pfad}</td>
                    <td className="max-w-0 truncate px-2 py-1.5 text-foreground" title={b.meldung}>
                      {b.meldung}
                    </td>
                    <td className="max-w-0 truncate px-3 py-1.5 italic text-secondary" title={b.fixHint}>
                      {b.fixHint}
                    </td>
                  </tr>
                ))}
                {gefiltert.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-secondary">
                      Keine Befunde in dieser Ansicht — alles valide.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
