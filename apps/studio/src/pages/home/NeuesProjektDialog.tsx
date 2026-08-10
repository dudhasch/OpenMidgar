/**
 * Dialog „Neues Projekt" (home.md Sektion 2, shadcn Dialog 480px).
 * modId mit Live-Validierung (reverse-DNS), Shake bei ungültigem Versuch,
 * Primärsprache + weitere Sprachen, engineCompat vorbefüllt.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MOD_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const WEITERE_SPRACHEN = ['Englisch', 'Französisch', 'Japanisch'];

interface NeuesProjektDialogProps {
  offen: boolean;
  onOpenChange: (offen: boolean) => void;
  onAnlegen: (name: string, modId: string) => void;
}

export default function NeuesProjektDialog({ offen, onOpenChange, onAnlegen }: NeuesProjektDialogProps) {
  const [name, setName] = useState('');
  const [modId, setModId] = useState('');
  const [sprache, setSprache] = useState('de');
  const [weitere, setWeitere] = useState<string[]>([]);
  const [engineCompat, setEngineCompat] = useState('>=0.4.0');
  const [shakeKey, setShakeKey] = useState(0);

  const modIdValide = useMemo(
    () => MOD_ID_PATTERN.test(modId) && modId.length >= 3 && modId.length <= 64,
    [modId],
  );
  const modIdFehler = modId.length > 0 && !modIdValide;

  const anlegen = () => {
    if (!modIdValide) {
      setShakeKey((k) => k + 1); // Fehler-Shake (300ms) nur auf explizitem Fehlversuch
      return;
    }
    onAnlegen(name.trim() || 'Meine erste Mod', modId);
    setName('');
    setModId('');
    setWeitere([]);
  };

  return (
    <Dialog open={offen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[480px] border-subtle bg-popover sm:max-w-[480px]">
        <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.18 }}>
          <DialogHeader>
            <DialogTitle className="font-display">Neues Projekt</DialogTitle>
            <DialogDescription className="text-secondary">
              Leere Mod anlegen: modId, Sprachen, engineCompat. In unter einer Minute startklar.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-name">Name</Label>
              <Input
                id="np-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Meine erste Mod"
                className="border-subtle bg-inset"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-modid">modId</Label>
              <motion.div
                key={shakeKey}
                animate={shakeKey > 0 ? { x: [0, -4, 4, -2, 0] } : undefined}
                transition={{ duration: 0.3 }}
              >
                <Input
                  id="np-modid"
                  value={modId}
                  onChange={(e) => setModId(e.target.value.toLowerCase())}
                  placeholder="de.beispiel.meinemod"
                  className={cn('border-subtle bg-inset font-mono', modIdFehler && 'border-error')}
                  aria-invalid={modIdFehler}
                />
              </motion.div>
              {modIdFehler && (
                <p className="text-[11px] text-error">
                  Reverse-DNS-Format erwartet, z. B. <span className="font-mono">de.beispiel.meinemod</span> (3–64
                  Zeichen, a–z, 0–9, Punkt, Bindestrich).
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Primärsprache</Label>
                <Select value={sprache} onValueChange={setSprache}>
                  <SelectTrigger className="border-subtle bg-inset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-subtle bg-popover">
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="en">Englisch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>engineCompat</Label>
                <Select value={engineCompat} onValueChange={setEngineCompat}>
                  <SelectTrigger className="border-subtle bg-inset font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-subtle bg-popover">
                    <SelectItem value=">=0.4.0" className="font-mono">≥ 0.4.0</SelectItem>
                    <SelectItem value=">=0.3.2 <0.5.0" className="font-mono">≥ 0.3.2 &lt; 0.5.0</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Weitere Sprachen</Label>
              <div className="flex gap-2">
                {WEITERE_SPRACHEN.map((s) => {
                  const aktiv = weitere.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setWeitere((w) => (aktiv ? w.filter((x) => x !== s) : [...w, s]))}
                      className={cn(
                        'rounded border px-2.5 py-1 text-xs transition-colors duration-150',
                        aktiv
                          ? 'border-mako bg-mako-dim text-mako'
                          : 'border-subtle bg-inset text-secondary hover:border-strong hover:text-foreground',
                      )}
                      aria-pressed={aktiv}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-secondary">
              Abbrechen
            </Button>
            <Button
              onClick={anlegen}
              disabled={!modIdValide}
              className="bg-mako text-primary-foreground hover:bg-mako-hover disabled:opacity-50"
            >
              Projekt anlegen
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
