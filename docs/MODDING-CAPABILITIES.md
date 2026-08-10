# MODDING-CAPABILITIES — Maximale Mod-Möglichkeiten der WebMidgar Studio Suite

**Status:** Verbindlicher Capability-Plan, Branch `modding-suite` (Stand nach
Merge auf main S37+, 2026-08-10).
**Methode:** Das Capability-Inventar der etablierten FF7-Modding-Tools
(Makou Reactor, ff7-landscaper, Proud Clod, WallMarket, Kimera, Black Chocobo,
touphScript) wird auf die Studio-Editoren abgebildet. Ziel: **Die Suite deckt
die Möglichkeiten der Desktop-Tool-Landschaft browsernativ ab** — deklarativ,
paketierbar, ohne Binärberührung (ADR-007/013/014 gelten für alles).

**Aussagenklassen** wie gehabt: 🟢 umgesetzt · 🔵 entschieden/geplant ·
🟡 Annahme/`Zu validieren` · 🔴 offene Forschung/Engine-Fernabhängigkeit.

---

## 1. Tool-Capability-Matrix → Studio-Abbildung

| Tool-Capability (Quelle) | Studio-Editor | Umsetzung im Studio |
|---|---|---|
| Field-Script-Editor, Opcode-Liste, spezialisierte Opcode-UIs (Makou) | Quest-/Script-Editor `#/quests` | 🟢 Graph-Editor über 9 Kategorien; gesperrte Kategorien wandern mit Engine-Stand (S12 hat 0xA0-Bewegung implementiert → **entsperren**) |
| Globale Text-Suche/„Alle ersetzen", Opcode-/Variablen-Suche (Makou) | **NEU: Globale Suche (⌘K-Erweiterung)** | 🔵 MS18: projektweite Suche über Dokumente (Text, Knoten-Ops, Variablen, Referenzen) mit Ersetzen-Fluss |
| Texteditor + Fenster-Editor, Autosize (Makou) | Dialog-Editor `#/dialoge` | 🟢 (Fenstermetrik S15-ankerbar); Fenster-Position/Größe als Metrik-Felder 🔵 MS18 |
| Walkmesh 2D/3D, Hintergrund-Overlay (Makou) | Field-Editor `#/felder` | 🟢 (2D + Overlays); 3D-Vorschau Post-A-ST-7 🔴 |
| Kamera-/Trigger-/Gateway-Editor, Maplist (Makou) | Field-Editor | 🟢 |
| Hintergrund-Editor: Tiles, Paletten, Tile-Import/-Export (Makou 2.0) | Field-Editor → **Tile-/Paletten-Tab** | 🔵 MS18: Tile-Browser + Paletten-Editor + Import/Export (Nutzerassets) |
| Encounter-Tabellen je Feld (Makou) / je Weltregion (landscaper) | **NEU: Encounter-Editor (Tab in `#/schlacht`)** | 🔵 MS18: Tabellen Formation × Wahrscheinlichkeit × Kampf-ID (10-Bit 🟢 S30), verknüpft mit BattleDoc |
| Model-Loader verwalten, Modellgröße/Licht (Makou) | Charakter-Editor | 🟢 Referenzpfad; Größe/Licht als Felder 🔵 MS18 |
| scene.bin: Gegner-Stats, Formationen, Drops (Proud Clod) | Gegner- + Battle-Editor | 🟢 MS15/MS16 |
| **Enemy-AI-Disassembler** (Proud Clod) | Gegner-Editor → **KI-Ansicht „Als Pseudocode lesen"** | 🔵 MS18: deklarative Prioritätenliste rendert als lesbarer Pseudocode (Studio bleibt deklarativ — kein freier AI-Bytecode, ADR-024) |
| KERNEL.BIN: Items/Waffen/Materia/Kurven/Char-AI (WallMarket) | Item-Creator (MS11) + **Kernel-Browser** | 🔵 MS18: Kernel-Browser (lesend, referenziert `kernel:item/<id>`, S13-Daten); Materia-Editor 🔴 (Materia-System Engine-Zukunft) |
| 3D-Modelle editieren, Bones, Animationen, 3DS-Import (Kimera) | Char-Baukasten (MS9) + Animation-Creator (MS14) + glTF-Import (MS6) | 🟡/🔴 glTF statt 3DS; Bone-Edit = Nutzerasset-Pfad |
| Weltkarten-Geometrie 3D, Triangle-Painting, OBJ-Import/Export (landscaper) | **NEU: Weltkarten-Editor `#/welt`** | 🟡→🔵 MS20+: S28/S29 sind Engine-Anker — `packages/formats-world`, `render-world`, `world-runtime` existieren bereits im main! Editor designed (gesperrt-Muster), Freigabe mit World-Runtime-Reife |
| World-Script High-Level-Editor (landscaper) | Weltkarten-Editor (Script-Tab) | 🔴 mit S29-Reife |
| Weltkarten-Messages/Regionsnamen (landscaper) | Dialog-Editor (Welt-Tab) | 🔴 mit S28/S29 |
| Savegame-Editierung, New Game+, PHS (Black Chocobo) | **Testszenarien/Spielstand-Studio** | 🔵 MS18: deklarative Testszenario-Dokumente (B.6-Bestand) + „New Game+"-Startzustand als Szenario-Vorlage — **kein** direkter Original-Save-Editor (Rechtsrahmen), Nutzersaves bleiben lokal |
| Text-Dump/-Encoder, Fenster-Auto-Resize (touphScript) | Dialog-Editor + Compiler | 🟢 (Export als Projekt-Dokumente, kein Dump von Originalen — nur referenziert) |
| window.bin-Font-Editor (Makou) | — | 🔴 Nicht-Ziel (Font ist Original-Asset; Nutzer-Fonts als `font-override` Post-MVP) |
| Musik-Export PSF / AKAO (Makou) | Musik-Importer (MS12) | 🟡 nutzerseitige Konvertierung, kein Original-Rip |
| Savemap-Variablen-Übersicht (Makou) | **Variablen-Manager-Ausbau** | 🔵 MS18: Bank-Belegungs-Übersicht (S14-Bankmodell: 5 persistente Regionen!), variable-claim-Kollisionssicht (RS2) |

## 2. Zusätzliche Studio-Capabilities (über die Tools hinaus)

| Capability | Begründung |
|---|---|
| Provenienz-Schleuse + Paket-Audit | Desktop-Tools schreiben in Originalarchive — die Suite erzwingt Rechtssicherheit strukturell (B.7) 🟢 einzigartig |
| Deterministische, byteidentische Pakete + Doppellauf-Digest | Reproduzierbarkeit/CI 🟢 |
| Befundliste (total, klickbar, fixHint) | Kein Desktop-Tool validiert so 🟢 |
| Einfach/Profi-Modus + Wizards | Einsteigerfreundlichkeit 🟢 |
| Testszenarien (deklarativ, versioniert) | „coc"-Äquivalent als Daten 🟢 (B.6) |
| Mod-Doktor-Konsument | Engine-S22 liefert Mod-Doktor; Studio zeigt Import-Diagnose beim Testimport 🔵 |

## 3. MS9–MS14 — Implementierungsstand und Ausbau (diese Session)

| MS | Umfang jetzt | Ausbau („mehr capabilities") |
|---|---|---|
| **MS9 Char-Baukasten** | Baukasten-Tab im Charakter-Editor: 8 Slots (kopf/frisur/torso/arm_l/arm_r/beine/acc1/acc2), Teil-Browser, Referenz-/Nutzerasset-Quellen, Zufalls-Würfel, Vor/Zurück-Stepper, Kompatibilitäts-Befunde | **+ Proportionen-Editor** (Skalierung je Teil), **+ Farb-/Paletten-Labor** (HSV-Shifts als texture-override), **+ Vorlagen-Galerie** (speicherbare Builds), **+ Silhouetten-Preview** |
| **MS10 Party-Member** | Identität, Werte-Kurven-Editor (Spline, Presets), Limit-Designer (Taxonomie), Kompatibilitätsmatrix | **+ Start-Loadout-Presets**, **+ Party-Rollen-Templates** (Krieger/Magier/Support) |
| **MS11 Item-Creator** | Typ-Weiche (Verbrauchbar/Schlüssel/Waffe/Rüstung), Field/Battle-Schalter, Effekt-Baukasten (Taxonomie 🟢), Icon/Texte, Preis | **+ Item-Set-Editor** (Sets/Boni 🔵), **+ Shop-Liste** (Referenz, deklarativ) |
| **MS12 Musik-Importer** | Wellenform-Editor, Loop-Marker + Naht-Abhören, Loop-Test ×3, Zuordnungstabelle (Field/Script), Fade-Regeln | **+ Battle-Musik-Zuordnung** (BattleDoc.musikRef 🟢 verdrahtet) |
| **MS13 Map-Importer** | 3-Schritte-Wizard (Bild → Maske/Tiefe → Walkmesh-Vorschlag + Kamera), Landing im Field-Editor | **+ Schnell-Vorlagen** (Korridor/Platz/Außen) 🔵 |
| **MS14 Animation-Creator** | Bone-Baum, Dope-Sheet, Pose-Bibliothek, Scrub/Loop, topologyHash-Bindung, Ereignis-Spur | **+ Clip-Bibliothek pro Skelett-Familie**, **+ Spiegeln L/R** 🔵 |

## 4. Einfache Projektverwaltung (MS19)

🔵 **Entscheidung:** Ein schlichtes, vollständiges **Projekt-Dashboard** auf Home
(ersetzt die bisherige Karten-Logik im Einfach-Modus):

- **Projektkarten-Liste** (eine Zeile je Projekt): Name, modId (Mono), zuletzt
  geändert (relativ), Dokument- und Befund-Zähler, Mini-Statistik-Chips
  (Dialoge/Scripts/Charaktere/Felder/Gegner/Schlachten/Items).
- **Aktionsmenü je Zeile** (einzige 3-Punkte-Menü): Öffnen · Umbenennen ·
  Duplizieren · Exportieren (.wmmod-Schnellkompilierung) · Löschen (mit
  AlertDialog + Undo-Toast).
- **Neues Projekt** = ein Wizard (Name → modId → Sprache → fertig; Defaults
  alles valid); **Suche/Sortierung** (Name, zuletzt, Größe); **Zuletzt geöffnet**
  als oberste Karte mit Direktlink „Weiterarbeiten".
- **Beispielprojekt** „Midgar-Nebenquest" als fixe Karte mit „Kopie starten".
- Im Einfach-Modus: genau 1 Primär-CTA („Neues Projekt"); Profi zeigt zusätzlich
  Pfade, Speicher-Backend, Journal-Zustand.

## 5. Umsetzungsreihenfolge (diese Session)

1. MS9–MS14-Editoren + Projektverwaltung (UI/UX, wie bisher auf studio-core) — **höchste Priorität**
2. MS18-Fähigkeiten als Folgeschritte: Globale Suche, Encounter-Tabellen-Editor, KI-Pseudocode-Ansicht, Kernel-Browser, Tile-/Paletten-Tab, Variablen-Manager-Ausbau, Fenster-Editor-Felder — als **gesperrt-designed** Karten in den Editoren, wo Engine-Anker fehlt (🔵 mit Design), bzw. direkt umgesetzt, wo sie studio-seitig sind (Suche, Pseudocode, Befund-Verbesserungen)
3. MS20+ Weltkarte (S28/S29-Anker — `packages/formats-world`/`render-world`/`world-runtime` existieren im main) — Capability-Platzhalter

*Regel wie bisher: Kein Feature ohne ehrlichen Aktivierungs-Stand. „Gesperrt,
aber designed" schlägt „still geraten".*
