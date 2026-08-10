/**
 * StatusBar (28px) — Autosave-Status, aktiver Dokumentpfad (Mono),
 * engineCompat-Chip, Crash-Journal-Indikator, Encoding (design.md 5.3).
 */
import { useLocation } from 'react-router-dom';
import { Shield, ShieldAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { demoProject } from '@/lib/mock-project';
import { cn } from '@/lib/utils';

/** Route → repräsentativer aktiver Dokumentpfad (Mono, StatusBar-Mitte). */
const DOKUMENT_PFADE: Record<string, string> = {
  '/': 'mod:de.beispiel.nebenquest',
  '/dialoge': 'mod:de.beispiel.nebenquest/dialogues/md1_1/de',
  '/quests': 'mod:de.beispiel.nebenquest/scripts/lina.interaktion',
  '/charaktere': 'mod:de.beispiel.nebenquest/characters/lina',
  '/felder': 'mod:de.beispiel.nebenquest/fields/slumkirche_aussen',
  '/paket': 'mod:de.beispiel.nebenquest/manifest',
};

export default function StatusBar() {
  const { pathname } = useLocation();
  const pfad = DOKUMENT_PFADE[pathname] ?? DOKUMENT_PFADE['/'];
  const journalOffen = true; // Mock: offener Wiederherstellungsstand

  return (
    <footer className="flex h-7 items-center gap-3 border-t border-subtle bg-panel px-3 text-[11px]">
      {/* Autosave-Status */}
      <span className="flex items-center gap-1.5 text-secondary">
        <span className="h-1.5 w-1.5 animate-mako-pulse rounded-full bg-mako" />
        Gespeichert · vor 12 s
        <span className="text-muted">(IndexedDB)</span>
      </span>

      {/* Mitte: aktiver Dokumentpfad */}
      <span className="mx-auto truncate font-mono text-muted">{pfad}</span>

      {/* Rechts: engineCompat, Crash-Journal, Encoding */}
      <span className="flex items-center gap-3">
        <span className="rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[10px] text-secondary">
          engine ≥ 0.4.0
        </span>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'flex items-center gap-1',
                  journalOffen ? 'text-warn' : 'text-mako',
                )}
              >
                {journalOffen ? <ShieldAlert className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{journalOffen ? 'Wiederherstellung offen' : 'Journal sauber'}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {journalOffen
                ? 'Crash-Journal enthält einen ungespeicherten Stand (siehe Projekt-Start).'
                : 'Crash-Journal ist sauber.'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="font-mono text-[10px] text-muted">UTF-8</span>
        <span className="hidden font-mono text-[10px] text-muted md:inline">v{demoProject.version}</span>
      </span>
    </footer>
  );
}
