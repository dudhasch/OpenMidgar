/**
 * Letzte Projekte (home.md Sektion 3) — Karten-Grid mit Thumbnails,
 * Hover-Aktionsleiste (Öffnen / Duplizieren / Löschen), Demo-Badge,
 * Befund-Chips-Mini, AnimatePresence beim Entfernen.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { demoLetzteProjekte } from '@/lib/mock-project';
import type { RecentProject } from '@/lib/mock-project';
import { useAppState } from '@/lib/app-state';

function ChipMini({ farbe, wert }: { farbe: string; wert: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${farbe}`} />
      <span className="font-mono text-[10px] text-muted">{wert}</span>
    </span>
  );
}

export default function LetzteProjekte() {
  const [projekte, setProjekte] = useState<RecentProject[]>(demoLetzteProjekte);
  const [loeschKandidat, setLoeschKandidat] = useState<RecentProject | null>(null);
  const { oeffneProjekt } = useAppState();

  const oeffnen = (p: RecentProject) => {
    oeffneProjekt();
    toast.success(`Projekt „${p.name}" geöffnet.`);
  };

  return (
    <section aria-label="Zuletzt geöffnet">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold tracking-tight">Zuletzt geöffnet</h2>
        <button
          type="button"
          onClick={() => toast('Projektverwaltung folgt mit dem Projektspeicher.')}
          className="text-[13px] text-engine transition-colors duration-150 hover:underline"
        >
          Alle Projekte
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence>
          {projekte.map((p, i) => (
            <motion.article
              key={p.modId}
              layout
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
              transition={{ duration: 0.22, delay: 0.2 + i * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
              className="group cursor-pointer overflow-hidden rounded-lg border border-subtle bg-panel transition-colors duration-150 hover:border-strong"
              onClick={() => oeffnen(p)}
              onKeyDown={(e) => e.key === 'Enter' && oeffnen(p)}
              tabIndex={0}
              aria-label={`Projekt ${p.name} öffnen`}
            >
              {/* Thumbnail + Hover-Aktionsleiste */}
              <div className="relative aspect-video overflow-hidden bg-inset">
                <img
                  src={p.thumbnail}
                  alt=""
                  className="h-full w-full object-cover transition-transform [transition-duration:400ms] ease-out group-hover:scale-[1.04]"
                />
                {p.demo && (
                  <span className="absolute left-2 top-2 rounded bg-mako px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    Demo
                  </span>
                )}
                <div
                  className="absolute inset-x-0 bottom-0 flex translate-y-2 items-center justify-center gap-1.5 bg-app/85 py-1.5 opacity-0 backdrop-blur transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Sekundär (MS17 §4): Home-Primär-CTA ist „Neues Projekt". */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 border border-subtle px-2 text-[11px] text-secondary hover:bg-elevated hover:text-foreground"
                    onClick={() => oeffnen(p)}
                  >
                    Öffnen
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-secondary hover:text-foreground"
                    aria-label="Duplizieren"
                    onClick={() => toast.success(`„${p.name}" dupliziert (Mock).`)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-secondary hover:text-error"
                    aria-label="Löschen"
                    onClick={() => setLoeschKandidat(p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Meta */}
              <div className="p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-[15px] font-semibold">{p.name}</h3>
                  <span className="flex shrink-0 gap-2">
                    <ChipMini farbe="bg-error" wert={p.befundChips.fehler} />
                    <ChipMini farbe="bg-warn" wert={p.befundChips.warnung} />
                    <ChipMini farbe="bg-info" wert={p.befundChips.info} />
                  </span>
                </div>
                <p className="font-mono text-[11px] text-engine">{p.modId}</p>
                <p className="mt-1 text-[11px] text-muted">
                  Zuletzt geöffnet: {p.zuletztGeoeffnet} · {p.dokumente} Dokumente
                </p>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>

      <AlertDialog open={loeschKandidat !== null} onOpenChange={(o) => !o && setLoeschKandidat(null)}>
        <AlertDialogContent className="border-subtle bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle>Projekt „{loeschKandidat?.name}" löschen?</AlertDialogTitle>
            <AlertDialogDescription className="text-secondary">
              Das Projekt wird aus dem lokalen Speicher entfernt. Exportierte Pakete bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-subtle bg-transparent">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-error text-destructive-foreground hover:bg-error/90"
              onClick={() => {
                if (loeschKandidat) {
                  setProjekte((liste) => liste.filter((x) => x.modId !== loeschKandidat.modId));
                  toast(`„${loeschKandidat.name}" gelöscht.`);
                }
                setLoeschKandidat(null);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
