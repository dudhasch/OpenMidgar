/**
 * AppShell — IDE-Shell-Raster (design.md Abschnitt 5):
 * TopBar (48px) oben, ActivityRail (48px) links, Inhalts-Slot in der Mitte,
 * Befund-Dock unten im Inhaltsbereich, StatusBar (28px) ganz unten.
 * Seiten werden als nested Routes über <Outlet/> gerendert (Pattern B).
 */
import { Outlet, useLocation } from 'react-router-dom';
import TopBar from '@/components/shell/TopBar';
import ActivityRail from '@/components/shell/ActivityRail';
import StatusBar from '@/components/shell/StatusBar';
import BefundDock from '@/components/shell/BefundDock';
import CommandPalette from '@/components/shared/CommandPalette';
import { useAppState } from '@/lib/app-state';

export default function AppShell() {
  const { dockOffen } = useAppState();
  const { pathname } = useLocation();
  const istHome = pathname === '/';

  return (
    <div
      className="grid h-[100dvh] w-full overflow-hidden bg-app text-foreground"
      style={{ gridTemplateRows: '48px minmax(0, 1fr) 28px' }}
    >
      <TopBar />
      <div className="flex min-h-0">
        <ActivityRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-auto bg-app">
            <Outlet />
          </main>
          {/* Auf Home ist das Dock standardmäßig ausgeblendet (home.md),
              lässt sich aber über die Befund-Pills einblenden. */}
          {(!istHome || dockOffen) && <BefundDock />}
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
