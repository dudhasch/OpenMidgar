/**
 * VariablenPanel — „Projektvariablen"-Accordion in der Sidebar
 * (quests.md Sektion 1, Tab „Scripts"). Benannte Variablen mit Typ-Chip,
 * Wert und Bank/Adresse in Mono; Inline-Editor für neue Variablen;
 * Hinweis auf den variable-claim im Manifest.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProjektVariable } from '@/lib/quests';
import { cn } from '@/lib/utils';

interface VariablenPanelProps {
  variablen: ProjektVariable[];
  onAnlegen: (v: ProjektVariable) => void;
  /** Blinkt 2× Mako, wenn ein Quick-Fix aus dem Inspektor eine Variable anlegt. */
  blink?: boolean;
}

const TYP_FARBE: Record<ProjektVariable['typ'], string> = {
  Zahl: 'border-info/40 text-info',
  Flag: 'border-warn/40 text-warn',
  Text: 'border-mako/40 text-mako',
};

export default function VariablenPanel({ variablen, onAnlegen, blink }: VariablenPanelProps) {
  const [offen, setOffen] = useState(true);
  const [editorOffen, setEditorOffen] = useState(false);
  const [name, setName] = useState('');
  const [typ, setTyp] = useState<ProjektVariable['typ']>('Zahl');
  const [wert, setWert] = useState('0');
  const [neuName, setNeuName] = useState<string | null>(null);

  const anlegen = () => {
    const bereinigt = name.trim();
    if (!bereinigt || variablen.some((v) => v.name === bereinigt)) return;
    const freieAdresse = Math.max(0, ...variablen.map((v) => v.adresse)) + 1;
    onAnlegen({ name: bereinigt, typ, wert: wert || '0', bank: 1, adresse: freieAdresse });
    setNeuName(bereinigt);
    window.setTimeout(() => setNeuName(null), 1600);
    setName('');
    setWert('0');
    setEditorOffen(false);
  };

  return (
    <motion.div
      className="border-t border-subtle"
      animate={blink ? { boxShadow: ['0 0 0 0 rgba(61,220,151,0)', '0 0 0 2px rgba(61,220,151,.6)', '0 0 0 0 rgba(61,220,151,0)', '0 0 0 2px rgba(61,220,151,.6)', '0 0 0 0 rgba(61,220,151,0)'] } : undefined}
      transition={{ duration: 1.2 }}
    >
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-elevated"
      >
        <motion.span animate={{ rotate: offen ? 0 : -90 }} transition={{ duration: 0.18 }}>
          <ChevronDown className="h-3.5 w-3.5 text-muted" />
        </motion.span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
          Projektvariablen
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted">{variablen.length}</span>
      </button>

      <AnimatePresence initial={false}>
        {offen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 px-3 pb-2">
              {variablen.map((v) => (
                <motion.div
                  key={v.name}
                  layout
                  initial={v.name === neuName ? { height: 0, opacity: 0 } : false}
                  animate={{ height: 'auto', opacity: 1 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-2 rounded border border-subtle/60 bg-inset px-2 py-1"
                >
                  <span
                    className={cn(
                      'truncate font-mono text-[11px]',
                      v.name === neuName ? 'animate-mako-pulse text-mako' : 'text-foreground',
                    )}
                  >
                    {v.name}
                  </span>
                  <span className={cn('shrink-0 rounded border px-1 text-[9px] font-medium', TYP_FARBE[v.typ])}>
                    {v.typ}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-secondary">{v.wert}</span>
                  <span className="shrink-0 font-mono text-[9px] text-muted" title={v.kommentar}>
                    B{v.bank}/A{v.adresse}
                  </span>
                </motion.div>
              ))}

              <p className="pt-1 text-[11px] leading-snug text-muted">
                Benannte Variablen erzeugen einen <span className="font-mono">variable-claim</span> im Manifest.
              </p>

              {editorOffen ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-1.5 rounded border border-subtle bg-panel p-2"
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name (z. B. gil)"
                    className="h-7 border-subtle bg-inset font-mono text-[11px]"
                    autoFocus
                  />
                  <div className="flex gap-1.5">
                    <Select value={typ} onValueChange={(v) => setTyp(v as ProjektVariable['typ'])}>
                      <SelectTrigger className="h-7 w-24 border-subtle bg-inset text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-subtle bg-popover">
                        <SelectItem value="Zahl" className="text-xs">Zahl</SelectItem>
                        <SelectItem value="Flag" className="text-xs">Flag</SelectItem>
                        <SelectItem value="Text" className="text-xs">Text</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={wert}
                      onChange={(e) => setWert(e.target.value)}
                      placeholder="Startwert"
                      className="h-7 flex-1 border-subtle bg-inset font-mono text-[11px]"
                    />
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setEditorOffen(false)}>
                      Abbrechen
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      /* Sekundär (MS17 §4): Quests-Primär-CTA ist „Knoten hinzufügen". */
                      className="h-6 border border-subtle px-2 text-[11px] text-secondary hover:bg-elevated hover:text-foreground"
                      onClick={anlegen}
                      disabled={!name.trim() || variablen.some((v) => v.name === name.trim())}
                    >
                      Anlegen
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full justify-start gap-1.5 px-2 text-[11px] text-secondary hover:text-foreground"
                  onClick={() => setEditorOffen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Variable
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
