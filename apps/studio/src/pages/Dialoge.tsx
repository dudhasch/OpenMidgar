/**
 * Dialog-Editor (`#/dialoge`) — Säule Text (dialoge.md).
 * Dokumentliste (Field × Sprache) links, Eintragsliste mit schreibgeschützten
 * Original-Referenzzeilen + „Ersetzen"→Delta-Flow in der Mitte, Seiten-Editor
 * mit Steuerelement-Toolbar und live FF7-Dialogbox-Vorschau rechts daneben,
 * Inspektor (Lokalisierung & Referenz) ganz rechts. Zustand lokal (useState),
 * Mock-Store bleibt unverändert.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FilePlus2, MessagesSquare, Shield } from 'lucide-react';
import { toast } from 'sonner';
import DokumentListe from '@/components/dialoge/DokumentListe';
import EintragsListe from '@/components/dialoge/EintragsListe';
import type { Zeile } from '@/components/dialoge/EintragsListe';
import TokenToolbar from '@/components/dialoge/TokenToolbar';
import SeitenEditor from '@/components/dialoge/SeitenEditor';
import type { SeitenEditorHandle, TokenBlink } from '@/components/dialoge/SeitenEditor';
import FF7Vorschau from '@/components/dialoge/FF7Vorschau';
import LokalisierungPanel from '@/components/dialoge/LokalisierungPanel';
import EmptyState from '@/components/shared/EmptyState';
import WizardDialog from '@/components/shared/WizardDialog';
import { wizardSlug } from '@/components/shared/WizardDialog';
import type { DialogDokument, DialogEintrag, DialogToken } from '@/lib/dialoge';
import { ORIGINAL_ZEILEN, baueDokumente, parseSegmente, zeichenZahl } from '@/lib/dialoge';

let idZaehler = 0;
const neuId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idZaehler++).toString(36)}`;
const neuHash = () =>
  Array.from({ length: 8 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

/** Baut die Anfangs-Zeilen (Referenzzeilen + Einträge) je Dokument. */
function anfangsZeilen(doc: DialogDokument): Zeile[] {
  const refs = doc.istReferenz && doc.locale === 'de' ? (ORIGINAL_ZEILEN[doc.fieldSlug] ?? []) : [];
  return [
    ...refs.map((ref): Zeile => ({ typ: 'referenz', ref })),
    ...doc.eintraege.map((eintrag): Zeile => ({ typ: 'eintrag', eintrag })),
  ];
}

export default function DialogePage() {
  const [dokumente, setDokumente] = useState<DialogDokument[]>(() => baueDokumente());
  const [zeilenProDoc, setZeilenProDoc] = useState<Record<string, Zeile[]>>(() =>
    Object.fromEntries(baueDokumente().map((d) => [d.id, anfangsZeilen(d)])),
  );
  const [aktivDocId, setAktivDocId] = useState('md1_1/de');
  const [aktivEintragId, setAktivEintragId] = useState<string | null>('dlg:md1_1/lina-gruss');
  const [aktivSeite, setAktivSeite] = useState(0);
  const [sortiert, setSortiert] = useState(false);
  const [editorAnteil, setEditorAnteil] = useState(55);
  const [flash, setFlash] = useState<TokenBlink | null>(null);
  const [puls, setPuls] = useState<TokenBlink | null>(null);
  const [wizardOffen, setWizardOffen] = useState(false);
  const editorRef = useRef<SeitenEditorHandle>(null);
  const location = useLocation();
  const navigate = useNavigate();

  /* Schnellaktion (Home) öffnet den Wizard via location.state. */
  useEffect(() => {
    if ((location.state as { wizard?: boolean } | null)?.wizard) {
      setWizardOffen(true);
      navigate('.', { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Undo/Redo: Snapshots der Seiten des aktiven Eintrags. */
  const [rueck, setRueck] = useState<string[]>([]);
  const [vor, setVor] = useState<string[]>([]);

  const doc = dokumente.find((d) => d.id === aktivDocId) ?? dokumente[0]!;
  const zeilen = useMemo(() => zeilenProDoc[doc.id] ?? [], [zeilenProDoc, doc.id]);
  const sichtbareZeilen = useMemo(
    () =>
      sortiert
        ? [...zeilen].sort((a, b) => {
            const sa = a.typ === 'eintrag' ? (a.eintrag.sprecher ?? '') : a.ref.sprecher;
            const sb = b.typ === 'eintrag' ? (b.eintrag.sprecher ?? '') : b.ref.sprecher;
            return sa.localeCompare(sb, 'de');
          })
        : zeilen,
    [zeilen, sortiert],
  );

  const eintrag = useMemo(() => {
    const z = zeilen.find((zl) => zl.typ === 'eintrag' && zl.eintrag.id === aktivEintragId);
    return z && z.typ === 'eintrag' ? z.eintrag : null;
  }, [zeilen, aktivEintragId]);

  const enDoc = dokumente.find((d) => d.field === doc.field && d.locale === 'en' && d.id !== doc.id);

  /* ------------------------------------------------ Mutationen ------ */

  const setzeZeilen = useCallback(
    (docId: string, updater: (alt: Zeile[]) => Zeile[]) => {
      setZeilenProDoc((alt) => ({ ...alt, [docId]: updater(alt[docId] ?? []) }));
    },
    [],
  );

  const aktualisiereEintrag = useCallback(
    (eintragId: string, updater: (alt: DialogEintrag) => DialogEintrag) => {
      setzeZeilen(doc.id, (alt) =>
        alt.map((z) => (z.typ === 'eintrag' && z.eintrag.id === eintragId ? { typ: 'eintrag', eintrag: updater(z.eintrag) } : z)),
      );
    },
    [doc.id, setzeZeilen],
  );

  const snapshot = (e: DialogEintrag) => JSON.stringify(e.seiten);

  const onSeiteText = useCallback(
    (idx: number, text: string) => {
      if (!eintrag) return;
      setRueck((r) => [...r.slice(-49), snapshot(eintrag)]);
      setVor([]);
      aktualisiereEintrag(eintrag.id, (alt) => ({
        ...alt,
        seiten: alt.seiten.map((s, i) => (i === idx ? { ...s, text } : s)),
      }));
    },
    [eintrag, aktualisiereEintrag],
  );

  const onUndo = useCallback(() => {
    if (!eintrag || rueck.length === 0) return;
    const ziel = rueck[rueck.length - 1]!;
    setVor((v) => [...v, snapshot(eintrag)]);
    setRueck((r) => r.slice(0, -1));
    aktualisiereEintrag(eintrag.id, (alt) => ({ ...alt, seiten: JSON.parse(ziel) }));
  }, [eintrag, rueck, aktualisiereEintrag]);

  const onRedo = useCallback(() => {
    if (!eintrag || vor.length === 0) return;
    const ziel = vor[vor.length - 1]!;
    setRueck((r) => [...r, snapshot(eintrag)]);
    setVor((v) => v.slice(0, -1));
    aktualisiereEintrag(eintrag.id, (alt) => ({ ...alt, seiten: JSON.parse(ziel) }));
  }, [eintrag, vor, aktualisiereEintrag]);

  /* ----------------------------------------------- Aktionen --------- */

  const waehleDokument = (id: string) => {
    setAktivDocId(id);
    setAktivSeite(0);
    setRueck([]);
    setVor([]);
    const erste = (zeilenProDoc[id] ?? []).find((z) => z.typ === 'eintrag');
    setAktivEintragId(erste && erste.typ === 'eintrag' ? erste.eintrag.id : null);
  };

  const waehleEintrag = (id: string) => {
    setAktivEintragId(id);
    setAktivSeite(0);
    setRueck([]);
    setVor([]);
  };

  /* Wizard-first-Erzeugung (MS17): Kernwahl = neuer Eintrag vs. Delta auf
     Original-Dialog. Defaults: Field-Bezug, Sprache = Primärsprache (de). */
  const wizardErstellen = ({ name, kern }: { name: string; kern: string }) => {
    const istDelta = kern === 'delta';
    const slug = istDelta ? 'md1_1' : wizardSlug(name);
    const basisId = `${slug}/de`;
    const id = dokumente.some((d) => d.id === basisId) ? `${slug}-delta/de` : basisId;
    const neu: DialogDokument = istDelta
      ? {
          id,
          field: 'field:md1_1',
          fieldName: 'MD1_1 (Delta)',
          fieldSlug: 'md1_1',
          locale: 'de',
          pfad: 'dialogues/md1_1',
          istReferenz: true,
          guardHash: neuHash(),
          eintraege: [],
        }
      : {
          id,
          field: `mod:de.beispiel.nebenquest/field/${slug}`,
          fieldName: name,
          fieldSlug: slug,
          locale: 'de',
          pfad: `dialogues/${slug}`,
          istReferenz: false,
          eintraege: [],
        };
    setDokumente((alt) => [...alt, neu]);
    setZeilenProDoc((alt) => ({ ...alt, [neu.id]: anfangsZeilen(neu) }));
    waehleDokument(neu.id);
    toast(`„${name}" erstellt`, {
      description: istDelta
        ? 'Delta-Dokument auf Original-Dialog — Referenzzeilen sind geladen, per „Ersetzen" überschreiben.'
        : neu.pfad + '/de',
    });
  };

  const neuerEintrag = () => {
    const neu: DialogEintrag = { id: neuId(`dlg:${doc.fieldSlug}/eintrag`), seiten: [{ text: '' }] };
    setzeZeilen(doc.id, (alt) => [...alt, { typ: 'eintrag', eintrag: neu }]);
    waehleEintrag(neu.id);
  };

  const dupliziereEintrag = (id: string) => {
    setzeZeilen(doc.id, (alt) => {
      const i = alt.findIndex((z) => z.typ === 'eintrag' && z.eintrag.id === id);
      const z = alt[i];
      if (!z || z.typ !== 'eintrag') return alt;
      const kopie: DialogEintrag = {
        ...JSON.parse(JSON.stringify(z.eintrag)),
        id: neuId(`${z.eintrag.id}-kopie`),
        delta: z.eintrag.delta ? { ...z.eintrag.delta, guardHash: neuHash() } : undefined,
      };
      return [...alt.slice(0, i + 1), { typ: 'eintrag', eintrag: kopie }, ...alt.slice(i + 1)];
    });
  };

  const loescheEintrag = (id: string) => {
    setzeZeilen(doc.id, (alt) => {
      const i = alt.findIndex((z) => z.typ === 'eintrag' && z.eintrag.id === id);
      const z = alt[i];
      if (!z || z.typ !== 'eintrag') return alt;
      const rest = [...alt.slice(0, i), ...alt.slice(i + 1)];
      // Delta entfernt → Original-Referenzzeile wiederherstellen.
      if (z.eintrag.refId) {
        const ref = (ORIGINAL_ZEILEN[doc.fieldSlug] ?? []).find((r) => r.id === z.eintrag.refId);
        if (ref) return [...rest.slice(0, i), { typ: 'referenz' as const, ref }, ...rest.slice(i)];
      }
      return rest;
    });
    if (aktivEintragId === id) setAktivEintragId(null);
  };

  /* „Ersetzen"-Flow: Referenzzeile → editierbarer Delta-Eintrag. */
  const ersetzeReferenz = (refId: string) => {
    const neu: DialogEintrag = {
      id: neuId(`dlg:${doc.fieldSlug}/delta`),
      seiten: [{ text: '' }],
      refId,
    };
    setzeZeilen(doc.id, (alt) =>
      alt.map((z) => {
        if (z.typ === 'referenz' && z.ref.id === refId) {
          neu.sprecher = z.ref.sprecher;
          neu.delta = { guardHash: neuHash(), ersetztOriginalIndex: z.ref.originalIndex };
          return { typ: 'eintrag' as const, eintrag: neu };
        }
        return z;
      }),
    );
    waehleEintrag(neu.id);
    toast('Delta angelegt', { description: 'Originaltext wird nicht gespeichert — nur dein Ersatztext.' });
  };

  /* Toolbar: Token/Auswahl einfügen + Mako-Aufleuchten. */
  const fuegeTokenEin = (snippet: string) => {
    if (!eintrag) return;
    const erg = editorRef.current?.fuegeEin(snippet);
    if (erg) setFlash({ seite: erg.seite, position: erg.position, key: Date.now() });
  };

  const fuegeAuswahlEin = (optionen: string[]) => {
    if (!eintrag) return;
    const snippet = optionen.map((o) => `→ ${o}`).join('\n');
    const erg = editorRef.current?.fuegeEin(snippet);
    if (erg) {
      setAktivSeite(erg.seite);
      toast('{AUSWAHL} eingefügt', { description: `${optionen.length} Optionen — ▶-Cursor in der Vorschau testen.` });
    }
  };

  const plusSeite = () => {
    if (!eintrag) return;
    aktualisiereEintrag(eintrag.id, (alt) => ({ ...alt, seiten: [...alt.seiten, { text: '' }] }));
    setAktivSeite(eintrag.seiten.length);
  };

  /* Inspektor: Token-Klick → zur Position springen + pulsieren. */
  const tokenPuls = (token: DialogToken) => {
    if (!eintrag) return;
    eintrag.seiten.forEach((seite, si) => {
      const treffer = parseSegmente(seite.text).find((s) => s.typ === token.art && s.roh === token.roh);
      if (treffer) {
        setAktivSeite(si);
        setPuls({ seite: si, position: treffer.position, key: Date.now() });
      }
    });
  };

  const localeWechsel = (locale: string) => {
    const ziel = dokumente.find((d) => d.field === doc.field && d.locale === locale);
    if (ziel && ziel.id !== doc.id) waehleDokument(ziel.id);
  };

  /* Strg+S: manuelles Speichern (Toast nur hier, Autosave läuft ohnehin). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        toast('Gespeichert', { description: `${doc.pfad}/${doc.locale} — manueller Speicherpunkt.` });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc]);

  /* Splitter Editor/Vorschau (vertikal verschiebbar). */
  const splitRef = useRef<HTMLDivElement>(null);
  const onSplitDrag = () => {
    const bereich = splitRef.current;
    if (!bereich) return;
    const rect = bereich.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const anteil = ((ev.clientY - rect.top) / rect.height) * 100;
      setEditorAnteil(Math.min(75, Math.max(30, anteil)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /* --------------------------------------------------- Render -------- */

  return (
    <div className="flex h-full min-h-[520px] w-full overflow-hidden">
      <DokumentListe dokumente={dokumente} aktivId={doc.id} onWaehlen={waehleDokument} onNeu={() => setWizardOffen(true)} />

      <div className="flex min-w-0 flex-1">
        {/* Eintragsliste (~40 %) */}
        <div className="w-[38%] min-w-[300px] shrink-0 border-r border-subtle">
          <EintragsListe
            doc={doc}
            zeilen={sichtbareZeilen}
            aktivId={aktivEintragId}
            onWaehlen={waehleEintrag}
            onReorder={(neu) => !sortiert && setzeZeilen(doc.id, () => neu)}
            onErsetzen={ersetzeReferenz}
            onNeu={neuerEintrag}
            onSortieren={() => setSortiert((s) => !s)}
            sortiert={sortiert}
            onDuplizieren={dupliziereEintrag}
            onLoeschen={loescheEintrag}
          />
        </div>

        {/* Editor + Vorschau (~60 %) */}
        <div ref={splitRef} className="flex min-w-0 flex-1 flex-col">
          <TokenToolbar
            onToken={fuegeTokenEin}
            onAuswahl={fuegeAuswahlEin}
            onUndo={onUndo}
            onRedo={onRedo}
            kannUndo={rueck.length > 0}
            kannRedo={vor.length > 0}
            zeichen={eintrag ? zeichenZahl(eintrag) : 0}
            deaktiviert={!eintrag}
          />

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={aktivEintragId ?? 'leer'}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.28 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {eintrag ? (
                <>
                  {/* Seiten-Editor (oben, Anteil per Splitter) */}
                  <div style={{ height: `${editorAnteil}%` }} className="flex min-h-0 shrink-0 flex-col overflow-hidden">
                    <SeitenEditor
                      ref={editorRef}
                      eintrag={eintrag}
                      aktivSeite={aktivSeite}
                      onSeiteWaehlen={setAktivSeite}
                      onSeiteText={onSeiteText}
                      onPlusSeite={plusSeite}
                      flash={flash}
                      puls={puls}
                    />
                  </div>

                  {/* Splitter */}
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Editor/Vorschau-Teiler"
                    onPointerDown={onSplitDrag}
                    className="h-1 shrink-0 cursor-row-resize border-y border-subtle bg-panel transition-colors duration-150 hover:bg-mako/50"
                  />

                  {/* FF7-Vorschau (unten) */}
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <FF7Vorschau eintrag={eintrag} seite={aktivSeite} onSeite={setAktivSeite} />
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={MessagesSquare}
                  titel="Kein Eintrag ausgewählt"
                  hinweis="Wähle links einen Eintrag oder lege einen neuen an — die FF7-Vorschau erscheint hier."
                  ctaLabel="Eintrag anlegen"
                  onCta={neuerEintrag}
                  className="m-auto"
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <LokalisierungPanel
        doc={doc}
        enDoc={enDoc}
        eintrag={eintrag}
        onLocaleWechsel={localeWechsel}
        onTokenKlick={tokenPuls}
      />

      {/* Wizard-first-Erzeugung (MS17): Neuer Dialog */}
      <WizardDialog
        offen={wizardOffen}
        onOpenChange={setWizardOffen}
        titel="Neuer Dialog"
        icon={MessagesSquare}
        nameVorschlag={`Neuer Dialog ${dokumente.length + 1}`}
        idVorschau={(n) => `mod:de.beispiel.nebenquest/dialogues/${wizardSlug(n)}/de`}
        kernTitel="Was möchtest du anlegen?"
        kernOptionen={[
          { id: 'eintrag', label: 'Neuer Eintrag', beschreibung: 'Frisches Dialog-Dokument für ein eigenes Field.', icon: FilePlus2 },
          { id: 'delta', label: 'Original-Dialog ersetzen (Delta)', beschreibung: 'Original-Referenzen laden und gezielt Zeilen überschreiben.', icon: Shield },
        ]}
        defaultsFuer={(kern) => [
          { label: 'Field-Bezug', wert: kern === 'delta' ? 'field:md1_1 (Referenz)' : 'eigenes Field' },
          { label: 'Sprache', wert: 'Primärsprache (de)' },
        ]}
        onErstellen={wizardErstellen}
      />
    </div>
  );
}
