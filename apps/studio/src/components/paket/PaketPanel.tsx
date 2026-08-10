/**
 * PaketPanel — einheitlicher Panel-Rahmen der Paket-Seite
 * (bg-panel, 1px-Linie, kompakter Titel in Space Grotesk).
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PaketPanelProps {
  titel: string;
  /** Optionale Aktionen rechts in der Titelzeile. */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function PaketPanel({ titel, right, children, className }: PaketPanelProps) {
  return (
    <section className={cn('rounded-lg border border-subtle bg-panel shadow-elevated', className)}>
      <header className="flex h-10 items-center justify-between border-b border-subtle px-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">{titel}</h2>
        {right}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
