/**
 * Generischer Seiten-Stub — Page-Agenten ersetzen diese Platzhalter
 * durch die vollen Editoren (dialoge.md, quests.md, charaktere.md,
 * felder.md, paket.md).
 */
import type { LucideIcon } from 'lucide-react';

interface PageStubProps {
  titel: string;
  beschreibung: string;
  icon: LucideIcon;
}

export default function PageStub({ titel, beschreibung, icon: Icon }: PageStubProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-subtle bg-panel">
        <Icon className="h-6 w-6 text-mako" />
      </div>
      <h1 className="font-display text-xl font-semibold tracking-tight">{titel}</h1>
      <p className="max-w-md text-[13px] text-secondary">{beschreibung}</p>
      <span className="rounded border border-subtle bg-panel px-2 py-1 font-mono text-[11px] text-muted">
        folgt — Editor in Arbeit
      </span>
    </div>
  );
}
