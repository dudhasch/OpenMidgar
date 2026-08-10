/**
 * LokalisierungPanel — rechter Inspektor (dialoge.md Sektion 4, 280px).
 * Block „Sprachen": DE-Karte (editierbar, aktiv = Mako-Rahmen) + EN-Karte mit
 * Status-Chip (übersetzt/veraltet/fehlt, Fallback-Befund). Klick schaltet den
 * Editor um. Block „Steuerelemente im Eintrag": klickbare Token-Liste
 * (springt zur Token-Position, Token pulsiert). Block „Referenz" (nur Delta):
 * RefBadge + guardHash mit Copy + Provenienz-Hinweis. Accordion-Animation.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, List, Palette, Pause, Variable } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import ProfiDisclosure from '@/components/shared/ProfiDisclosure';
import RefBadge from '@/components/shared/RefBadge';
import type { DialogDokument, DialogEintrag, DialogToken } from '@/lib/dialoge';
import { ersteZeile, kurzHash, tokenDesEintrags } from '@/lib/dialoge';
import { cn } from '@/lib/utils';

export type LokalStatus = 'uebersetzt' | 'veraltet' | 'fehlt';

interface LokalisierungPanelProps {
  doc: DialogDokument;
  /** EN-Pendant des aktiven Dokuments (für Fallback-Befund). */
  enDoc?: DialogDokument;
  eintrag: DialogEintrag | null;
  onLocaleWechsel: (locale: string) => void;
  onTokenKlick: (token: DialogToken, index: number) => void;
}

const TOKEN_META = {
  farbe: { icon: Palette, label: 'Farbe' },
  pause: { icon: Pause, label: 'Pause' },
  variable: { icon: Variable, label: 'Variable' },
  auswahl: { icon: List, label: 'Auswahl' },
} as const;

const STATUS_CHIP: Record<LokalStatus, { label: string; klasse: string }> = {
  uebersetzt: { label: 'übersetzt', klasse: 'border-mako/50 text-mako' },
  veraltet: { label: 'veraltet', klasse: 'border-warn/60 text-warn' },
  fehlt: { label: 'fehlt', klasse: 'border-subtle text-muted' },
};

export default function LokalisierungPanel({
  doc,
  enDoc,
  eintrag,
  onLocaleWechsel,
  onTokenKlick,
}: LokalisierungPanelProps) {
  const [kopiert, setKopiert] = useState(false);
  const tokens = eintrag ? tokenDesEintrags(eintrag) : [];

  /* Fallback-Befund: Status der EN-Übersetzung des aktiven Eintrags. */
  const enEintrag = eintrag && enDoc ? enDoc.eintraege.find((e) => e.id === eintrag.id) : undefined;
  const status: LokalStatus = !eintrag ? 'fehlt' : !enEintrag ? 'fehlt' : enEintrag.veraltet ? 'veraltet' : 'uebersetzt';

  const kopiereHash = (hash: string) => {
    void navigator.clipboard?.writeText(hash).catch(() => {});
    setKopiert(true);
    window.setTimeout(() => setKopiert(false), 1200);
  };

  return (
    <aside
      className="flex h-full w-[280px] shrink-0 flex-col overflow-y-auto border-l border-subtle bg-panel"
      aria-label="Lokalisierung und Referenz"
    >
      <div className="flex h-9 shrink-0 items-center border-b border-subtle px-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Lokalisierung &amp; Referenz</span>
      </div>

      <Accordion type="multiple" defaultValue={['sprachen', 'steuerelemente', 'referenz']} className="px-2">
        {/* Block: Sprachen */}
        <AccordionItem value="sprachen" className="border-subtle">
          <AccordionTrigger className="py-2 text-xs font-semibold text-foreground hover:no-underline">
            Sprachen
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-1.5 pb-2">
              <SprachKarte
                locale="de"
                label="Primärsprache"
                aktiv={doc.locale === 'de'}
                editierbar
                eintrag={doc.locale === 'de' ? eintrag : undefined}
                onKlick={() => onLocaleWechsel('de')}
              />
              <SprachKarte
                locale="en"
                label="Fallback"
                aktiv={doc.locale === 'en'}
                status={status}
                eintrag={doc.locale === 'en' ? eintrag : enEintrag}
                onKlick={() => onLocaleWechsel('en')}
              />
              {status !== 'uebersetzt' && eintrag && (
                <p className={cn('mt-1 rounded border px-2 py-1.5 text-[11px]', status === 'veraltet' ? 'border-warn/40 text-warn' : 'border-subtle text-muted')}>
                  {status === 'veraltet'
                    ? 'Fallback-Befund: Primärtext ist neuer — Übersetzung veraltet (Info im Dock).'
                    : 'Fallback-Befund: Keine EN-Übersetzung für diesen Eintrag — Engine fällt auf DE zurück.'}
                </p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Block: Steuerelemente im Eintrag */}
        <AccordionItem value="steuerelemente" className="border-subtle">
          <AccordionTrigger className="py-2 text-xs font-semibold text-foreground hover:no-underline">
            Steuerelemente im Eintrag
            {tokens.length > 0 && <span className="ml-1 font-mono text-[10px] text-muted">{tokens.length}</span>}
          </AccordionTrigger>
          <AccordionContent>
            {tokens.length === 0 ? (
              <p className="pb-2 text-[11px] text-muted">Keine Steuerelemente — über die Toolbar einfügen.</p>
            ) : (
              <div className="flex flex-col gap-0.5 pb-2">
                {tokens.map((token, i) => {
                  const meta = TOKEN_META[token.art];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onTokenKlick(token, i)}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-150 hover:bg-elevated"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-engine" />
                      <span className="text-xs text-foreground">{meta.label}</span>
                      <span className="ml-auto truncate font-mono text-[11px] text-secondary">{token.roh}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Block: Referenz (nur bei Delta-Einträgen) */}
        {eintrag?.delta && (
          <AccordionItem value="referenz" className="border-subtle">
            <AccordionTrigger className="py-2 text-xs font-semibold text-foreground hover:no-underline">
              Referenz
            </AccordionTrigger>
            <AccordionContent>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-2 rounded border border-engine/25 bg-engine/[0.06] p-2.5 pb-3"
              >
                <RefBadge refId={doc.field} guardHash={kurzHash(eintrag.delta.guardHash)} className="self-start text-[11px]" />
                {/* guardHash-Detailzeilen: Profi-Elemente (MS17), per Disclosure erreichbar */}
                <ProfiDisclosure panelId={`dialog-referenz-${doc.id}`} anzahl={eintrag.delta.ersetztOriginalIndex !== undefined ? 2 : 1}>
                  <div data-profi className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted">guardHash</span>
                    <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                      {eintrag.delta.guardHash}
                    </code>
                    <button
                      type="button"
                      onClick={() => kopiereHash(eintrag.delta!.guardHash)}
                      aria-label="guardHash kopieren"
                      className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
                    >
                      {kopiert ? <Check className="h-3.5 w-3.5 text-mako" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {eintrag.delta.ersetztOriginalIndex !== undefined && (
                    <p data-profi className="mt-1.5 font-mono text-[11px] text-muted">
                      ersetzt Originalindex #{eintrag.delta.ersetztOriginalIndex}
                    </p>
                  )}
                </ProfiDisclosure>
                <p className="text-[11px] leading-relaxed text-secondary">
                  Dieses Delta ersetzt den Originaltext zur Laufzeit. Das Original bleibt unverändert im Spielarchiv.
                </p>
              </motion.div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

interface SprachKarteProps {
  locale: string;
  label: string;
  aktiv: boolean;
  editierbar?: boolean;
  status?: LokalStatus;
  eintrag?: DialogEintrag | null;
  onKlick: () => void;
}

function SprachKarte({ locale, label, aktiv, editierbar, status, eintrag, onKlick }: SprachKarteProps) {
  return (
    <motion.button
      type="button"
      onClick={onKlick}
      layout
      whileTap={{ scale: 0.99 }}
      className={cn(
        'w-full rounded-md border p-2 text-left transition-colors duration-200',
        aktiv ? 'border-mako/60 bg-mako-dim' : 'border-subtle bg-inset hover:border-strong hover:bg-elevated',
      )}
      aria-pressed={aktiv}
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-elevated px-1 py-px text-[10px] font-medium uppercase tracking-wide text-secondary">
          {locale}
        </span>
        <span className="text-[11px] text-muted">{label}</span>
        {editierbar && aktiv && <span className="ml-auto text-[10px] font-medium text-mako">aktiv · editierbar</span>}
        {status && (
          <motion.span
            key={status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className={cn('ml-auto rounded border px-1 py-px text-[10px] font-medium', STATUS_CHIP[status].klasse)}
          >
            {STATUS_CHIP[status].label}
          </motion.span>
        )}
      </div>
      <p className={cn('mt-1 truncate text-xs', eintrag ? 'text-secondary' : 'italic text-muted')}>
        {eintrag ? ersteZeile(eintrag) : 'Kein Eintrag in dieser Sprache'}
      </p>
    </motion.button>
  );
}
