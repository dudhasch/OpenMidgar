/**
 * CommandPalette — ⌘K-Modal auf cmdk-Basis (design.md 5.6):
 * Fuzzy-Suche über Dokumente, Aktionen und Sprungziele.
 * Global geöffnet via ⌘K / Strg+K oder TopBar-Trigger.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Hammer,
  Home,
  Map,
  MessageSquare,
  Package,
  Play,
  Plus,
  SlidersHorizontal,
  UserRound,
  Workflow,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { demoDokumente } from '@/lib/mock-project';
import { useAppState } from '@/lib/app-state';
import { useUiModus } from '@/lib/ui-modus';

const SPRUNGZIELE = [
  { route: '/', label: 'Projekt-Start', icon: Home },
  { route: '/dialoge', label: 'Dialog-Editor', icon: MessageSquare },
  { route: '/quests', label: 'Quest-/Script-Editor', icon: Workflow },
  { route: '/charaktere', label: 'Charakter-Editor', icon: UserRound },
  { route: '/felder', label: 'Field-Editor', icon: Map },
  { route: '/paket', label: 'Paket / Publish', icon: Package },
];

export default function CommandPalette() {
  const { paletteOffen, setPaletteOffen, pruefeErneut, oeffneProjekt } = useAppState();
  const { modus, toggleModus } = useUiModus();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOffen(!paletteOffen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOffen, setPaletteOffen]);

  const springe = (route: string) => {
    oeffneProjekt();
    navigate(route);
    setPaletteOffen(false);
  };

  return (
    <CommandDialog open={paletteOffen} onOpenChange={setPaletteOffen}>
      <CommandInput placeholder="Dokument, Aktion oder Sprungziel suchen …" />
      <CommandList>
        <CommandEmpty>Nichts gefunden — Begriff prüfen.</CommandEmpty>
        <CommandGroup heading="Aktionen">
          <CommandItem onSelect={() => springe('/dialoge')}>
            <Plus className="mr-2 h-4 w-4 text-mako" />
            Neuer Dialog
            <span className="ml-auto font-mono text-[10px] text-muted">dialogues/</span>
          </CommandItem>
          <CommandItem onSelect={() => springe('/quests')}>
            <Plus className="mr-2 h-4 w-4 text-mako" />
            Neuer Script-Graph
            <span className="ml-auto font-mono text-[10px] text-muted">scripts/</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              pruefeErneut();
              setPaletteOffen(false);
            }}
          >
            <Play className="mr-2 h-4 w-4 text-secondary" />
            Validieren
          </CommandItem>
          <CommandItem onSelect={() => springe('/paket')}>
            <Hammer className="mr-2 h-4 w-4 text-secondary" />
            Kompilieren
            <span className="ml-auto font-mono text-[10px] text-muted">.wmmod</span>
          </CommandItem>
          {/* MS17 (vereinfachung.md §1.3): Modus-Umschalter auch in der Palette. */}
          <CommandItem
            value="Ansicht Einfach Profi umschalten Modus"
            onSelect={() => {
              toggleModus();
              setPaletteOffen(false);
            }}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4 text-secondary" />
            Ansicht: Einfach/Profi umschalten
            <span className="ml-auto font-mono text-[10px] text-muted">{modus === 'einfach' ? 'Einfach' : 'Profi'} · ⌘⇧P</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Dokumente">
          {demoDokumente.flatMap((gruppe) =>
            gruppe.eintraege.map((d) => (
              <CommandItem key={d.pfad} value={`${d.name} ${d.pfad}`} onSelect={() => springe(d.route)}>
                <FileText className="mr-2 h-4 w-4 text-secondary" />
                {d.name}
                <span className="ml-auto truncate font-mono text-[10px] text-muted">{d.pfad}</span>
              </CommandItem>
            )),
          )}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Sprungziele">
          {SPRUNGZIELE.map((z) => (
            <CommandItem key={z.route} onSelect={() => springe(z.route)}>
              <z.icon className="mr-2 h-4 w-4 text-secondary" />
              {z.label}
              <span className="ml-auto font-mono text-[10px] text-muted">#{z.route}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
