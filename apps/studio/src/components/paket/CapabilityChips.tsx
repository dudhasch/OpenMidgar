/**
 * CapabilityChips — abgeleitete Capability-Liste (paket.md Sektion 3):
 * read-only, live aus dem Projektinhalt ermittelt (src/lib/paket.ts),
 * Chips mit Icon + Mono-Label, Stagger 40ms beim ersten Laden.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  Braces,
  FileDiff,
  Image as ImageIcon,
  Map as MapIcon,
  MessageSquare,
  MessageSquarePlus,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import PaketPanel from '@/components/paket/PaketPanel';
import type { CapabilityInfo } from '@/lib/paket';

const ICONS: Record<CapabilityInfo['icon'], LucideIcon> = {
  'dialog-replace': MessageSquare,
  'dialog-add': MessageSquarePlus,
  script: Workflow,
  entity: UserRound,
  field: MapIcon,
  patch: FileDiff,
  variablen: Braces,
  textur: ImageIcon,
};

export default function CapabilityChips({ capabilities }: { capabilities: CapabilityInfo[] }) {
  return (
    <PaketPanel titel="Capabilities (abgeleitet)">
      <p className="mb-2.5 text-[11px] text-muted">
        Automatisch aus dem Projektinhalt ermittelt — nicht editierbar. Grundlage des Manifest-Vertrags.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence>
          {capabilities.map((cap, i) => {
            const Icon = ICONS[cap.icon];
            return (
              <motion.span
                key={cap.key}
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.3 } }}
                transition={{ duration: 0.2, delay: i * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center gap-1.5 rounded border border-subtle bg-elevated px-2 py-1 font-mono text-[11px] text-foreground transition-colors duration-150 hover:border-strong">
                        <Icon className="h-3.5 w-3.5 text-mako" />
                        {cap.key}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64 text-xs">
                      {cap.beschreibung}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>
    </PaketPanel>
  );
}
