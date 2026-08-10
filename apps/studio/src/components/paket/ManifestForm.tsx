/**
 * ManifestForm — Manifest-v2-Formular (paket.md Sektion 2):
 * modId (Mono, Live-Validierung + Fehler-Shake), Name, Version
 * (drei Stepper + semver-Chip), engineCompat (Select + dynamischer
 * Engine-Hinweis), Beschreibung (Zähler), Autoren (Chips), Sprachen
 * (DE gesperrt-aktiv, EN optional). Floating Labels, Mako-Fokusringe.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { AlertTriangle, Lock, Minus, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import PaketPanel from '@/components/paket/PaketPanel';
import {
  BESCHREIBUNG_LIMIT,
  engineCompatWarnung,
  modIdFehler,
  type ManifestForm as ManifestFormTyp,
} from '@/lib/paket';
import { cn } from '@/lib/utils';

interface ManifestFormProps {
  form: ManifestFormTyp;
  onPatch: (patch: Partial<ManifestFormTyp>) => void;
  /** Wird inkrementiert, um den Fehler-Shake der modId auszulösen. */
  shakeSignal: number;
  /** true, nachdem ein Kompilierversuch mit ungültiger modId lief. */
  modIdVersucht: boolean;
}

/** Floating-Label-Feld (Label wandert bei Fokus/Inhalt nach oben, 150ms). */
function FloatingField({
  id,
  label,
  mono,
  fehler,
  hinweis,
  children,
}: {
  id: string;
  label: string;
  mono?: boolean;
  fehler?: boolean;
  hinweis?: string;
  children: (klassen: string) => ReactNode;
}) {
  const klassen = cn(
    'peer h-10 w-full rounded-md border bg-inset px-3 pt-4 text-[14px] text-foreground transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mako focus-visible:ring-offset-2 focus-visible:ring-offset-panel',
    fehler ? 'border-error' : 'border-subtle hover:border-strong',
    mono && 'font-mono text-[13px]',
  );
  return (
    <div>
      <div className="relative">
        {children(klassen)}
        <label
          htmlFor={id}
          className={cn(
            'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted transition-all duration-150',
            'peer-focus:top-2.5 peer-focus:text-[10px] peer-focus:uppercase peer-focus:tracking-wider',
            'peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-wider',
            fehler && 'text-error',
          )}
        >
          {label}
        </label>
      </div>
      {fehler && hinweis && <p className="mt-1.5 text-[11px] text-error">{hinweis}</p>}
    </div>
  );
}

export default function ManifestForm({ form, onPatch, shakeSignal, modIdVersucht }: ManifestFormProps) {
  const [modIdBeruehrt, setModIdBeruehrt] = useState(false);
  const [autorEntwurf, setAutorEntwurf] = useState('');
  const shake = useAnimationControls();

  const fehlerModId = modIdFehler(form.modId);
  const zeigeModIdFehler = fehlerModId !== null && (modIdBeruehrt || modIdVersucht);
  const engineWarnung = engineCompatWarnung(form.engineCompat);

  useEffect(() => {
    if (shakeSignal > 0) {
      void shake.start({ x: [0, -4, 4, -2, 0], transition: { duration: 0.3 } });
    }
  }, [shakeSignal, shake]);

  const setVersionTeil = (teil: 'major' | 'minor' | 'patch', wert: number) => {
    onPatch({ version: { ...form.version, [teil]: Math.max(0, Math.min(99, Math.floor(wert) || 0)) } });
  };

  const autorHinzufuegen = () => {
    const wert = autorEntwurf.trim();
    if (wert.length === 0 || form.autoren.includes(wert)) return;
    onPatch({ autoren: [...form.autoren, wert] });
    setAutorEntwurf('');
  };

  return (
    <PaketPanel titel="Manifest (v2)" right={<span className="rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[10px] text-muted">autosave</span>}>
      <div className="flex flex-col gap-4">
        {/* modId — Mono, Live-Validierung, Fehler-Shake */}
        <motion.div animate={shake}>
          <FloatingField id="modId" label="modId" mono fehler={zeigeModIdFehler} hinweis={fehlerModId ?? undefined}>
            {(klassen) => (
              <input
                id="modId"
                value={form.modId}
                placeholder=" "
                spellCheck={false}
                autoComplete="off"
                className={klassen}
                aria-invalid={zeigeModIdFehler}
                onChange={(e) => onPatch({ modId: e.target.value })}
                onBlur={() => setModIdBeruehrt(true)}
              />
            )}
          </FloatingField>
          {!zeigeModIdFehler && (
            <p className="mt-1.5 font-mono text-[10px] text-muted">reverse-DNS · [a-z0-9.-]&#123;3,64&#125; · z. B. de.beispiel.nebenquest</p>
          )}
        </motion.div>

        {/* Name */}
        <FloatingField id="name" label="Name">
          {(klassen) => (
            <input id="name" value={form.name} placeholder=" " className={klassen} onChange={(e) => onPatch({ name: e.target.value })} />
          )}
        </FloatingField>

        {/* Version — drei Stepper + semver-Chip */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted">Version</span>
            <span className="rounded border border-subtle bg-inset px-1.5 py-0.5 font-mono text-[10px] text-secondary">semver</span>
          </div>
          <div className="flex items-center gap-2">
            {(['major', 'minor', 'patch'] as const).map((teil, i) => (
              <div key={teil} className="flex items-center gap-2">
                {i > 0 && <span className="font-mono text-muted">.</span>}
                <div className="flex items-center rounded-md border border-subtle bg-inset transition-colors duration-150 focus-within:border-mako hover:border-strong">
                  <button
                    type="button"
                    aria-label={`${teil} verringern`}
                    className="flex h-8 w-7 items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
                    onClick={() => setVersionTeil(teil, form.version[teil] - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <input
                    aria-label={`Version ${teil}`}
                    value={form.version[teil]}
                    onChange={(e) => setVersionTeil(teil, Number.parseInt(e.target.value, 10))}
                    className="h-8 w-10 bg-transparent text-center font-mono text-[13px] text-foreground focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={`${teil} erhöhen`}
                    className="flex h-8 w-7 items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
                    onClick={() => setVersionTeil(teil, form.version[teil] + 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
            <span className="ml-1 font-mono text-[11px] text-muted">{`${form.version.major}.${form.version.minor}.${form.version.patch}`}</span>
          </div>
        </div>

        {/* engineCompat — Select + dynamischer Hinweis */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted">engineCompat</span>
          </div>
          <Select value={form.engineCompat} onValueChange={(v) => onPatch({ engineCompat: v })}>
            <SelectTrigger className="h-9 border-subtle bg-inset font-mono text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-subtle bg-popover">
              <SelectItem value=">=0.4.0" className="font-mono text-xs">≥ 0.4.0</SelectItem>
              <SelectItem value=">=0.3.0" className="font-mono text-xs">≥ 0.3.0</SelectItem>
              <SelectItem value="=0.4.0" className="font-mono text-xs">= 0.4.0 (exakt)</SelectItem>
            </SelectContent>
          </Select>
          <AnimatePresence>
            {engineWarnung && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="mt-1.5 flex items-start gap-1.5 overflow-hidden text-[11px] text-warn"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {engineWarnung}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Beschreibung — Textarea mit Zähler */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted">Beschreibung</span>
            <span className={cn('font-mono text-[10px]', form.beschreibung.length > BESCHREIBUNG_LIMIT ? 'text-error' : 'text-muted')}>
              {form.beschreibung.length}/{BESCHREIBUNG_LIMIT}
            </span>
          </div>
          <Textarea
            value={form.beschreibung}
            rows={4}
            onChange={(e) => onPatch({ beschreibung: e.target.value.slice(0, BESCHREIBUNG_LIMIT) })}
            className="resize-none border-subtle bg-inset text-[14px] focus-visible:ring-mako"
          />
        </div>

        {/* Autoren — Tag-Input */}
        <div>
          <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted">Autoren</span>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-subtle bg-inset p-1.5 transition-colors duration-150 focus-within:border-mako">
            <AnimatePresence>
              {form.autoren.map((autor) => (
                <motion.span
                  key={autor}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.34, 1.56, 0.64, 1] }}
                  className="inline-flex items-center gap-1 rounded border border-subtle bg-elevated px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                >
                  {autor}
                  <button
                    type="button"
                    aria-label={`Autor ${autor} entfernen`}
                    className="text-muted transition-colors duration-150 hover:text-error"
                    onClick={() => onPatch({ autoren: form.autoren.filter((a) => a !== autor) })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
            <Input
              value={autorEntwurf}
              placeholder="Autor hinzufügen …"
              onChange={(e) => setAutorEntwurf(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  autorHinzufuegen();
                } else if (e.key === 'Backspace' && autorEntwurf.length === 0 && form.autoren.length > 0) {
                  onPatch({ autoren: form.autoren.slice(0, -1) });
                }
              }}
              className="h-6 min-w-28 flex-1 border-0 bg-transparent px-1 text-[12px] shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        {/* Sprachen — Checkbox-Chips (DE gesperrt-aktiv) */}
        <div>
          <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted">Sprachen</span>
          <div className="flex items-center gap-1.5">
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-default items-center gap-1 rounded border border-mako/50 bg-mako-dim px-2 py-1 font-mono text-[11px] text-mako">
                    <Lock className="h-3 w-3" />
                    DE · Primär
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Primärsprache — immer im Paket enthalten.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <button
              type="button"
              aria-pressed={form.spracheEn}
              onClick={() => onPatch({ spracheEn: !form.spracheEn })}
              className={cn(
                'inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] transition-colors duration-150',
                form.spracheEn
                  ? 'border-mako/50 bg-mako-dim text-mako'
                  : 'border-subtle bg-inset text-muted hover:border-strong hover:text-secondary',
              )}
            >
              EN{form.spracheEn ? ' · aktiv' : ' · optional'}
            </button>
          </div>
        </div>
      </div>
    </PaketPanel>
  );
}
