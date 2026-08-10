/**
 * Fußzeile der Startseite (home.md Sektion 5) — statisch, Links mit
 * Engine-Blau-Hover. „Tastenkürzel“ und „Über“ öffnen Modals.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { studioVersionen } from '@/lib/mock-project';

const SHORTCUTS: { tasten: string[]; aktion: string }[] = [
  { tasten: ['⌘', 'K'], aktion: 'Command-Palette öffnen' },
  { tasten: ['Strg', 'S'], aktion: 'Alles speichern' },
  { tasten: ['⌘', '↵'], aktion: 'Validieren' },
  { tasten: ['Esc'], aktion: 'Dialog / Palette schließen' },
];

export default function HomeFooter() {
  const [modal, setModal] = useState<'shortcuts' | 'ueber' | null>(null);

  return (
    <footer className="mt-10 flex items-center justify-between border-t border-subtle pt-4 pb-2 text-[11px] text-muted">
      <p>WebMidgar Studio — Clean-Room-Modding, Originalinhalte werden nur referenziert.</p>
      <nav className="flex gap-4">
        <button type="button" className="transition-colors duration-150 hover:text-engine" onClick={() => setModal('ueber')}>
          Dokumentation
        </button>
        <button type="button" className="transition-colors duration-150 hover:text-engine" onClick={() => setModal('shortcuts')}>
          Tastenkürzel
        </button>
        <button type="button" className="transition-colors duration-150 hover:text-engine" onClick={() => setModal('ueber')}>
          Über
        </button>
      </nav>

      <Dialog open={modal === 'shortcuts'} onOpenChange={() => setModal(null)}>
        <DialogContent className="border-subtle bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Tastenkürzel</DialogTitle>
            <DialogDescription className="text-secondary">Globale Shortcuts der Suite.</DialogDescription>
          </DialogHeader>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.aktion} className="border-b border-subtle/60 last:border-0">
                  <td className="py-2">
                    <span className="flex gap-1">
                      {s.tasten.map((t) => (
                        <Kbd key={t}>{t}</Kbd>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 text-right text-secondary">{s.aktion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'ueber'} onOpenChange={() => setModal(null)}>
        <DialogContent className="border-subtle bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Über WebMidgar Studio</DialogTitle>
            <DialogDescription className="text-secondary">
              Eigenständige Modding-Suite — separat vom Spiel, lokaler Projektspeicher (IndexedDB), kein Backend.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <p className="font-mono text-[11px] text-muted">{studioVersionen}</p>
            <p className="text-[13px] text-secondary">
              Clean-Room-Prinzip: Originalinhalte der Engine werden ausschließlich referenziert (guardHash-verankert),
              niemals kopiert oder weitergegeben. Pakete enthalten nur eigene Inhalte und Deltas.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </footer>
  );
}
