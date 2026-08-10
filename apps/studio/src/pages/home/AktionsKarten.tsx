/**
 * Aktionskarten (home.md Sektion 2, Zustand: kein Projekt offen).
 * Drei Karten: Neues Projekt (Dialog), Projekt öffnen (Sheet mit Liste +
 * Dropzone), Demo-Projekt laden. Stagger-Eintritt, Hover mit Mako-Glow.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, FolderPlus, Sparkles, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import NeuesProjektDialog from '@/pages/home/NeuesProjektDialog';
import { demoLetzteProjekte } from '@/lib/mock-project';
import { useAppState } from '@/lib/app-state';

interface Karte {
  titel: string;
  beschreibung: string;
  icon: LucideIcon;
  aktion: 'neu' | 'oeffnen' | 'demo';
}

const KARTEN: Karte[] = [
  {
    titel: 'Neues Projekt',
    beschreibung: 'Leere Mod anlegen: modId, Sprachen, engineCompat. In unter einer Minute startklar.',
    icon: FolderPlus,
    aktion: 'neu',
  },
  {
    titel: 'Projekt öffnen',
    beschreibung: 'Bestehendes Projekt aus dem lokalen Speicher laden oder eine Projektdatei importieren.',
    icon: FolderOpen,
    aktion: 'oeffnen',
  },
  {
    titel: 'Demo-Projekt laden',
    beschreibung: '„Midgar-Nebenquest": NPC Lina, zwei Dialoge, ein Script-Graph, ein neues Field. Alles zum Anfassen.',
    icon: Sparkles,
    aktion: 'demo',
  },
];

export default function AktionsKarten() {
  const [dialogOffen, setDialogOffen] = useState(false);
  const [sheetOffen, setSheetOffen] = useState(false);
  const { oeffneProjekt } = useAppState();

  const klick = (aktion: Karte['aktion']) => {
    if (aktion === 'neu') setDialogOffen(true);
    else if (aktion === 'oeffnen') setSheetOffen(true);
    else {
      oeffneProjekt();
      toast.success('Demo-Projekt geladen', { description: '„Midgar-Nebenquest" — Übersicht geöffnet.' });
    }
  };

  return (
    <section aria-label="Aktionen">
      <div className="grid gap-4 sm:grid-cols-3">
        {KARTEN.map((karte, i) => (
          <motion.button
            key={karte.titel}
            type="button"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.22, delay: 0.15 + i * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => klick(karte.aktion)}
            className="group rounded-lg border border-subtle bg-panel p-5 text-left transition-colors duration-150 hover:border-strong"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-elevated transition-shadow duration-150 group-hover:shadow-[0_0_16px_rgba(61,220,151,.15)]">
              <karte.icon className="h-5 w-5 text-mako" />
            </span>
            <h3 className="mt-3 font-display text-[15px] font-semibold">{karte.titel}</h3>
            <p className="mt-1 line-clamp-2 text-[13px] text-secondary">{karte.beschreibung}</p>
          </motion.button>
        ))}
      </div>

      <NeuesProjektDialog
        offen={dialogOffen}
        onOpenChange={setDialogOffen}
        onAnlegen={(name, modId) => {
          setDialogOffen(false);
          oeffneProjekt();
          toast.success('Projekt angelegt', { description: `„${name}" · ${modId} · engineCompat ≥ 0.4.0` });
        }}
      />

      <Sheet open={sheetOffen} onOpenChange={setSheetOffen}>
        <SheetContent className="border-subtle bg-popover">
          <SheetHeader>
            <SheetTitle className="font-display">Projekt öffnen</SheetTitle>
            <SheetDescription className="text-secondary">
              Aus dem lokalen Speicher laden oder eine Projektdatei importieren.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-2">
            {demoLetzteProjekte.map((p) => (
              <button
                key={p.modId}
                type="button"
                onClick={() => {
                  setSheetOffen(false);
                  oeffneProjekt();
                  toast.success(`Projekt „${p.name}" geöffnet.`);
                }}
                className="flex items-center justify-between rounded-md border border-subtle bg-panel px-3 py-2.5 text-left transition-colors duration-150 hover:border-strong hover:bg-elevated"
              >
                <span>
                  <span className="block text-[13px] font-medium">{p.name}</span>
                  <span className="block font-mono text-[11px] text-engine">{p.modId}</span>
                </span>
                <span className="text-[11px] text-muted">{p.zuletztGeoeffnet}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => toast('Datei-Import folgt mit dem Projektspeicher (IndexedDB).')}
            className="mt-4 flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-strong bg-inset px-4 py-8 text-secondary transition-colors duration-150 hover:border-mako hover:text-foreground"
          >
            <Upload className="h-5 w-5" />
            <span className="text-[13px]">Projektdatei hierher ziehen oder auswählen</span>
            <span className="font-mono text-[10px] text-muted">.wmproj / .zip</span>
          </button>
        </SheetContent>
      </Sheet>
    </section>
  );
}
