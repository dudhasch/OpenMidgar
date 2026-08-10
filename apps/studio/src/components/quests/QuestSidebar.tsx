/**
 * QuestSidebar — linke Sidebar (240px) mit zwei Tabs „Scripts" | „Palette"
 * (quests.md Sektion 1). Scripts-Tab: Quest-Sicht-Umschalter [Graph|Quest],
 * Script-Liste mit Trigger-Chips + Knotenzahl, darunter VariablenPanel.
 * Tab-Wechsel: x ±12px + opacity 200ms.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Workflow } from 'lucide-react';
import type { SlotArt } from '@webmidgar/studio-core';
import KnotenPalette from '@/components/quests/KnotenPalette';
import type { PaletteDragPayload } from '@/components/quests/KnotenPalette';
import VariablenPanel from '@/components/quests/VariablenPanel';
import type { ProjektVariable } from '@/lib/quests';
import { cn } from '@/lib/utils';

export type EditorSicht = 'graph' | 'quest';
export type SidebarTab = 'scripts' | 'palette';

interface ScriptEintrag {
  name: string;
  slots: SlotArt[];
  knotenzahl: number;
  aktiv: boolean;
}

interface QuestSidebarProps {
  tab: SidebarTab;
  onTab: (t: SidebarTab) => void;
  sicht: EditorSicht;
  onSicht: (s: EditorSicht) => void;
  scripts: ScriptEintrag[];
  variablen: ProjektVariable[];
  onVariableAnlegen: (v: ProjektVariable) => void;
  variablenBlink?: boolean;
  onPaletteHinzufuegen: (payload: PaletteDragPayload) => void;
  /** Öffnet den Wizard „Neues Script" (MS17). */
  onNeuesScript?: () => void;
}

export default function QuestSidebar({
  tab,
  onTab,
  sicht,
  onSicht,
  scripts,
  variablen,
  onVariableAnlegen,
  variablenBlink,
  onPaletteHinzufuegen,
  onNeuesScript,
}: QuestSidebarProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-subtle bg-panel">
      {/* Tab-Köpfe */}
      <div className="flex shrink-0 border-b border-subtle">
        {(
          [
            { id: 'scripts', label: 'Scripts' },
            { id: 'palette', label: 'Palette' },
          ] as { id: SidebarTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            className={cn(
              'relative flex-1 px-3 py-2 text-[12px] font-medium transition-colors duration-150',
              tab === t.id ? 'text-foreground' : 'text-secondary hover:text-foreground',
            )}
          >
            {t.label}
            {tab === t.id && (
              <motion.span
                layoutId="quest-sidebar-tab"
                className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-mako"
                transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab-Inhalt (x ±12px + opacity 200ms) */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {tab === 'scripts' ? (
            <motion.div
              key="scripts"
              initial={{ x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -12, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex h-full flex-col overflow-y-auto"
            >
              {/* Quest-Sicht-Umschalter */}
              <div className="shrink-0 p-3 pb-2">
                <div className="flex rounded-md border border-subtle bg-inset p-0.5">
                  {(
                    [
                      { id: 'graph', label: 'Graph' },
                      { id: 'quest', label: 'Quest' },
                    ] as { id: EditorSicht; label: string }[]
                  ).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSicht(s.id)}
                      className={cn(
                        'relative flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors duration-150',
                        sicht === s.id ? 'text-background' : 'text-secondary hover:text-foreground',
                      )}
                    >
                      {sicht === s.id && (
                        <motion.span
                          layoutId="quest-sicht-segment"
                          className="absolute inset-0 rounded bg-mako"
                          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        />
                      )}
                      <span className="relative">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Script-Liste */}
              <div className="shrink-0 space-y-1 px-3 pb-2">
                <div className="flex items-center justify-between pb-1">
                  <p className="text-[10px] uppercase tracking-[0.06em] text-muted">Script-Graphen</p>
                  {onNeuesScript && (
                    <button
                      type="button"
                      onClick={onNeuesScript}
                      aria-label="Neues Script"
                      title="Neues Script (Wizard)"
                      className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-elevated hover:text-mako"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {scripts.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors duration-150',
                      s.aktiv
                        ? 'border-mako/40 bg-mako-dim'
                        : 'border-subtle bg-inset hover:bg-elevated',
                    )}
                  >
                    <Workflow className="h-3.5 w-3.5 shrink-0 text-mako" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-foreground">{s.name}</span>
                      <span className="mt-0.5 flex items-center gap-1">
                        {s.slots.map((slot) => (
                          <span
                            key={slot}
                            className="rounded border border-subtle bg-panel px-1 font-mono text-[9px] leading-4 text-secondary"
                          >
                            {slot}
                          </span>
                        ))}
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">
                          {s.knotenzahl} Knoten
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              {/* Projektvariablen */}
              <VariablenPanel variablen={variablen} onAnlegen={onVariableAnlegen} blink={variablenBlink} />
            </motion.div>
          ) : (
            <motion.div
              key="palette"
              initial={{ x: 12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 12, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              className="h-full overflow-y-auto"
            >
              <KnotenPalette onHinzufuegen={onPaletteHinzufuegen} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}
