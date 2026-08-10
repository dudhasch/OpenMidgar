/**
 * RecoveryBanner — Wiederherstellungs-Banner (home.md Sektion 0).
 * Nur sichtbar, wenn das Crash-Journal einen ungespeicherten Stand enthält.
 * Eintritt verzögert (300ms nach Hero-Start), Kollaps per height-Animation.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
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
import { demoCrashJournal } from '@/lib/mock-project';
import { useAppState } from '@/lib/app-state';

export default function RecoveryBanner() {
  const [sichtbar, setSichtbar] = useState(true);
  const [dialogOffen, setDialogOffen] = useState(false);
  const { oeffneProjekt } = useAppState();

  return (
    <>
      <AnimatePresence>
        {sichtbar && (
          <motion.div
            initial={{ y: -16, opacity: 0, height: 0 }}
            animate={{ y: 0, opacity: 1, height: 'auto' }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              y: { duration: 0.25, delay: 0.3 },
              opacity: { duration: 0.25, delay: 0.3 },
              height: { duration: 0.2 },
            }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-md border border-subtle border-l-[3px] border-l-warn bg-elevated px-4 py-3">
              <AlertTriangle className="h-[18px] w-[18px] shrink-0 text-warn" />
              <p className="text-[13px] text-foreground">
                Ungespeicherter Stand vom <span className="font-mono">{demoCrashJournal.zeitpunkt}</span>{' '}
                wiederhergestellt — Projekt „{demoCrashJournal.projektName}",{' '}
                {demoCrashJournal.betroffeneDokumente} Dokumente betroffen.
              </p>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  /* Sekundär (MS17 §4): Home-Primär-CTA ist „Neues Projekt". */
                  className="h-7 border border-subtle text-xs text-secondary hover:bg-elevated hover:text-foreground"
                  onClick={() => {
                    setSichtbar(false);
                    oeffneProjekt();
                    toast.success('Stand wiederhergestellt', {
                      description: `${demoCrashJournal.betroffeneDokumente} Dokumente aus dem Crash-Journal übernommen.`,
                    });
                  }}
                >
                  Wiederherstellen
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-secondary hover:text-error"
                  onClick={() => setDialogOffen(true)}
                >
                  Verwerfen
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AlertDialog open={dialogOffen} onOpenChange={setDialogOffen}>
        <AlertDialogContent className="border-subtle bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle>Wiederherstellungsstand wirklich löschen?</AlertDialogTitle>
            <AlertDialogDescription className="text-secondary">
              Das Crash-Journal wird bereinigt. Der ungespeicherte Stand vom {demoCrashJournal.zeitpunkt} geht
              unwiderruflich verloren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-subtle bg-transparent">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-error text-destructive-foreground hover:bg-error/90"
              onClick={() => {
                setSichtbar(false);
                toast('Journal bereinigt', { description: 'Der Wiederherstellungsstand wurde verworfen.' });
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
