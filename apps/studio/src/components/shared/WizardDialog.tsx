/**
 * WizardDialog — Wizard-first-Erzeugung (MS17, vereinfachung.md §2).
 *
 * Gemeinsames 3-Schritte-Muster für alle Erzeugungsflüsse (Neuer Dialog,
 * Neues Script, Neuer NPC, Neues Field, Neuer Gegner, Neue Schlacht):
 *
 *   Schritt 1 — Identität: Name (FF-Zeichensatz-Validierung) mit
 *               Default-Vorschlag; die abgeleitete Dokument-ID erscheint
 *               als Mono-Vorschau.
 *   Schritt 2 — Kernwahl: genau EINE typprägende Entscheidung als große
 *               Radio-Kacheln (gesperrte Zukunfts-Pfade bleiben als
 *               LockedCard-Kacheln sichtbar).
 *   Schritt 3 — Zusammenfassung & Defaults: kompakte Liste der gewählten
 *               Defaults + Primär-CTA „Erstellen" (Mako).
 *
 * Buttons unten: „Zurück" (Ghost) / „Weiter" (Primary) / „Abbrechen"
 * (Text-Link). Schritt-Validierung blockiert „Weiter" mit Inline-Meldung
 * (kein Toast). Das erzeugte Objekt ist immer ein valider Default-Stand
 * und danach normal editierbar.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Lock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ffZeichensatzOk } from '@/lib/gegner';
import { cn } from '@/lib/utils';

export interface WizardKernOption {
  id: string;
  label: string;
  beschreibung: string;
  icon?: LucideIcon;
  /** Gesperrte Kachel (Zukunfts-Feature): Badge-Text, z. B. „MS9". */
  gesperrt?: string;
}

export interface WizardDefaultZeile {
  label: string;
  wert: string;
}

interface WizardDialogProps {
  offen: boolean;
  onOpenChange: (offen: boolean) => void;
  /** z. B. „Neuer Gegner" */
  titel: string;
  icon: LucideIcon;
  /** Default-Namensvorschlag, z. B. „Neuer Gegner 3". */
  nameVorschlag: string;
  /** Leitet die Dokument-ID aus dem Namen ab (Mono-Vorschau). */
  idVorschau: (name: string) => string;
  /** Überschrift über den Radio-Kacheln in Schritt 2. */
  kernTitel: string;
  kernOptionen: WizardKernOption[];
  /** Defaults-Liste in Schritt 3 (abhängig von der Kernwahl). */
  defaultsFuer: (kern: string) => WizardDefaultZeile[];
  /** Abschluss: erzeugt das Objekt (Wizard schließt danach selbst). */
  onErstellen: (ergebnis: { name: string; kern: string }) => void;
}

/** Leitet einen ID-Slug aus dem Anzeigenamen ab. */
export function wizardSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'neu';
}

const SCHRITTE = ['Grunddaten', 'Kernwahl', 'Zusammenfassung'] as const;

export default function WizardDialog({
  offen,
  onOpenChange,
  titel,
  icon: Icon,
  nameVorschlag,
  idVorschau,
  kernTitel,
  kernOptionen,
  defaultsFuer,
  onErstellen,
}: WizardDialogProps) {
  const [schritt, setSchritt] = useState(0);
  const [name, setName] = useState(nameVorschlag);
  const [kern, setKern] = useState(kernOptionen[0]?.id ?? '');
  const [versucht, setVersucht] = useState(false);
  const [erfolgPuls, setErfolgPuls] = useState(false);

  /* Beim Öffnen: Wizard zurücksetzen (frischer Vorschlag je Aufruf). */
  useEffect(() => {
    if (offen) {
      setSchritt(0);
      setName(nameVorschlag);
      setKern(kernOptionen[0]?.id ?? '');
      setVersucht(false);
      setErfolgPuls(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen, nameVorschlag]);

  const nameOk = useMemo(() => name.trim().length > 0 && ffZeichensatzOk(name), [name]);
  const defaults = useMemo(() => defaultsFuer(kern), [defaultsFuer, kern]);

  const weiter = () => {
    if (schritt === 0 && !nameOk) {
      setVersucht(true);
      return;
    }
    setVersucht(false);
    setSchritt((s) => Math.min(2, s + 1));
  };

  const erstellen = () => {
    setErfolgPuls(true);
    window.setTimeout(() => {
      onErstellen({ name: name.trim(), kern });
      onOpenChange(false);
    }, 420);
  };

  return (
    <Dialog open={offen} onOpenChange={onOpenChange}>
      <DialogContent className="border-subtle bg-elevated sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[15px]">
            <Icon className="h-4 w-4 text-mako" />
            {titel}
          </DialogTitle>
        </DialogHeader>

        {/* Schritt-Indikator: 3 Segmente mit Mono-Nummern */}
        <div className="flex items-center gap-2">
          {SCHRITTE.map((label, i) => (
            <div key={label} className="flex flex-1 flex-col gap-1">
              <div className="h-1 overflow-hidden rounded bg-inset">
                <motion.div
                  className="h-full bg-mako"
                  initial={false}
                  animate={{ width: i <= schritt ? '100%' : '0%' }}
                  transition={{ duration: 0.2 }}
                />
              </div>
              <span
                className={cn(
                  'font-mono text-[10px]',
                  i === schritt ? 'text-mako' : i < schritt ? 'text-secondary' : 'text-muted',
                )}
              >
                {i + 1} · {label}
              </span>
            </div>
          ))}
        </div>

        {/* Schritt-Inhalt (Wechsel: x ±16px + opacity, 220ms) */}
        <div className="relative min-h-[220px]">
          <AnimatePresence mode="wait" initial={false}>
            {schritt === 0 && (
              <motion.div
                key="s0"
                initial={{ x: 16, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -16, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="flex flex-col gap-3 pt-2"
              >
                <label className="text-[13px] font-medium text-foreground" htmlFor="wizard-name">
                  Name
                </label>
                <Input
                  id="wizard-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && weiter()}
                  placeholder={nameVorschlag}
                  className={cn(
                    'h-9 border-subtle bg-inset text-[14px]',
                    versucht && !nameOk && 'border-error focus-visible:outline-error',
                  )}
                />
                {versucht && !nameOk && (
                  <p className="text-[11px] text-error">
                    {name.trim().length === 0
                      ? 'Bitte einen Namen vergeben.'
                      : 'Zeichen nicht im FF-Zeichensatz — bitte anpassen.'}
                  </p>
                )}
                <div className="flex items-center gap-2 rounded border border-subtle bg-inset px-2.5 py-2">
                  <span className="text-[11px] text-muted">Dokument-ID</span>
                  <code className="truncate font-mono text-[11px] text-engine">{idVorschau(name)}</code>
                </div>
                <p className="text-[11px] text-muted">
                  Die ID wird aus dem Namen abgeleitet und ist später im Inspektor einsehbar.
                </p>
              </motion.div>
            )}

            {schritt === 1 && (
              <motion.div
                key="s1"
                initial={{ x: 16, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -16, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="flex flex-col gap-2 pt-2"
              >
                <p className="text-[13px] font-medium text-foreground">{kernTitel}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={kernTitel}>
                  {kernOptionen.map((option) => {
                    const aktiv = kern === option.id;
                    const OptionIcon = option.icon;
                    if (option.gesperrt) {
                      return (
                        <div
                          key={option.id}
                          aria-disabled
                          title={`${option.label} — folgt (${option.gesperrt})`}
                          className="cursor-not-allowed rounded-lg border border-subtle bg-panel p-3 opacity-55 select-none"
                        >
                          <div className="flex items-center gap-2">
                            {OptionIcon && <OptionIcon className="h-4 w-4 text-locked" />}
                            <span className="text-[13px] font-medium text-foreground">{option.label}</span>
                            <span className="ml-auto inline-flex items-center gap-1 rounded border border-warn px-1.5 py-px text-[10px] font-medium text-warn">
                              <Lock className="h-3 w-3" />
                              {option.gesperrt}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted">{option.beschreibung}</p>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={aktiv}
                        onClick={() => setKern(option.id)}
                        className={cn(
                          'relative rounded-lg border bg-panel p-3 text-left transition-colors duration-150',
                          aktiv ? 'border-mako/60 bg-mako-dim' : 'border-subtle hover:border-strong hover:bg-elevated',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {OptionIcon && <OptionIcon className={cn('h-4 w-4', aktiv ? 'text-mako' : 'text-secondary')} />}
                          <span className="text-[13px] font-medium text-foreground">{option.label}</span>
                          {aktiv && <Check className="ml-auto h-3.5 w-3.5 text-mako" />}
                        </div>
                        <p className="mt-1 text-[11px] text-secondary">{option.beschreibung}</p>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {schritt === 2 && (
              <motion.div
                key="s2"
                initial={{ x: 16, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -16, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="relative flex flex-col gap-2 pt-2"
              >
                {/* Erfolgs-Puls beim Abschluss (Ring 1→1.6, 500ms) */}
                {erfolgPuls && (
                  <motion.span
                    className="pointer-events-none absolute inset-0 rounded-md border-2 border-mako"
                    initial={{ scale: 1, opacity: 0.6 }}
                    animate={{ scale: 1.05, opacity: 0 }}
                    transition={{ duration: 0.5 }}
                  />
                )}
                <p className="text-[13px] font-medium text-foreground">
                  „{name.trim()}" wird mit diesen Defaults angelegt:
                </p>
                <dl className="flex flex-col divide-y divide-subtle rounded-lg border border-subtle bg-inset">
                  {defaults.map((d) => (
                    <div key={d.label} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                      <dt className="text-[12px] text-muted">{d.label}</dt>
                      <dd className="truncate text-right text-[12px] text-foreground">{d.wert}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-[11px] text-muted">
                  Sofort valide — du kannst alles danach im Editor anpassen.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Fußzeile: Abbrechen (Text) · Zurück (Ghost) · Weiter/Erstellen (Primary) */}
        <div className="flex items-center gap-2 border-t border-subtle pt-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
          >
            Abbrechen
          </button>
          <div className="ml-auto flex items-center gap-2">
            {schritt > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSchritt((s) => s - 1)} className="h-8 text-[12px] text-secondary hover:text-foreground">
                Zurück
              </Button>
            )}
            {schritt < 2 ? (
              <Button
                size="sm"
                onClick={weiter}
                className="h-8 bg-mako px-4 text-[12px] font-semibold text-primary-foreground hover:bg-mako-hover"
              >
                Weiter
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={erstellen}
                className="h-8 bg-mako px-4 text-[12px] font-semibold text-primary-foreground hover:bg-mako-hover"
              >
                Erstellen
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
