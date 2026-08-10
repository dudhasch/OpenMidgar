/**
 * TokenToolbar — Steuerelement-Toolbar über dem Seiten-Editor (dialoge.md 3.1).
 * Popovers: Farbe (8 FF7-Felder), Pause (Frame-Stepper), Variable (Autocomplete
 * über variables.json), Auswahlmenü (Mini-Dialog mit 2–4 Optionszeilen).
 * Rechts: Undo/Redo + Zeichenzähler des aktiven Eintrags.
 */
import { useMemo, useState } from 'react';
import { List, Minus, Palette, Pause, Plus, Redo2, Undo2, Variable } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FF7_FARBEN, VARIABLEN_LISTE, VARIABLEN_WERTE } from '@/lib/dialoge';
import { cn } from '@/lib/utils';

interface TokenToolbarProps {
  onToken: (snippet: string) => void;
  onAuswahl: (optionen: string[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  kannUndo: boolean;
  kannRedo: boolean;
  zeichen: number;
  deaktiviert?: boolean;
}

export default function TokenToolbar({
  onToken,
  onAuswahl,
  onUndo,
  onRedo,
  kannUndo,
  kannRedo,
  zeichen,
  deaktiviert,
}: TokenToolbarProps) {
  const [pauseFrames, setPauseFrames] = useState(15);
  const [varFilter, setVarFilter] = useState('');
  const [auswahlOffen, setAuswahlOffen] = useState(false);
  const [optionen, setOptionen] = useState<string[]>(['', '']);

  const variablen = useMemo(
    () => VARIABLEN_LISTE.filter((v) => v.name.toLowerCase().includes(varFilter.toLowerCase())),
    [varFilter],
  );

  const btn = (aktiv?: boolean) =>
    cn(
      'flex h-7 w-7 items-center justify-center rounded transition-colors duration-150',
      aktiv ? 'bg-mako-dim text-mako' : 'text-secondary hover:bg-elevated hover:text-foreground',
      deaktiviert && 'pointer-events-none opacity-40',
    );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-subtle bg-panel px-2" aria-label="Steuerelement-Toolbar">
        {/* Farbe */}
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button type="button" className={btn()} aria-label="Farbe einfügen" disabled={deaktiviert}>
                  <Palette className="h-4 w-4" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Farbe</TooltipContent>
          </Tooltip>
          <PopoverContent side="bottom" align="start" className="w-auto origin-top-left border-subtle bg-popover p-2">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">FF7-Textfarbe</p>
            <div className="grid grid-cols-4 gap-1.5">
              {FF7_FARBEN.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  title={`{FARBE:${f.name}} — ${f.label}`}
                  onClick={() => onToken(`{FARBE:${f.name}}`)}
                  className="flex h-8 w-8 items-center justify-center rounded border border-subtle transition-transform duration-150 hover:scale-110 hover:border-strong"
                  style={{ backgroundColor: f.hex }}
                >
                  <span className="sr-only">{f.label}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Pause */}
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button type="button" className={btn()} aria-label="Pause einfügen" disabled={deaktiviert}>
                  <Pause className="h-4 w-4" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Pause</TooltipContent>
          </Tooltip>
          <PopoverContent side="bottom" align="start" className="w-52 origin-top-left border-subtle bg-popover p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Dauer (Frames)</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPauseFrames((f) => Math.max(1, f - 5))}
                className="flex h-6 w-6 items-center justify-center rounded border border-subtle text-secondary hover:bg-elevated"
                aria-label="Weniger Frames"
              >
                <Minus className="h-3 w-3" />
              </button>
              <input
                type="number"
                min={1}
                max={999}
                value={pauseFrames}
                onChange={(e) => setPauseFrames(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                className="h-7 w-16 rounded border border-subtle bg-inset text-center font-mono text-xs text-foreground focus:outline-none"
                aria-label="Frames"
              />
              <button
                type="button"
                onClick={() => setPauseFrames((f) => Math.min(999, f + 5))}
                className="flex h-6 w-6 items-center justify-center rounded border border-subtle text-secondary hover:bg-elevated"
                aria-label="Mehr Frames"
              >
                <Plus className="h-3 w-3" />
              </button>
              <span className="ml-auto font-mono text-[10px] text-muted">≈ {Math.round((pauseFrames * 1000) / 60) / 1000}s</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              /* Sekundär (MS17 §4): Dialoge-Primär-CTA ist „Neuer Eintrag". */
              className="mt-2.5 h-7 w-full border border-subtle text-secondary hover:bg-elevated hover:text-foreground"
              onClick={() => onToken(`{PAUSE:${pauseFrames}}`)}
            >
              {'{PAUSE:' + pauseFrames + '} einfügen'}
            </Button>
          </PopoverContent>
        </Popover>

        {/* Variable */}
        <Popover onOpenChange={(o) => !o && setVarFilter('')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button type="button" className={btn()} aria-label="Variable einfügen" disabled={deaktiviert}>
                  <Variable className="h-4 w-4" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Variable einfügen</TooltipContent>
          </Tooltip>
          <PopoverContent side="bottom" align="start" className="w-64 origin-top-left border-subtle bg-popover p-2">
            <input
              autoFocus
              value={varFilter}
              onChange={(e) => setVarFilter(e.target.value)}
              placeholder="Variable suchen …"
              className="mb-1.5 h-7 w-full rounded border border-subtle bg-inset px-2 text-xs text-foreground placeholder:text-muted focus:outline-none"
            />
            <div className="max-h-44 overflow-y-auto">
              {variablen.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => onToken(`{VAR:${v.name}}`)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-elevated"
                >
                  <span className="font-mono text-xs text-engine">{v.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted">= {VARIABLEN_WERTE[v.name]}</span>
                  <span className="w-full flex-1" />
                </button>
              ))}
              {variablen.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted">Keine Variable in variables.json gefunden.</p>
              )}
            </div>
            {variablen.some((v) => v.name === varFilter) === false && varFilter && (
              <p className="border-t border-subtle px-2 pt-1.5 text-[11px] text-warn">
                „{varFilter}“ ist nicht deklariert — würde einen Befund erzeugen.
              </p>
            )}
          </PopoverContent>
        </Popover>

        {/* Auswahlmenü */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={btn()}
              aria-label="Auswahlmenü einfügen"
              disabled={deaktiviert}
              onClick={() => setAuswahlOffen(true)}
            >
              <List className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Auswahlmenü</TooltipContent>
        </Tooltip>

        <span className="mx-1.5 h-4 w-px bg-subtle" />

        {/* Undo/Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={btn()} aria-label="Rückgängig" disabled={!kannUndo || deaktiviert} onClick={onUndo}>
              <Undo2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Rückgängig</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={btn()} aria-label="Wiederholen" disabled={!kannRedo || deaktiviert} onClick={onRedo}>
              <Redo2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Wiederholen</TooltipContent>
        </Tooltip>

        {/* Zeichenzähler */}
        <span className="ml-auto font-mono text-[11px] text-muted" aria-label="Zeichenzähler">
          {zeichen} Zeichen
        </span>
      </div>

      {/* Mini-Dialog: Auswahlmenü anlegen */}
      <Dialog open={auswahlOffen} onOpenChange={setAuswahlOffen}>
        <DialogContent className="max-w-md border-subtle bg-panel text-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-[15px]">Auswahlmenü anlegen</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-secondary">
            2–4 Optionszeilen — in der Vorschau erscheint der ▶-Cursor, im Token {'{AUSWAHL}'}.
          </p>
          <div className="flex flex-col gap-1.5">
            {optionen.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-4 text-right font-mono text-[11px] text-muted">{i + 1}</span>
                <input
                  autoFocus={i === 0}
                  value={opt}
                  onChange={(e) =>
                    setOptionen((alt) => alt.map((o, oi) => (oi === i ? e.target.value : o)))
                  }
                  placeholder={`Option ${i + 1} …`}
                  className="h-8 flex-1 rounded border border-subtle bg-inset px-2 text-[13px] text-foreground placeholder:text-muted focus:outline-none"
                />
                {optionen.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptionen((alt) => alt.filter((_, oi) => oi !== i))}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-elevated hover:text-error"
                    aria-label={`Option ${i + 1} entfernen`}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {optionen.length < 4 && (
            <button
              type="button"
              onClick={() => setOptionen((alt) => [...alt, ''])}
              className="flex h-7 items-center gap-1 self-start rounded px-2 text-xs text-engine transition-colors duration-150 hover:bg-engine/10"
            >
              <Plus className="h-3.5 w-3.5" /> Option hinzufügen
            </button>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAuswahlOffen(false)} className="text-secondary hover:text-foreground">
              Abbrechen
            </Button>
            <Button
              className="bg-mako text-primary-foreground hover:bg-mako-hover"
              disabled={optionen.filter((o) => o.trim()).length < 2}
              onClick={() => {
                onAuswahl(optionen.filter((o) => o.trim()));
                setOptionen(['', '']);
                setAuswahlOffen(false);
              }}
            >
              Auswahl einfügen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
