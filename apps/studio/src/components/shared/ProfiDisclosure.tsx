/**
 * ProfiDisclosure — lokales „Profi-Optionen"-Disclosure-Pattern je Panel
 * (vereinfachung.md §1.4).
 *
 * Im Einfach-Modus zeigt das Panel am Panel-Fuß eine dezente Zeile
 * (ChevronRight + „Profi-Optionen (n)"), die die `data-profi`-Inhalte des
 * Panels einklappt statt sie zu verstecken. Die expandierte Sektion zeigt
 * die IDENTISCHEN Controls direkt darunter (gleiche Bindings, kein
 * Klon-UI): Die Kinder tragen selbst `data-profi`; der geöffnete Container
 * setzt `data-profi-offen`, und die CSS-Ausnahme in index.css
 * (`… [data-profi]:not([data-profi-offen] *)`) lässt sie sichtbar.
 *
 * Im Profi-Modus ist die Disclosure ausgeblendet (Inhalte sind ohnehin
 * sichtbar) — gerendert werden nur die Kinder.
 *
 * Die Expansion ist unabhängig vom globalen Modus und wird pro Panel in
 * der Session gemerkt (Modul-Map, überlebt Panel-Wechsel, kein Reload).
 *
 * Zwei Einsatzformen:
 * 1) Inline (Default): Kinder werden unter der Zeile expandiert.
 * 2) Gestreute Elemente (z. B. Tabellen-Spalten): gesteuert über
 *    `offen`/`onToggle` ohne Kinder — der Aufrufer setzt `data-profi-offen`
 *    dann selbst auf einen gemeinsamen Vorfahren der data-profi-Elemente
 *    (Beispiel: BefundDock „Technikspalten").
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useUiModus } from '@/lib/ui-modus';
import { cn } from '@/lib/utils';

/* Session-Gedächtnis der lokalen Expansionen (pro Panel, kein Reload). */
const expansions = new Map<string, boolean>();

interface ProfiDisclosureProps {
  /** Stabiler Schlüssel für das Session-Gedächtnis (z. B. 'quest-inspektor'). */
  panelId: string;
  /** Anzahl der verborgenen Profi-Elemente — wird als „(n)" gezeigt. */
  anzahl: number;
  /** Zeilen-Beschriftung, Default „Profi-Optionen". */
  titel?: string;
  /** Inline-Kinder (werden unter der Zeile expandiert). */
  children?: ReactNode;
  /** Gesteuerte Variante für gestreute data-profi-Elemente. */
  offen?: boolean;
  onToggle?: (offen: boolean) => void;
  className?: string;
}

export default function ProfiDisclosure({
  panelId,
  anzahl,
  titel = 'Profi-Optionen',
  children,
  offen,
  onToggle,
  className,
}: ProfiDisclosureProps) {
  const { istEinfach } = useUiModus();
  const [internOffen, setInternOffen] = useState(() => expansions.get(panelId) ?? false);

  const gesteuert = offen !== undefined;
  const istOffen = gesteuert ? offen : internOffen;

  const toggle = () => {
    const neu = !istOffen;
    if (gesteuert) onToggle?.(neu);
    else {
      expansions.set(panelId, neu);
      setInternOffen(neu);
    }
  };

  /* Profi-Modus: Inhalte ohnehin sichtbar — keine Disclosure, nur Kinder. */
  if (!istEinfach) return <>{children}</>;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={istOffen}
        className="flex items-center gap-1 text-[12px] text-secondary transition-colors duration-150 hover:text-foreground"
      >
        <motion.span animate={{ rotate: istOffen ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight className="h-3.5 w-3.5 text-muted" />
        </motion.span>
        {titel} <span className="font-mono text-[10px] text-muted">({anzahl})</span>
      </button>

      <AnimatePresence initial={false}>
        {istOffen && children !== undefined && (
          <motion.div
            key="profi-inhalt"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn('overflow-hidden')}
          >
            {/* data-profi-offen: CSS-Ausnahme in index.css macht die
                data-profi-Kinder im Einfach-Modus sichtbar. */}
            <div data-profi-offen className="mt-2 border-t border-dashed border-subtle pt-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
