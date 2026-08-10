/**
 * QuestInspektor — rechter Inspektor (280px, quests.md Sektion 3).
 * Kein Knoten gewählt → Script-Eigenschaften (Name, Script-ID, Trigger/Slot-
 * Matrix). Knoten gewählt → Knoten-Inspektor: Mnemonic (Mono), Form-Icon,
 * Blockierend-Chip + read-only-Toggle (formatgegeben), typisiertes
 * Operanden-Formular mit Variablen-/Dialog-Autocomplete und Quick-Fix
 * „Variable anlegen", Trigger/Slot-Matrix, Löschen/Duplizieren.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Octagon, Square, Trash2 } from 'lucide-react';
import type { SlotArt } from '@webmidgar/studio-core';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import RefBadge from '@/components/shared/RefBadge';
import { SLOT_MATRIX, kategorieFarbe } from '@/lib/quests';
import type { ProjektVariable } from '@/lib/quests';
import type { QuestFlowNode } from '@/components/quests/QuestKnoten';
import { cn } from '@/lib/utils';

interface QuestInspektorProps {
  knoten: QuestFlowNode | null;
  variablen: ProjektVariable[];
  dialogRefs: string[];
  scriptName: string;
  onScriptName: (n: string) => void;
  scriptBeschreibung: string;
  onScriptBeschreibung: (b: string) => void;
  scriptId: string;
  scriptSlots: SlotArt[];
  onToggleSlot: (slot: SlotArt) => void;
  timerMs: number;
  onTimerMs: (ms: number) => void;
  onOperandAendern: (knotenId: string, key: string, wert: string | number) => void;
  onKnotenLoeschen: (id: string) => void;
  onKnotenDuplizieren: (id: string) => void;
  onVariableQuickFix: (name: string) => void;
}

const FIELD_ZIELE = [
  { id: 'mod:de.beispiel.nebenquest/field/slumkirche_aussen', label: 'slumkirche_aussen (Mod)' },
  { id: 'field:md1_1', label: 'md1_1 (Original)', original: true },
];

/* ------------------------------------------------------------------ */
/* Trigger/Slot-Matrix                                                 */
/* ------------------------------------------------------------------ */

function SlotMatrix({
  slots,
  onToggle,
  timerMs,
  onTimerMs,
}: {
  slots: SlotArt[];
  onToggle: (slot: SlotArt) => void;
  timerMs: number;
  onTimerMs: (ms: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
        Trigger / Slots
      </p>
      {SLOT_MATRIX.map(({ id, beschreibung }) => {
        const aktiv = slots.includes(id);
        return (
          <div key={id} className="flex items-center gap-2">
            <Checkbox
              id={`slot-${id}`}
              checked={aktiv}
              onCheckedChange={() => onToggle(id)}
              className="border-strong data-[state=checked]:border-mako data-[state=checked]:bg-mako data-[state=checked]:text-background"
            />
            <label htmlFor={`slot-${id}`} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2">
              <span className="font-mono text-[11px] text-foreground">{id}</span>
              <span className="truncate text-[10px] text-muted">{beschreibung}</span>
            </label>
            {id === 'timer' && aktiv && (
              <Input
                type="number"
                value={timerMs}
                onChange={(e) => onTimerMs(Number(e.target.value) || 0)}
                className="h-6 w-20 border-subtle bg-inset font-mono text-[10px]"
                aria-label="Timer-Intervall in ms"
              />
            )}
          </div>
        );
      })}
      {/* Aktive Slots als Mako-Chips (auch im Canvas-Knoten sichtbar) */}
      <div className="flex min-h-5 flex-wrap gap-1 pt-0.5">
        <AnimatePresence>
          {slots.map((s) => (
            <motion.span
              key={s}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="rounded border border-mako/30 bg-mako-dim px-1.5 font-mono text-[9px] leading-4 text-mako"
            >
              {s}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Operanden-Felder                                                    */
/* ------------------------------------------------------------------ */

function OperandFeld({
  knoten,
  schluessel,
  wert,
  variablen,
  dialogRefs,
  onOperandAendern,
  onVariableQuickFix,
}: {
  knoten: QuestFlowNode;
  schluessel: string;
  wert: string | number;
  variablen: ProjektVariable[];
  dialogRefs: string[];
  onOperandAendern: (knotenId: string, key: string, wert: string | number) => void;
  onVariableQuickFix: (name: string) => void;
}) {
  const label = <span className="font-mono text-[10px] text-muted">{schluessel}</span>;

  // Variable: Autocomplete aus Projektvariablen + Inline-Befund/Quick-Fix
  if (schluessel === 'variable') {
    const bekannt = variablen.some((v) => v.name === wert);
    const leer = String(wert).trim() === '';
    return (
      <div className="space-y-1">
        {label}
        <Input
          list="quest-variablen-liste"
          value={String(wert)}
          onChange={(e) => onOperandAendern(knoten.id, schluessel, e.target.value)}
          placeholder="Variablenname"
          className={cn(
            'h-7 border-subtle bg-inset font-mono text-[11px]',
            !leer && !bekannt && 'border-error focus-visible:outline-error',
          )}
        />
        <datalist id="quest-variablen-liste">
          {variablen.map((v) => (
            <option key={v.name} value={v.name} />
          ))}
        </datalist>
        {!leer && !bekannt && (
          <motion.p
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-1.5 text-[10px] text-error"
          >
            Variable nicht deklariert —
            <button
              type="button"
              onClick={() => onVariableQuickFix(String(wert))}
              className="rounded border border-mako/40 px-1 py-px font-medium text-mako transition-colors duration-150 hover:bg-mako-dim"
            >
              anlegen?
            </button>
          </motion.p>
        )}
      </div>
    );
  }

  // Dialog-Referenz: Autocomplete über Dialog-Dokumente
  if (schluessel === 'ref') {
    return (
      <div className="space-y-1">
        {label}
        <Input
          list="quest-dialog-liste"
          value={String(wert)}
          onChange={(e) => onOperandAendern(knoten.id, schluessel, e.target.value)}
          placeholder="dlg:…"
          className="h-7 border-subtle bg-inset font-mono text-[11px]"
        />
        <datalist id="quest-dialog-liste">
          {dialogRefs.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
    );
  }

  // Field-Ziel bei MAPJUMP: Select mit Original-Badge
  if (schluessel === 'ziel' && knoten.data.op === 'MAPJUMP') {
    return (
      <div className="space-y-1">
        {label}
        <Select value={String(wert) || undefined} onValueChange={(v) => onOperandAendern(knoten.id, schluessel, v)}>
          <SelectTrigger className="h-7 border-subtle bg-inset font-mono text-[10px]">
            <SelectValue placeholder="Field wählen" />
          </SelectTrigger>
          <SelectContent className="border-subtle bg-popover">
            {FIELD_ZIELE.map((f) => (
              <SelectItem key={f.id} value={f.id} className="font-mono text-[11px]">
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {String(wert).startsWith('field:') && <RefBadge refId={String(wert)} guardHash="a3f9…c1" />}
      </div>
    );
  }

  // Zahl
  if (typeof wert === 'number') {
    return (
      <div className="space-y-1">
        {label}
        <Input
          type="number"
          value={wert}
          onChange={(e) => onOperandAendern(knoten.id, schluessel, Number(e.target.value) || 0)}
          className="h-7 border-subtle bg-inset font-mono text-[11px]"
        />
      </div>
    );
  }

  // Fallback: Text
  return (
    <div className="space-y-1">
      {label}
      <Input
        value={String(wert)}
        onChange={(e) => onOperandAendern(knoten.id, schluessel, e.target.value)}
        className="h-7 border-subtle bg-inset font-mono text-[11px]"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hauptkomponente                                                     */
/* ------------------------------------------------------------------ */

export default function QuestInspektor(props: QuestInspektorProps) {
  const {
    knoten,
    variablen,
    dialogRefs,
    scriptName,
    onScriptName,
    scriptBeschreibung,
    onScriptBeschreibung,
    scriptId,
    scriptSlots,
    onToggleSlot,
    timerMs,
    onTimerMs,
    onOperandAendern,
    onKnotenLoeschen,
    onKnotenDuplizieren,
    onVariableQuickFix,
  } = props;
  const [kopiert, setKopiert] = useState(false);

  const kopiereId = () => {
    void navigator.clipboard?.writeText(scriptId).catch(() => undefined);
    setKopiert(true);
    window.setTimeout(() => setKopiert(false), 1200);
  };

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-subtle bg-panel">
      <div className="shrink-0 border-b border-subtle px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Inspektor</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          {knoten ? (
            <motion.div
              key={knoten.id}
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 6, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="space-y-4 p-3"
            >
              {/* Kopf: Kategorie-Punkt + Mnemonic + Form-Icon + Chip */}
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: kategorieFarbe(knoten.data.kategorie) }} />
                <span className="font-mono text-[14px] font-bold text-foreground">{knoten.data.op}</span>
                {knoten.data.blockierend ? (
                  <Octagon className="h-3.5 w-3.5 text-warn" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-muted" />
                )}
                <span
                  className={cn(
                    'ml-auto rounded border px-1.5 py-px text-[10px] font-medium',
                    knoten.data.blockierend
                      ? 'border-warn/40 text-warn'
                      : 'border-mako/40 text-mako',
                  )}
                >
                  {knoten.data.blockierend ? 'blockierend' : 'sofort'}
                </span>
              </div>

              {/* IDs-Duplikat / Mono-Rohwert: Profi-Element (MS17) */}
              <p data-profi className="font-mono text-[10px] text-muted">
                {knoten.id} · {knoten.data.kategorie}
              </p>

              {/* Blockierend-Toggle: read-only, formatgegeben */}
              <div className="flex items-center justify-between rounded border border-subtle bg-inset px-2 py-1.5">
                <span className="text-[11px] text-secondary">
                  Blockierend <span className="text-muted">(formatgegeben)</span>
                </span>
                <Switch checked={knoten.data.blockierend} disabled aria-label="Blockierend (formatgegeben, nicht änderbar)" />
              </div>

              {/* Operanden-Formular */}
              <div className="space-y-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Operanden</p>
                {Object.entries(knoten.data.operanden ?? {}).length === 0 && (
                  <p className="text-[11px] text-muted">Dieser Opcode hat keine Operanden.</p>
                )}
                {Object.entries(knoten.data.operanden ?? {}).map(([key, wert]) => (
                  <OperandFeld
                    key={key}
                    knoten={knoten}
                    schluessel={key}
                    wert={wert}
                    variablen={variablen}
                    dialogRefs={dialogRefs}
                    onOperandAendern={onOperandAendern}
                    onVariableQuickFix={onVariableQuickFix}
                  />
                ))}
                {/* Operanden-Rohform: Profi-Element (MS17 §1.4), per Disclosure
                    einklappbar — gleiche Werte wie das typisierte Formular. */}
                {Object.entries(knoten.data.operanden ?? {}).length > 0 && (
                  <ProfiDisclosure panelId={`quest-inspektor-${knoten.id}`} titel="Operanden-Rohform" anzahl={1} className="pt-1">
                    <pre data-profi className="overflow-x-auto rounded border border-subtle bg-inset px-2 py-1.5 font-mono text-[10px] leading-relaxed text-secondary">
                      {knoten.data.op}
                      {Object.entries(knoten.data.operanden ?? {}).map(([key, wert]) => `\n  ${key} = ${JSON.stringify(wert)}`).join('')}
                    </pre>
                  </ProfiDisclosure>
                )}
              </div>

              {/* Trigger/Slot-Matrix */}
              <SlotMatrix slots={scriptSlots} onToggle={onToggleSlot} timerMs={timerMs} onTimerMs={onTimerMs} />

              {/* Aktionen */}
              <div className="flex gap-2 border-t border-subtle pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px] text-secondary hover:bg-error/10 hover:text-error"
                  onClick={() => onKnotenLoeschen(knoten.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Knoten löschen
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px] text-secondary hover:text-foreground"
                  onClick={() => onKnotenDuplizieren(knoten.id)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Duplizieren
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="script"
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 6, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="space-y-4 p-3"
            >
              {/* Script-Eigenschaften */}
              <div className="space-y-1">
                <span className="font-mono text-[10px] text-muted">Name</span>
                <Input
                  value={scriptName}
                  onChange={(e) => onScriptName(e.target.value)}
                  className="h-7 border-subtle bg-inset text-[13px]"
                />
              </div>
              <div className="space-y-1">
                <span className="font-mono text-[10px] text-muted">Script-ID</span>
                <div className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate rounded border border-subtle bg-inset px-2 py-1 font-mono text-[10px] text-engine">
                    {scriptId}
                  </code>
                  <button
                    type="button"
                    onClick={kopiereId}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-subtle text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                    aria-label="Script-ID kopieren"
                  >
                    {kopiert ? <Check className="h-3.5 w-3.5 text-mako" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <span className="font-mono text-[10px] text-muted">Beschreibung</span>
                <Textarea
                  value={scriptBeschreibung}
                  onChange={(e) => onScriptBeschreibung(e.target.value)}
                  rows={3}
                  className="border-subtle bg-inset text-[13px]"
                  placeholder="Was macht dieses Script?"
                />
              </div>
              <SlotMatrix slots={scriptSlots} onToggle={onToggleSlot} timerMs={timerMs} onTimerMs={onTimerMs} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}
