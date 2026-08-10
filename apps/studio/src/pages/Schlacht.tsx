/**
 * Battle-Editor (`#/schlacht`) — MS16 Battle-Creator (schlacht.md).
 * IDE-Shell: Schlachtliste links, Arena-Canvas (oben, dominant) +
 * Probekampf-Panel (unten, einklappbar) in der Mitte, Inspektor rechts
 * (Regeln / Belohnung / Verknüpfung), Befundzeile über dem Panel.
 * Zustand lokal (useState), Demo-Szene „Slum-Hinterhof ×3" aus lib/schlacht.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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
import { Check, Copy, Image as ImageIcon, Landmark, Lock, MoreHorizontal, Play, Swords } from 'lucide-react';
import { toast } from 'sonner';
import ArenaCanvas from '@/components/schlacht/ArenaCanvas';
import ProbekampfPanel from '@/components/schlacht/ProbekampfPanel';
import SchlachtInspektor from '@/components/schlacht/SchlachtInspektor';
import SchlachtListe from '@/components/schlacht/SchlachtListe';
import type { SchlachtEintrag } from '@/components/schlacht/SchlachtListe';
import EmptyState from '@/components/shared/EmptyState';
import WizardDialog from '@/components/shared/WizardDialog';
import { wizardSlug } from '@/components/shared/WizardDialog';
import { useUiModus } from '@/lib/ui-modus';
import { DEMO_SCRIPT_VERWEIS, demoMarker, demoSchlacht, neueSchlacht, pruefeSchlacht } from '@/lib/schlacht';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const DEMO_STAND: SchlachtEintrag = { doc: demoSchlacht, marker: demoMarker };

export default function SchlachtPage() {
  const [eintraege, setEintraege] = useState<SchlachtEintrag[]>([DEMO_STAND]);
  const [aktivId, setAktivId] = useState<string | null>(demoSchlacht.id);
  const [gespiegelt, setGespiegelt] = useState(false);
  const [spiegelPuls, setSpiegelPuls] = useState(0);
  const [probeOffen, setProbeOffen] = useState(true);
  const [startSignal, setStartSignal] = useState(0);
  const [menueOffen, setMenueOffen] = useState(false);
  const [loeschDialog, setLoeschDialog] = useState(false);
  const [kopiert, setKopiert] = useState(false);
  const [neuZaehler, setNeuZaehler] = useState(1);
  const [wizardOffen, setWizardOffen] = useState(false);
  const { istEinfach } = useUiModus();
  const location = useLocation();
  const navigate = useNavigate();

  /* Schnellaktion (Home) öffnet den Wizard via location.state. */
  useEffect(() => {
    if ((location.state as { wizard?: boolean } | null)?.wizard) {
      setWizardOffen(true);
      navigate('.', { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aktiv = eintraege.find((e) => e.doc.id === aktivId) ?? null;
  const befunde = useMemo(() => (aktiv ? pruefeSchlacht(aktiv.doc, aktiv.marker) : []), [aktiv]);

  const patchAktiv = (patch: Partial<SchlachtEintrag>) => {
    if (!aktiv) return;
    setEintraege((liste) => liste.map((e) => (e.doc.id === aktiv.doc.id ? { ...e, ...patch } : e)));
  };

  const schlachtAnlegen = () => {
    const n = neuZaehler;
    setNeuZaehler(n + 1);
    const stand = neueSchlacht(n);
    setEintraege((liste) => [...liste, stand]);
    setAktivId(stand.doc.id);
    toast.success('Schlacht angelegt', {
      description: 'Gegner aus der Palette auf die Gegnerseite ziehen.',
    });
  };

  /* Wizard-first-Erzeugung (MS17): Kernwahl = Arena-Quelle. Der erzeugte
     Stand ist sofort valide (Flucht erlaubt, Modifikatoren ×1,0, gültige
     Arena) — danach Guided-Hinweis auf die Gegner-Palette. */
  const wizardErstellen = ({ name, kern }: { name: string; kern: string }) => {
    const n = neuZaehler;
    setNeuZaehler(n + 1);
    const stand = neueSchlacht(n);
    stand.doc.name = name;
    stand.doc.id = `mod:de.beispiel.nebenquest/battles/${wizardSlug(name)}`;
    if (kern === 'referenz') {
      stand.doc.arena = { art: 'referenz', ref: 'field:md8_1/battle-arena' };
    }
    setEintraege((liste) => [...liste, stand]);
    setAktivId(stand.doc.id);
    toast.success(`„${name}" erstellt`, {
      description: 'Ziehe Gegner aus der Palette auf die Arena, um die Formation zu stellen.',
    });
  };

  const duplizieren = () => {
    if (!aktiv) return;
    setMenueOffen(false);
    const n = neuZaehler;
    setNeuZaehler(n + 1);
    const stand: SchlachtEintrag = {
      doc: { ...aktiv.doc, id: `${aktiv.doc.id}-kopie-${n}`, name: `${aktiv.doc.name} (Kopie)` },
      marker: aktiv.marker.map((m, i) => ({ ...m, id: `m:kopie-${n}-${i}` })),
    };
    setEintraege((liste) => [...liste, stand]);
    setAktivId(stand.doc.id);
  };

  const loeschen = () => {
    if (!aktiv) return;
    const entfernt = aktiv;
    const rest = eintraege.filter((e) => e.doc.id !== aktiv.doc.id);
    setEintraege(rest);
    setAktivId(rest[0]?.doc.id ?? null);
    setLoeschDialog(false);
    toast(`„${entfernt.doc.name}" gelöscht`, {
      description: `Script-Knoten „${DEMO_SCRIPT_VERWEIS.knotenName}" verliert seine Referenz.`,
      action: {
        label: 'Rückgängig',
        onClick: () => {
          setEintraege((liste) => [entfernt, ...liste]);
          setAktivId(entfernt.doc.id);
        },
      },
    });
  };

  const breadcrumb = aktiv?.doc.id ?? '';

  return (
    <div className="flex h-full min-h-0">
      <SchlachtListe
        eintraege={eintraege}
        aktivId={aktivId}
        onWaehlen={setAktivId}
        onNeu={() => setWizardOffen(true)}
        onLeerAnlegen={istEinfach ? undefined : schlachtAnlegen}
      />

      {aktiv === null ? (
        <div className="flex min-w-0 flex-1 items-center justify-center bg-inset">
          <EmptyState
            icon={Swords}
            titel="Noch keine Schlachten"
            hinweis="Stelle deine erste Begegnung zusammen — Gegner platzieren, Regeln setzen, Probekampf ansehen."
            ctaLabel="Schlacht erstellen"
            onCta={() => setWizardOffen(true)}
          />
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Kopfzeile */}
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-subtle bg-panel px-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[12px] text-muted">{breadcrumb}</span>
                  <button
                    type="button"
                    aria-label="ID kopieren"
                    onClick={() => {
                      void navigator.clipboard?.writeText(breadcrumb).catch(() => undefined);
                      setKopiert(true);
                      window.setTimeout(() => setKopiert(false), 1200);
                    }}
                    className="text-muted transition-colors duration-150 hover:text-foreground"
                  >
                    {kopiert ? <Check className="h-3 w-3 text-mako" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <input
                    value={aktiv.doc.name}
                    onChange={(e) => patchAktiv({ doc: { ...aktiv.doc, name: e.target.value } })}
                    aria-label="Szenenname"
                    className="w-56 rounded bg-transparent font-display text-[20px] font-semibold tracking-[-0.01em] text-foreground outline-none transition-colors duration-150 hover:bg-elevated focus:bg-elevated"
                  />
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-default items-center gap-1 rounded border border-warn px-1.5 py-0.5 text-[10px] font-medium text-warn">
                          <Lock className="h-3 w-3" />
                          Paketierbar · Aktivierung mit Battle-Modul
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-64 text-xs">
                        S19-Muster: Die Szene wird ins Paket geschrieben; die Kampf-Aktivierung
                        im Spiel folgt mit dem Battle-Modul.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {/* Genau eine Primär-CTA (MS17) */}
                <button
                  type="button"
                  onClick={() => setStartSignal((n) => n + 1)}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-mako px-3 text-[13px] font-medium text-primary-foreground shadow-mako-glow transition-colors duration-150 hover:bg-mako-hover"
                >
                  <Play className="h-3.5 w-3.5" />
                  Probekampf starten
                </button>
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Weitere Aktionen"
                    onClick={() => setMenueOffen((v) => !v)}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-subtle text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menueOffen && (
                    <div className="absolute right-0 top-9 z-30 w-44 rounded-md border border-subtle bg-popover p-1 shadow-modal">
                      <button
                        type="button"
                        onClick={duplizieren}
                        className="w-full rounded px-2 py-1.5 text-left text-[12px] text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                      >
                        Duplizieren
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenueOffen(false);
                          setLoeschDialog(true);
                        }}
                        className="w-full rounded px-2 py-1.5 text-left text-[12px] text-error transition-colors duration-150 hover:bg-elevated"
                      >
                        Löschen
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Arena-Canvas (dominant, ~60 %) */}
            <div className="min-h-0 flex-[3]">
              <ArenaCanvas
                doc={aktiv.doc}
                marker={aktiv.marker}
                setMarker={(marker) => patchAktiv({ marker })}
                gespiegelt={gespiegelt}
                setGespiegelt={setGespiegelt}
                spiegelPuls={spiegelPuls}
              />
            </div>

            {/* Befundzeile */}
            {befunde.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-subtle bg-panel px-3 py-1.5">
                {befunde.map((b, i) => (
                  <motion.span
                    key={`${b.pfad}-${i}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      'flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px]',
                      b.klasse === 'fehler' && 'border-error/60 text-error',
                      b.klasse === 'warnung' && 'border-warn/60 text-warn',
                      b.klasse === 'info' && 'border-info/60 text-info',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        b.klasse === 'fehler' && 'bg-error',
                        b.klasse === 'warnung' && 'bg-warn',
                        b.klasse === 'info' && 'bg-info',
                      )}
                    />
                    {b.meldung}
                    <span className="font-mono text-[9.5px] opacity-70">{b.pfad}</span>
                  </motion.span>
                ))}
              </div>
            )}

            {/* Probekampf-Panel (unten, einklappbar) */}
            <ProbekampfPanel
              marker={aktiv.marker}
              offen={probeOffen}
              setOffen={setProbeOffen}
              startSignal={startSignal}
            />
          </div>

          <SchlachtInspektor
            doc={aktiv.doc}
            setDoc={(doc) => patchAktiv({ doc })}
            marker={aktiv.marker}
            onSpiegelPuls={() => setSpiegelPuls((n) => n + 1)}
          />

          {/* Wizard-first-Erzeugung (MS17): Neue Schlacht */}
          <WizardDialog
            offen={wizardOffen}
            onOpenChange={setWizardOffen}
            titel="Neue Schlacht"
            icon={Swords}
            nameVorschlag={`Neue Schlacht ${eintraege.length + 1}`}
            idVorschau={(n) => `mod:de.beispiel.nebenquest/battles/${wizardSlug(n)}`}
            kernTitel="Woher kommt die Arena?"
            kernOptionen={[
              { id: 'nutzerbild', label: 'Nutzerbild importieren', beschreibung: 'Eigenes Hintergrundbild als Kampf-Arena verwenden.', icon: ImageIcon },
              { id: 'referenz', label: 'Original-Arena referenzieren', beschreibung: 'Bestehende Arena aus dem Original — nur referenziert, nie kopiert.', icon: Landmark },
            ]}
            defaultsFuer={() => [
              { label: 'Flucht', wert: 'erlaubt' },
              { label: 'Hinterhalt', wert: 'keiner' },
              { label: 'Modifikatoren', wert: 'EXP/AP/Gil ×1,0' },
              { label: 'Siegbedingung', wert: 'alle Gegner besiegt' },
            ]}
            onErstellen={wizardErstellen}
          />

          {/* Szene löschen (AlertDialog + Undo-Toast) */}
          <AlertDialog open={loeschDialog} onOpenChange={setLoeschDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Schlacht löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Script-Knoten „{DEMO_SCRIPT_VERWEIS.knotenName}" verliert seine Referenz — fortfahren?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={loeschen}>Löschen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
