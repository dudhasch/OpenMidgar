/**
 * TopBar (48px) — Logo + Wortmarke, Projektname + Autosave-Punkt,
 * Befund-Pills (Fehler/Warnung/Info), Aktionen Validieren/Kompilieren,
 * ⌘K-Trigger und Projekt-Menü (design.md 5.1).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronDown, Copy, Download, Hammer, Pencil, Play, Search, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { befundCounts, demoProject } from '@/lib/mock-project';
import { useAppState } from '@/lib/app-state';
import type { DockFilter } from '@/lib/app-state';
import { useUiModus } from '@/lib/ui-modus';
import type { UiModus } from '@/lib/ui-modus';
import { cn } from '@/lib/utils';

const MODI: { id: UiModus; label: string }[] = [
  { id: 'einfach', label: 'Einfach' },
  { id: 'profi', label: 'Profi' },
];

const PILLS: { filter: DockFilter; label: string; klasse: 'fehler' | 'warnung' | 'info'; farbe: string }[] = [
  { filter: 'fehler', label: 'Fehler', klasse: 'fehler', farbe: 'bg-error' },
  { filter: 'warnung', label: 'Warnungen', klasse: 'warnung', farbe: 'bg-warn' },
  { filter: 'info', label: 'Info', klasse: 'info', farbe: 'bg-info' },
];

export default function TopBar() {
  const { projektOffen, toggleDock, dockFilter, pruefeErneut, setPaletteOffen, schliesseProjekt } = useAppState();
  const { modus, setModus } = useUiModus();
  const navigate = useNavigate();
  const counts = befundCounts();
  const [kompiliert, setKompiliert] = useState(false);

  const kompilieren = () => {
    pruefeErneut();
    setKompiliert(true);
    toast.success('Kompilierung erfolgreich', {
      description: 'Paket „midgar-nebenquest.wmmod" aktualisiert — Manifest v2.',
    });
    window.setTimeout(() => setKompiliert(false), 1600);
  };

  return (
    <header className="flex h-12 items-center gap-3 border-b border-subtle bg-panel px-3">
      {/* Logo + Wortmarke */}
      <button
        type="button"
        onClick={() => navigate('/')}
        className="flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors duration-150 hover:bg-elevated"
        aria-label="Zum Projekt-Start"
      >
        <img src="./logo-mark.svg" alt="" className="h-6 w-6" />
        <span className="font-display text-[15px] font-semibold tracking-tight">
          WebMidgar <span className="text-mako">Studio</span>
        </span>
      </button>

      {/* Projektname + Autosave-Punkt */}
      {projektOffen && (
        <div className="flex items-center gap-2 border-l border-subtle pl-3">
          <span className="font-mono text-xs text-secondary">{demoProject.name}</span>
          <span className="h-1.5 w-1.5 animate-mako-pulse rounded-full bg-mako" title="Autosave aktiv" />
        </div>
      )}

      {/* Mitte: Befund-Pills */}
      <div className="mx-auto flex items-center gap-1.5">
        <TooltipProvider delayDuration={150}>
          {PILLS.map((pill) => (
            <Tooltip key={pill.filter}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => toggleDock(pill.filter)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors duration-150',
                    dockFilter === pill.filter
                      ? 'border-strong bg-elevated text-foreground'
                      : 'border-transparent text-secondary hover:bg-elevated hover:text-foreground',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', pill.farbe)} />
                  {pill.label}
                  <span className="rounded bg-inset px-1 font-mono text-[10px] text-secondary">
                    {counts[pill.klasse]}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Befund-Dock: {pill.label}</TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>

      {/* Rechts: Aktionen */}
      <div className="flex items-center gap-1.5">
        {/* Einfach/Profi-Umschalter (MS17, vereinfachung.md §1.3):
            Segment-Control vor „Validieren", aktiv = Mako-Dim-Pill (layoutId). */}
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="radiogroup"
                aria-label="Ansichtsmodus"
                className="flex h-9 items-center gap-0.5 rounded-md bg-elevated px-1"
              >
                <SlidersHorizontal className="mr-1 h-4 w-4 text-muted" aria-hidden />
                {MODI.map((m) => {
                  const aktiv = modus === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={aktiv}
                      onClick={() => setModus(m.id)}
                      className={cn(
                        'relative rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                        aktiv ? 'text-mako' : 'text-secondary hover:text-foreground',
                      )}
                    >
                      {aktiv && (
                        <motion.span
                          layoutId="mode-pill"
                          className="absolute inset-0 rounded bg-mako-dim"
                          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        />
                      )}
                      <span className="relative">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 text-xs">
              Ansicht wechseln — Profi zeigt alle technischen Details. Nichts geht verloren.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-secondary hover:text-foreground"
          onClick={() => {
            pruefeErneut();
            toast.info('Validierung gestartet', { description: 'Inkrementelle Prüfung aller geänderten Dokumente.' });
          }}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          Validieren
        </Button>
        <Button
          size="sm"
          onClick={kompilieren}
          className={cn(
            'h-7 bg-mako text-xs font-semibold text-primary-foreground transition-all duration-150 hover:bg-mako-hover',
            kompiliert && 'shadow-mako-glow',
          )}
        >
          <Hammer className="mr-1.5 h-3.5 w-3.5" />
          Kompilieren
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-2 text-xs text-secondary hover:text-foreground"
          onClick={() => setPaletteOffen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          <Kbd>⌘K</Kbd>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-secondary hover:text-foreground">
              Projekt
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 border-subtle bg-popover">
            <DropdownMenuItem className="text-xs" onClick={() => toast('Umbenennen folgt mit dem Projektspeicher.')}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Umbenennen
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={() => toast.success('Projekt dupliziert (Mock).')}>
              <Copy className="mr-2 h-3.5 w-3.5" /> Duplizieren
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={() => toast('Export folgt mit dem Paket-Editor.')}>
              <Download className="mr-2 h-3.5 w-3.5" /> Exportieren
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-subtle" />
            <DropdownMenuItem
              className="text-xs text-error focus:text-error"
              onClick={() => {
                schliesseProjekt();
                navigate('/');
                toast('Projekt geschlossen.');
              }}
            >
              <X className="mr-2 h-3.5 w-3.5" /> Schließen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
