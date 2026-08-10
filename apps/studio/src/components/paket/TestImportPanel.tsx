/**
 * TestImportPanel — „Im Spiel testen" (paket.md Sektion 6):
 * deaktivierter Testimport-Button (Opacity .55, Cursor not-allowed,
 * Tooltip per Hover und Fokus) + Info-Zeile zum Manifest-v2-Import-Hook.
 */
import { FlaskConical, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import PaketPanel from '@/components/paket/PaketPanel';

export default function TestImportPanel() {
  return (
    <PaketPanel titel="Im Spiel testen">
      <div className="flex flex-col gap-2.5">
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Wrapper-Span: deaktivierte Buttons feuern keine Hover-/Fokus-Events. */}
              <span tabIndex={0} className="block cursor-not-allowed rounded-md focus-visible:outline-none">
                <Button variant="ghost" disabled className="h-9 w-full gap-2 border border-subtle text-[12px] opacity-55">
                  <FlaskConical className="h-4 w-4" />
                  Testimport in WebMidgar
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72 text-xs">
              Engine-Import folgt mit S19 — bis dahin: <span className="font-mono">.wmmod</span> herunterladen und
              manuell in die Engine legen.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-secondary">
          <Info className="mt-0.5 h-3 w-3 shrink-0 text-info" />
          Der Import-Hook (<span className="font-mono">engine.importPackage</span>) ist im Manifest v2 bereits
          vorgesehen.
        </p>
      </div>
    </PaketPanel>
  );
}
