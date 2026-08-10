/**
 * DokumentListe — linke Sidebar des Dialog-Editors (dialoge.md Sektion 1).
 * Nach Field gruppiert, darunter je Sprach-Dokument. Filterfeld klappt auf,
 * Gruppen klappen auf/zu (height 180ms), Stagger beim Öffnen der Seite.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Plus, Search } from 'lucide-react';
import RefBadge from '@/components/shared/RefBadge';
import type { DialogDokument } from '@/lib/dialoge';
import { cn } from '@/lib/utils';

interface DokumentListeProps {
  dokumente: DialogDokument[];
  aktivId: string;
  onWaehlen: (id: string) => void;
  onNeu: () => void;
  /** Dokument-IDs mit offenem Befund (Punkt). */
  befundDocIds?: Set<string>;
}

interface Gruppe {
  field: string;
  fieldName: string;
  istReferenz: boolean;
  guardHash?: string;
  docs: DialogDokument[];
}

export default function DokumentListe({ dokumente, aktivId, onWaehlen, onNeu, befundDocIds }: DokumentListeProps) {
  const [filterOffen, setFilterOffen] = useState(false);
  const [filter, setFilter] = useState('');
  const [zugeklappt, setZugeklappt] = useState<Set<string>>(new Set());

  const gruppen = useMemo<Gruppe[]>(() => {
    const map = new Map<string, Gruppe>();
    for (const doc of dokumente) {
      if (!map.has(doc.field)) {
        map.set(doc.field, {
          field: doc.field,
          fieldName: doc.fieldName,
          istReferenz: doc.istReferenz,
          guardHash: doc.guardHash,
          docs: [],
        });
      }
      map.get(doc.field)!.docs.push(doc);
    }
    return [...map.values()];
  }, [dokumente]);

  const sichtbar = (doc: DialogDokument) =>
    !filter ||
    doc.id.toLowerCase().includes(filter.toLowerCase()) ||
    doc.fieldName.toLowerCase().includes(filter.toLowerCase()) ||
    doc.field.toLowerCase().includes(filter.toLowerCase());

  const toggleGruppe = (field: string) =>
    setZugeklappt((alt) => {
      const neu = new Set(alt);
      if (neu.has(field)) neu.delete(field);
      else neu.add(field);
      return neu;
    });

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-subtle bg-panel" aria-label="Dokumentliste">
      {/* Kopfzeile */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-subtle px-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Dialoge</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={onNeu}
            aria-label="Neues Dialog-Dokument"
            className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFilterOffen((v) => !v)}
            aria-label="Dokumente filtern"
            aria-expanded={filterOffen}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors duration-150',
              filterOffen ? 'bg-mako-dim text-mako' : 'text-secondary hover:bg-elevated hover:text-foreground',
            )}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filterfeld (blendet mit width/opacity ein) */}
      <AnimatePresence initial={false}>
        {filterOffen && (
          <motion.div
            className="shrink-0 overflow-hidden border-b border-subtle px-2"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 36, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Field oder Sprache filtern …"
              className="mt-1.5 h-6 w-full rounded border border-subtle bg-inset px-2 text-xs text-foreground placeholder:text-muted focus:outline-none"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gruppen */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {gruppen.map((gruppe, gi) => {
          const offen = !zugeklappt.has(gruppe.field);
          const docs = gruppe.docs.filter(sichtbar);
          if (filter && docs.length === 0) return null;
          return (
            <motion.div
              key={gruppe.field}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.06, duration: 0.2 }}
            >
              {/* Gruppenkopf */}
              <button
                type="button"
                onClick={() => toggleGruppe(gruppe.field)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-elevated"
                aria-expanded={offen}
              >
                <ChevronRight className={cn('h-3 w-3 text-muted transition-transform duration-150', offen && 'rotate-90')} />
                <span className="truncate font-mono text-[11px] text-secondary">{gruppe.field}</span>
                <span className="ml-auto truncate pl-2 text-[11px] text-muted">{gruppe.fieldName}</span>
              </button>

              {/* Sprach-Dokumente */}
              <AnimatePresence initial={false}>
                {offen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    {docs.map((doc) => {
                      const aktiv = doc.id === aktivId;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => onWaehlen(doc.id)}
                          className={cn(
                            'relative flex w-full items-center gap-2 py-1.5 pl-7 pr-2 text-left transition-colors duration-150',
                            aktiv ? 'bg-mako-dim' : 'hover:bg-elevated',
                          )}
                        >
                          {aktiv && <span className="absolute inset-y-0 left-0 w-0.5 bg-mako" />}
                          <span className="rounded bg-elevated px-1 py-px text-[10px] font-medium uppercase tracking-wide text-secondary">
                            {doc.locale}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                            {doc.pfad.split('/').slice(1).join('/')}
                            <span className="text-muted">/{doc.locale}</span>
                          </span>
                          {gruppe.istReferenz && doc.locale === 'de' && (
                            <RefBadge refId={gruppe.field} guardHash={gruppe.guardHash} className="hidden shrink-0 group-hover:inline-flex xl:inline-flex" />
                          )}
                          <span className="shrink-0 font-mono text-[11px] text-muted">{doc.eintraege.length}</span>
                          {befundDocIds?.has(doc.id) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-label="Befund" />}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </aside>
  );
}
