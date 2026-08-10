# STUDIO-ANNAHMEN — Zukunftsbild des Projekts für den Studio-Strang

**Status:** Verbindliches Arbeitsdokument des Branches `modding-suite`.
**Zweck:** Der Runtime-Strang steht bei S10/S11; Phase-5-Mod-System (S19) und
Preview-Einbettung sind Zukunft. Dieses Dokument fixiert die **Annahmen**, auf
deren Grundlage die Modding Suite (`packages/studio-core`,
`packages/studio-compiler`, `apps/studio`) gebaut ist. Jede Annahme trägt die
Quelle, aus der sie abgeleitet ist, und den Pfad, wie sie später durch den
Ist-Stand ersetzt wird.

**Aussagenklassen** wie im Masterplan: 🟢 Formatfakt · 🔵 Architekturentscheidung ·
🟡 Annahme/`Zu validieren` · 🔴 Offene Forschungsfrage.

---

## A-ST-1 — Das Spiel importiert zukünftig exakt die Phase-5-Kette 🟡

Das Spiel wird (S19 + „Modding II") die fünfstufige Override-Kette und den
Manifest-Import aus WEBMIDGAR-MASTERPLAN 5.1–5.3 implementieren. Das Studio
ist **Compiler mit GUI** (ADR-013): Es erzeugt ausschließlich Mod-Pakete, die
gegen dieses Zukunftsbild validiert sind. Das Spiel kennt kein Studio-Format.

*Ersetzungspfad:* Sobald `packages/mods` (S19) existiert, wird das
Manifest-Schema von dort importiert statt aus `packages/studio-compiler`
dupliziert gepflegt (eine Implementierung, zwei Nutzer).

## A-ST-2 — Manifest v2 (Zielschema der Studio-Ausgabe) 🟡

Das Studio kompiliert auf **Manifest v2**. v2 = v1 (Masterplan 5.2) plus die
additiven Records aus MODDING-SUITE-MASTERPLAN Teil D:

| Capability | Record | Studio-Quelle |
|---|---|---|
| `texture-override` (v1) | `assets[]` | Charakter-Editor (Textur-Variante), Field-Editor |
| `background-override` (v1) | `assets[]` | Field-Editor |
| `model-override` (v1) | `assets[]` | Charakter-Editor (Post-MVP-Pfad) |
| `script-patch` (v1) | `patches[]` | Script-Editor (Delta auf Original-Field) |
| `dialogue-replace` (v1) | `dialogues[]`, `mode: replace` | Dialog-Editor (Delta mit guardHash) |
| `field-add` (v1) | `fields[]` (NAM-nah, deklarativ) | Field-Editor (Neubau) |
| `entity-add` (v2) | `entities[]`: `{id, field, modellRef, platzierung{dreieck,position,richtung}, kollision, scripts{slot→scriptRef}}` | Charakter-Editor |
| `script-add` (v2) | `scripts[]`: `{id, payload (Mnemonics), quelle}` | Script-Editor (neue Scripts) |
| `dialogue-add` (v2) | `dialogues[]`, `mode: add` | Dialog-Editor |
| `model-add` (v2) | `assets[]` Format `gltf-subset` | Charakter-Editor MS6 (UI gesperrt) |
| `variable-claim` (v2) | `variables`: `{bereich, benannteSlots[]}` | Script-Editor (benannte Variablen) |

🔵 **Capabilities werden abgeleitet, nie gepflegt:** Der Compiler leitet die
`capabilities[]`-Liste deterministisch aus dem Projektinhalt ab. Ein Verstoß
(Inhalt ohne Capability) ist strukturell unmöglich.

## A-ST-3 — `.wmmod`-Paketformat 🟡

`.wmmod` = ZIP-Container (eigene Endung, MODDING-SUITE C.5) mit:

```text
manifest.json          Manifest v2
content/…              Inhaltsdateien (nur Herkunft user-asset | generated)
```

- `integrity`: `{algo: "sha256", hashes: {<pfad>: <hex>}}` deckt alle Dateien.
- 🔵 **Determinismus:** Gleicher Projektstand → byteidentisches Paket
  (sortierte Einträge, feste ZIP-Zeitstempel, kanonisches JSON: sortierte
  Schlüssel, stabile Array-Reihenfolgen). Geprüft per Doppellauf-Digest.
- 🔵 **Paket-Audit (Provenienz, ADR-017):** Jede Paketdatei listet Herkunft
  `user-asset` (aus `assets/`) oder `generated` (Compiler). Alles andere ist
  ein Kompilierfehler. Originalbytes sind strukturell nicht transportierbar
  (Typsystem der Quellen, B.7).

## A-ST-4 — Studio-Projektmodell (Quelle der Wahrheit) 🔵

Ein Studio-Projekt ist ein Verzeichnis rein deklarativer JSON-Dokumente
(B.1), ein Dokument pro fachlicher Einheit, `schemaVersion` je Dokument,
Referenzen ausschließlich als IDs (B.2):

```text
projekt/
├─ project.json          {schemaVersion, modId, name, version, engineCompat,
│                         primaersprache, sprachen[], manifestZielversion: 2}
├─ dialogues/<field>.<locale>.json   Dialogdokumente (Einträge, Seiten, Metrik)
├─ scripts/<entitaet>.<slot>.json    Script-Graphen (Knoten/Kanten, Trigger)
├─ characters/<id>.json              {modellRef | texturOverride, kollision,
│                                     auftritte[] {field, dreieck, position,
│                                     richtung, scripts{slot→ref}}}
├─ fields/<id>.json                  Field-Volldokument (neu) ODER
├─ fields/<id>.delta.json            Field-Delta (Anker + Operation, guardHash)
├─ assets/                           Nutzerdateien (PNG, glTF — Post-MVP)
├─ variables.json                    benannte Variablen → variable-claim
└─ build/                            Compiler-Ausgabe (generiert, nie editiert)
```

Delta-Operationen spiegeln die Patch-Record-Enumeration aus Masterplan 5.2:
`replace-span | insert-before | insert-after | disable-span` — nie Vollkopien
von Original-Fields.

## A-ST-5 — Opcode-Knotenvorrat des Script-Editors 🟡

Der Graph-Editor kennt exakt die neun Kategorien der Taxonomie (Masterplan
4.1). Knoten nicht implementierter Kategorien werden **gesperrt** angezeigt
(MS4-Regel: „Editor zeigt nicht implementierte Kategorien als gesperrt").
Freigabestand dieser Annahme (abgeleitet aus S6-Interpreter + R1-Notiz):

| Kategorie | Editor-Status | Begründung |
|---|---|---|
| Kontrollfluss & Synchronisation | ✅ nutzbar | S6 implementiert (JMP/IF/REQ/WAIT, A1–A9) |
| Variablen, Flags & Inventar | ✅ nutzbar | S6 implementiert (Bankpaar-Nibble A8) |
| Dialog & Auswahl | ✅ nutzbar (Stub-Semantik) | S6 Dialog-Stub; Auswahl → Variable |
| Entity: Bewegung & Animation | 🔒 gesperrt | R1: 0xA0-Block noch nicht real implementiert |
| Kamera & Bildsteuerung | 🔒 gesperrt | vor S12 |
| Field-/Map-Übergang | ✅ nutzbar | Gateway-Semantik aus S5/S11-Bestand |
| Audio-Trigger | 🔒 gesperrt | ADR-012 (Post-MVP), nur geloggt |
| Battle- & Minigame-Übergang | ✅ nutzbar (Stub) | ADR-011 Stub-Vertrag |
| Spezial/System | 🔒 gesperrt | Restkategorie, UNKNOWN-Politik |

Blockierend/nicht-blockierend ist formatgegeben und **visuell**
unterscheidbar (Knotenform: blockierend = achteckig „Wartepunkt",
nicht-blockierend = rechteckig). Slot-Trigger: `init | main | interaktion |
beruehrung | timer` (Slot-Semantik aus R1 A5 übernommen, nicht neu geraten).

## A-ST-6 — ADR-S1: GUI-Framework der Studio-Schale 🔵

Entscheidung (Kriterien aus B.5: Baum-/Tabellenleistung 10⁴ Zeilen,
Canvas/Three-Integrationsreibung, Bundle-Disziplin):
**React 18 + Vite + Tailwind CSS** für `apps/studio`.

Begründung: Dialog-/Problemlisten und der Script-Graph sind dominiert von
Listen-/Knoten-Rendering mit feiner Update-Lokalität (React-Memo/Virtualisierung
ist dafür der gereifteste Pfad); Canvas-Overlays (Field-/Graph-Editor) koppeln
über Refs reibungsarm; Vite teilt die Toolchain mit dem Monorepo. Die Schale
bleibt austauschbar — sämtliche Fachlogik liegt framework-frei in
`packages/studio-core` / `packages/studio-compiler` (ADR-018). Three.js wird
erst mit der Preview-Einbettung (A-ST-7) ein Teil der Schale.

## A-ST-7 — Preview-Panel ist Vertrags-Platzhalter 🟡

Die Live-Preview (B.6, eingebettete echte Runtime über Session-Override)
existiert noch nicht. Die UI reserviert das Preview-Panel samt Vertrag
(Session-Overrides `{canonical-id → NAM}`, Zustandsrückkanal:
Interpreter-Timeline, Entity-Positionen, Fault-Log), zeigt aber einen
dokumentierten Platzhalter. Keine Editor-„Nachsimulation" der Engine (ADR-016).

## A-ST-8 — Speicherpfad der UI: IndexedDB primär 🟡

FSA ist in iframed/unterstützungsfreien Kontexten nicht garantiert (R3). Die
Studio-Schale nutzt daher den IndexedDB-Projekt-Store als Primärpfad
(B.1-Fallback); FSA-Öffnen ist als UI-Einstieg vorgesehen, degradativ.
Autosave: debounced Write + Crash-Journal in IndexedDB mit
Wiederherstellungsdialog (MS1-Akzeptanz).

## A-ST-9 — Sprach- und Textkonventionen 🔵

- Studio-UI auf Deutsch (Repo-Dokumentation ist deutsch).
- Dialog-Metrik-Vorschau nutzt eine **Studio-eigene Platzhalter-Zeichentabelle**
  (Fenster 320 px, Zeilen 3, proportionale Fallback-Metrik), bis S13/S15 die
  Clean-Room-Zeichentabelle + Fenstermetrik liefern (MS2-🟡: „vorab gegen
  Realdaten kalibrieren"). Überlaufwarnungen sind damit heuristisch, nie
  als Import-Fehler verdrahtet (Masterplan 5.2: Warnung, kein Fehler).

## Offene Punkte (bewusst nicht geraten)

- 🔴 RS2: Variablenbank-Kollision zwischen Mods im selben Save — die UI
  zeigt den `variable-claim`-Bereich an; die Kollisions-Registry ist
  Engine-Zukunft (vor MS5 zu entscheiden).
- 🔴 Bone-Limit des glTF-Subsets (MS6) — Import-UI gesperrt.
- 🟡 Ergonomie Tiefenmalen (Tile-Raster vs. Freiform) — Field-Editor nutzt
  vorerst Tile-Raster; Prototyp-Entscheid aus C.4 steht aus.

## Fortschreibung

Die Creator-Erweiterungen (Char-Baukasten, Party-Member, Items, Musik,
Map-Import, Animationen) sind in
[STUDIO-FEATURE-ROADMAP.md](STUDIO-FEATURE-ROADMAP.md) geplant; sie ergänzt
dieses Annahmen-Set um A-ST-10 bis A-ST-15 (Engine-Komposition `model-compose`,
`kernel-patch`, Audio-Pfad S16, `walkmesh-gen`, Animations-Frame-Basis,
Party-Opcode-Semantik).
