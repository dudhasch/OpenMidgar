/**
 * ActivityRail (links, 48px) — vertikale Icon-Navigation mit
 * Mako-Kante (framer-motion layoutId) und Label-Tooltips (design.md 5.2).
 */
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Map, MessageSquare, Package, Skull, Swords, UserRound, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const EINTRAEGE: { route: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { route: '/', label: 'Projekt-Start', icon: Home, end: true },
  { route: '/dialoge', label: 'Dialoge', icon: MessageSquare },
  { route: '/quests', label: 'Quests / Scripts', icon: Workflow },
  { route: '/charaktere', label: 'Charaktere', icon: UserRound },
  { route: '/felder', label: 'Felder', icon: Map },
  { route: '/gegner', label: 'Gegner', icon: Skull },
  { route: '/schlacht', label: 'Schlachten', icon: Swords },
  { route: '/paket', label: 'Paket / Publish', icon: Package },
];

export default function ActivityRail() {
  return (
    <nav
      className="flex w-12 flex-col items-center gap-1 border-r border-subtle bg-panel py-2"
      aria-label="Bereiche"
    >
      <TooltipProvider delayDuration={150}>
        {EINTRAEGE.map(({ route, label, icon: Icon, end }) => (
          <NavLink key={route} to={route} end={end} className="relative block">
            {({ isActive }) => (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'relative flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-150',
                      isActive ? 'text-mako' : 'text-muted hover:bg-elevated hover:text-foreground',
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="rail-indicator"
                        className="absolute left-[-9px] top-1.5 h-7 w-0.5 rounded-full bg-mako"
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                      />
                    )}
                    <Icon className="h-5 w-5" />
                    <span className="sr-only">{label}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            )}
          </NavLink>
        ))}
      </TooltipProvider>
    </nav>
  );
}
