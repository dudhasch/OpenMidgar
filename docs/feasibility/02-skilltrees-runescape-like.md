# Machbarkeitsanalyse: Skilltrees für Fischen, Holzfällerei etc. — RuneScape-like

**Projekt:** WebMidgar (github.com/dudhasch/OpenMidgar) — Erweiterung um klassische Sammel-/Handwerksskills (Gathering/Artisan) mit XP-Kurven, Levels und freischaltbaren Aktionen als neuer Gameplay-Loop neben der FF7-Story.
**Status dieser Analyse:** Entwurf. Alle Angaben zum WebMidgar-Stand beziehen sich auf den übergebenen Projektkontext (Modsystem-Manifest v1/v2, ADR-007, Roadmap S21/S22/S25). Wo der Kontext keine verbindliche Aussage hergibt, sind Annahmen explizit als solche markiert.

---

## 1. Executive Summary

**Gesamtverdikt: Machbar — als datengetriebene Mod auf Manifest v2, sofern drei Engine-Erweiterungen nachgezogen werden: (1) persistente Mod-Namespaced-Blöcke im Save-Format, (2) ein lesendes/spezielles Skill-UI im Menü, (3) deterministische Zufallsquelle für Sammel-Ergebnisse.**

RuneScape-artiges Skilling ist strukturell ideal für WebMidgar, weil es aus *Daten* besteht: XP-Tabelle, Level-Schwellen, Node-Definitionen, Ertragstabellen. Der Gathering-Kern (auf Node zeigen → Aktion → Wartezeit → Ertrag + XP) lässt sich vollständig als Tick-Aktionen im deterministischen Fixed-Tick-Interpreter abbilden — Gathering ist von Natur aus diskret (Aktion alle N Ticks), also exakt das Muster, für das die Engine gebaut ist. Manifest v2 deckt mit `field-add`, `entity-add`, `script-add`, `dialogue-add` und `variable-claim` die nötigen Bausteine weitgehend ab; ADR-007 (keine Runtime-Codes in Mods) ist einhaltbar, wenn die Skill-Mechanik selbst (XP-Berechnung, Level-Unlocks, Erfolgswahrscheinlichkeiten) entweder als deklarative Daten im Mod liegt oder als generisches Engine-Feature ("Skill-Subsystem") implementiert wird.

Die größten Risiken sind nicht technischer, sondern ökonomischer Natur: Balancing ohne MMO-Ökonomie, und die Frage, ob der Loop im Singleplayer ohne Handel/Sozialdruck trägt. Empfehlung: Stufenplan mit MVP-Skill (ein Gathering-Skill, z. B. Fischen, in einer einzigen neuen Field-Area) als Proof of Concept, dann Ausbau.

---

## 2. Ausgangslage

### 2.1 Was Engine und Modsystem heute können (laut Projektkontext)

- **Deterministischer Fixed-Tick-Interpreter** für Field-Skripte mit Snapshot/Restore und Replay — die Grundlage, auf der jede zeitbasierte Mechanik (Wartezeiten, Respawn-Timer) deterministisch laufen kann.
- **Walkmesh-Solver** — Voraussetzung dafür, dass neue Sammel-Areas begehbar und Nodes erreichbar sind.
- **Dialogsystem (in Takten)** — nutzbar für Skill-UI-Texte, Level-Up-Meldungen, NPC-Erklärungen.
- **Versioniertes Save-Format (IndexedDB)** plus Leser für Original-Saves — Persistenz-Infrastruktur existiert, ist aber aktuell auf den FF7-Spielstand ausgelegt.
- **Deklaratives Modsystem `.wmmod`**, Capabilities:
  - v1: `texture-override`, `model-override`, `background-override`, `script-patch`, `dialogue-replace`, `field-add`
  - v2 (zusätzlich): `entity-add`, `script-add`, `dialogue-add`, `model-add`, `variable-claim` (Reservierung von Variablenbank-Bereichen)
- **ADR-007:** Mods enthalten nie Runtime-Code — Skill-Logik muss also als deklarative Daten + Skripte (im Engine-Interpreter) ausgedrückt werden, nicht als JS/TS-Code im Mod.

### 2.2 Was fehlt

1. **Skill-State im Save:** Das versionierte Save-Format kennt (Annahme, aus Kontext abgeleitet) nur den FF7-Gamestate. Für Mod-eigenen, persistenten State (XP-Werte pro Skill, Node-Respawn-Zeiten, freigeschaltete Aktionen) gibt es zwei Wege: `variable-claim` auf der Variablenbank (wird mitgespeichert, aber begrenzt und kollisionsanfällig) oder einen eigenen namespaced Mod-State-Block im Save-Format (muss erst gebaut werden — siehe §4b).
2. **Skill-UI:** S21 (Menü-Grundmodul) ist geplant und *lesend*. Ein Skill-Screen (Liste der Skills, XP-Balken, Level, nächste Unlocks) braucht entweder eine Erweiterung des Menü-Moduls oder muss als Dialog-/Overlay-Lösung im Field laufen.
3. **Deterministische Ertragstabellen:** Sammel-Erfolg/Misserfolg und Beute brauchen eine seedbare, tick-deterministische RNG-Quelle, die in Snapshot/Restore und Replay korrekt funktioniert. (Annahme: Der Interpreter hat bereits eine deterministische RNG für Field-Skripte; ob diese für Mod-Skripte nutzbar und in den Snapshot aufgenommen ist, muss verifiziert werden.)
4. **field-add-Runtime (S25)** und **script-Patches (S22)** sind noch nicht fertig — ohne S25 gibt es keine neuen Angel-/Forst-Areas, ohne S22 keine Anbindung an bestehende Felder.
5. **Inventar-Anbindung (optional):** Gesammelte Ressourcen brauchen einen Ort. FF7 hat ein Item-Inventar; ob Mods Items hinzufügen können, ist im Kontext nicht aufgeführt (kein `item-add`-Capability) — offener Punkt, siehe §6.

---

## 3. Fachliches Design

### 3.1 Skill-Liste (Vorschlag, an RuneScapes Kategorien angelehnt)

RuneScape unterteilt Skills in vier Typen: **Combat, Gathering, Artisan** (Produktion) und **Support/Utility**. Zu den Gathering-Skills zählen u. a. Fishing, Mining, Woodcutting; zu den Artisan-Skills u. a. Cooking, Crafting, Smithing, Fletching, Herblore [Q5][Q6]. Für WebMidgar als Singleplayer-Erweiterung empfiehlt sich ein schlanker Satz ohne Kampf-Skills (Kampfsystem existiert erst Post-1.0):

| Kategorie | Skills (MVP → Ausbau) | Zweck |
|---|---|---|
| Gathering | **Fischen (MVP)**, Holzfällerei, Bergbau | Ressourcen aus Nodes, XP pro Ertrag |
| Artisan | Kochen, Handwerk/Schmieden | Veredelung: Rohstoff → nutzbares Item |
| Utility (optional, spät) | Feuermachen, Landwirtschaft | Komfort-/Langzeit-Loops |

**Integration in die FF7-Welt ohne IP-Bruch:** Die Engine lädt Originaldaten nur lokal per FSA; der Mod selbst darf keine Original-Assets enthalten. Konsequenz: Alle Skill-Inhalte werden als **eigene, neu erstellte Inhalte** geliefert — eigene Fields (`field-add`), eigene Node-Modelle (`model-add`), eigene Dialoge (`dialogue-add`), eigene Skill-Namen/Icons. Setting-Anker bietet die FF7-Welt *narrativ* (z. B. Angelstellen an Küsten-Fields, Forst-Areas in Wald-Umgebungen), aber fachlich ist der Mod ein eigenständiges System, das auch ohne Original-Referenzen funktionieren würde. Das spiegelt bewusst RuneScapes Prinzip: Skilling als eigenständiger Loop neben der Hauptquest [Q8].

### 3.2 XP-Kurve (konkret)

RuneScapes Level→XP-Formel ist öffentlich dokumentiert. Die kumulative Erfahrung für Level *L* ist [Q1][Q2][Q3]:

```
XP(L) = floor( (1/4) * Σ_{ℓ=1}^{L−1} floor( ℓ + 300 · 2^(ℓ/7) ) )
```

Eigenschaften der Kurve:
- Der Bedarf steigt **ungefähr um 10 % pro Level** und **verdoppelt sich etwa alle 7 Level**; Level 99 erfordert kumulativ **13.034.431 XP**, und **Level 92 ist praktisch die Hälfte von 99** [Q1].
- Als geschlossene Näherung (ohne Floor, Fehler ≤ 14 XP): `XP(L) ≈ (1/8)·(L² − L + 600·(2^(L/7) − 2^(1/7)) / (2^(1/7) − 1))` [Q1].
- RuneScape speichert XP intern als **32-bit-Fixed-Point mit einer Nachkommastelle**, Cap bei 200 Mio. XP [Q1].

**Umsetzungsempfehlung für WebMidgar:**
- Die XP-Tabelle als **Daten im Mod** (deklarativ, ADR-007-konform): entweder vorberechnete Lookup-Tabelle (99 Integer, trivial) oder die Formel als Skript-Funktion im Interpreter. Lookup-Tabelle ist einfacher, exakt und replay-sicher.
- Level-Cap und XP-Skalierung frei wählbar: Für einen Singleplayer-Nebenloop ist die volle RuneScape-Kurve (13 Mio. XP) **zu lang**; empfohlen wird dieselbe *Form*, aber skaliert (z. B. XP-Ausschüttung ×10–50 gegenüber RS-Referenzwerten oder Cap bei Level 50). → Balancing-Annahme, keine Tatsache; gehört in Playtesting.
- XP als **Ganzzahl** speichern (keine Floats) — Determinismus und einfache Serialisierung.

### 3.3 Loop-Design (Gathering)

Der klassische RuneScape-Gathering-Loop [Q7][Q8]:
1. Spieler interagiert mit einem **Ressourcen-Node** (Baum, Angelspot, Fels).
2. Aktion dauert N Ticks; Erfolg/Beute aus einer **Ertragstabelle** (Erfolgschance steigt mit Skill-Level und Tool-Tier).
3. Ertrag → Inventar, **XP → Skill**; Level-Up schaltet neue Nodes/Werkzeuge/Erträge frei.
4. Node geht leer / in **Cooldown (Respawn-Timer)**.
5. **Tool-Tiers** (z. B. Bronze→Stahl→Mithril-Axt) erhöhen Geschwindigkeit/Erfolgschance und sind level-gebunden.

Warum das motiviert (Progressionsdesign, recherchiert [Q7][Q8]):
- **Permanenter Fortschritt:** XP verfällt nie; jede Aktion zählt ("every session counts").
- **Goal-Gradient-Effekt:** Das nächste Level ist immer sichtbar und nah, das Endziel (99) mathematisch fern — Motivationsspitzen bei Annäherung.
- **Selbstgewählte Ziele:** Spieler entscheiden selbst, was sie trainieren — Ownership statt vorgegebenem Funnel.
- **Kettenwirkung:** Aktion → XP → Level → bessere Methode → schnelleres nächstes Ziel.

**Risiko der Recherche-Erkenntnis:** Ein Teil der Bindung in RuneScape kommt aus MMO-Kontext (Ökonomie, Hiscores, "Account-Identität") und AFK-/Idle-Spielbarkeit [Q7]. Im Singleplayer ohne Wirtschaft muss der Loop durch **intrinsische Belohnungen** (Unlocks, Veredelungs-Ketten Gathering→Artisan, Story-Anbindung, Sammler-Logs) kompensiert werden. Das ist der zentrale fachliche Unsicherheitsfaktor dieser Erweiterung.

### 3.4 Modellierung in einer deterministischen Tick-Engine

Gathering passt ungewöhnlich gut auf Fixed-Tick-Architektur:
- **XP/Level sind Daten**, keine Physik: Integer-State, Lookup-Tabellen — von Natur aus deterministisch.
- **Aktionen als Tick-Zähler:** "Aktion dauert 30 Ticks" ist ein Countdown im Skript/Interpreter; identisch zum Dialogsystem (in Takten). Pausieren, Snapshot, Replay funktionieren automatisch mit.
- **Respawn-Timer:** Node-State = `verfügbar | leer_bis_tick T` — ein Integer-Vergleich pro Tick; in den Snapshot aufnehmbar.
- **RNG:** Erfolg/Beute über geseedete RNG, die Teil des Snapshot-State ist (Best Practice: gleiche Inputs ⇒ gleiche Ausgaben [Q9][Q10][Q11]).
- **Update/Render-Trennung** der Engine bleibt unberührt: Skill-State ändert sich nur im Update-Tick, UI liest nur [Q9].

---

## 4. Technischer Lösungsansatz

### 4a. Reine Mod-Umsetzung mit Manifest v2 — was geht, was nicht

| Baustein | Capability | Geht damit? | Anmerkung |
|---|---|---|---|
| Angel-/Forst-Areas | `field-add` | ✅ (ab S25) | Neue Fields mit Walkmesh, Hintergrund, Entities |
| Ressourcen-Nodes (Baum, Angelspot) | `entity-add` | ✅ | Node als interaktive Entity mit Skript-Binding |
| Gathering-Logik (Timer, Ertrag, XP-Add) | `script-add` (+ `script-patch` für Original-Felder) | ⚠️ teilweise | Geht, wenn der Skript-Interpreter ausdrucksstark genug ist (Zähler, RNG, Variablenbank, bedingte Dialoge). Komplexe Tabellen (Ertragstabellen) als Skript-Daten sind machbar, aber unhandlich — Grenze des Deklarativen |
| Skill-State (XP pro Skill, Node-Respawns) | `variable-claim` | ⚠️ teilweise | Funktioniert (Variablenbank wird mitgespeichert), aber: begrenzter Adressraum, Kollisionsrisiko zwischen Mods, unübersichtlich bei vielen Skills/Nodes. Für MVP (1 Skill, wenige Nodes) ausreichend; für Ausbau fragil |
| Skill-UI-Texte, Level-Up-Meldungen | `dialogue-add` / `dialogue-replace` | ✅ | Dialog-basierte Anzeige möglich |
| Node-Modelle, Werkzeuge | `model-add` | ✅ | Eigene Modelle, kein IP-Bruch |
| Icons/Texturen für Skill-UI | `texture-override` | ❌/⚠️ | Override ersetzt nur Bestehendes; ein `texture-add`/`ui-add` fehlt in v2 — neue UI-Grafiken sind damit nicht sauber abbildbar |
| Eigenes Menü-Skill-Screen | — | ❌ | Keine Menü-Capability im Manifest; S21 ist lesend |
| Neue Items (Rohstoffe, Werkzeuge) im FF7-Inventar | — | ❌ | Kein `item-add`-Capability genannt; Workaround: Ressourcen als reine Zähler in Variablen statt als Inventar-Items |
| Balancing-Daten (Ertragstabellen, XP-Tabelle) | (Daten im Mod) | ✅ | Als deklarative Datenressource im .wmmod, ADR-007-konform |

**Fazit 4a:** Ein **MVP ist mit Manifest v2 realisierbar**: ein Skill (Fischen), eine Field-Area, 3–5 Nodes, XP/Level über `variable-claim`, Dialog-basierte UI, Ressourcen als Zähler. Eine **ausgewachsene Version** (mehrere Skills, echtes Inventar, Menü-Integration, Icons) stößt an Manifest-Grenzen (kein UI-/Item-/State-Capability).

### 4b. Nötige Engine-Erweiterungen

1. **Persistenter Mod-Skill-State im Save-Format (Priorität hoch):**
   - Eigenen, namespaced Block im versionierten Save-Format einführen, z. B. `modState["com.example.skilltrees"] = { xp: {...}, nodes: {...} }`, mit eigener Schema-Version pro Mod.
   - Alternative/Ergänzung: `variable-claim`-Bereiche weiter nutzen, aber mit dokumentierter Reservierungs-Registry. Empfehlung: Namensraum-Block — robuster gegen Kollisionen, besser migrierbar.
   - Muss in **Snapshot/Restore und Replay** einbezogen werden (Determinismus-Vertrag der Engine).
2. **XP-Tabelle als Daten:** Lookup-Tabelle (§3.2) im Engine-Skill-Subsystem oder als Mod-Datenressource; Level-Berechnung `XP → Level` per Binärsuche. Rein deklarativ, kein Mod-Code.
3. **Skill-UI im Menü:** Erweiterung des geplanten Menü-Grundmoduls (S21) um ein optionales, mod-registriertes Panel (lesend → später interaktiv). Zwischenschritt: Field-Overlay/Dialog-UI vollständig im Mod — kein Engine-Eingriff nötig, aber schlechtere UX.
4. **Determinismus-Auswirkungen:**
   - Skill-Subsystem muss ausschließlich im Update-Tick schreiben; RNG geseedet und snapshot-fähig [Q9][Q10][Q11].
   - Replay-Dateien, die vor der Skill-Erweiterung aufgezeichnet wurden, bleiben kompatibel, solange ohne Mod keine Skill-State-Änderungen auftreten (Build/Mod-Version im Replay-Header empfohlen, analog etablierter Praxis [Q10]).
5. **(Optional, für Ausbau) Generisches Skill-Subsystem in der Engine:** XP-Add, Level-Check, Unlock-Events als Engine-Feature, von Mods nur parametrisiert. Das hält ADR-007 sauber ein, verlagert aber Aufwand in den Engine-Kern — Architektur-Entscheidung, ggf. eigenes ADR.

---

## 5. Aufwandsschätzung

Grobe Schätzung in Personentagen (PT), Annahme: 1 Entwickler, vertraut mit Codebase; ohne Studio-Tooling.

| Paket | Umfang | Aufwand |
|---|---|---|
| E1: Mod-State-Namespace im Save-Format (Schema, Migration, Snapshot/Replay-Einbezug, Tests) | Engine | 8–15 PT |
| E2: Skill-Subsystem-Datenkern (XP-Tabelle, Level-Berechnung, Determinismus-Tests inkl. Replay) | Engine | 4–8 PT |
| E3: Skill-Menüpanel (nach S21) | Engine/UI | 5–10 PT |
| M1: MVP-Mod "Fischen" (1 Field, 3–5 Nodes, Ertragstabelle, Dialoge, `variable-claim`-State, eigene Modelle/Texturen) | Mod-Content | 10–20 PT |
| M2: Ausbau (Holzfällerei, Bergbau, Kochen/Handwerk, Tool-Tiers, Veredelungsketten) | Mod-Content | 20–40 PT |
| M3: Balancing & Playtesting | fachlich | 5–15 PT (iterativ) |
| **MVP gesamt (E1 + E2 + M1, ohne Menüpanel)** | | **ca. 22–43 PT** |
| **Vollausbau** | | **ca. 50–100 PT** |

Unsicherheit: hoch (±50 %), da Umfang von S22/S25-Implementierung und Studio-Masterplan-Reifegrad die Content-Kosten stark beeinflusst (mit funktionierendem Field-Editor sinkt M1/M2 deutlich).

---

## 6. Risiken & offene Fragen

| Risiko / Frage | Einordnung | Mitigation |
|---|---|---|
| **Variablenbank-Kollisionen:** Mehrere Mods claimen überlappende Bereiche oder ein Mod wächst über seinen Claim | Mittel bis hoch (mit Mod-Ökosystem) | Registry für Claims (Dokumentation + Validierung beim Laden); mittelfristig Namensraum-State (E1) statt Variablenbank |
| **Balancing ohne MMO-Ökonomie:** RS-Loop lebt teils aus Handel/Hiscores; im Singleplayer droht "sinnloses Grinding" | Hoch (fachlich) | Intrinsische Ziele: Veredelungsketten (Gathering→Artisan), Sammler-Log, Story-/Field-Unlocks, XP-Kurve für Singleplayer verkürzen; Playtesting (M3) |
| **Save-Kompatibilität:** Mod-State im Save; Laden eines Saves ohne Mod / Mod-Update mit geändertem Schema | Mittel | Schema-Version pro Mod-Namespace; fehlender Mod-State = Defaults; Migrationspfade; versioniertes Format hilft bereits |
| **Determinismus-Bruch:** RNG oder Timer außerhalb des Tick-/Snapshot-Vertrags | Niedrig (bei sauberer Umsetzung), aber fatal für Replay | Determinismus-Tests: gleiche Input-Sequenz → identischer State-Hash (Golden-State-CI, etabliertes Muster [Q10][Q11]) |
| **Manifest-Grenzen:** Kein `item-add`, kein `texture-add`/UI-Capability, S21 lesend | Mittel | MVP ohne echtes Inventar/UI-Icons; Manifest v3 als separates Thema |
| **ADR-007-Druck:** Versuchung, Skill-Logik als Code statt Daten zu bauen | Niedrig–mittel | Klare Trennung: Mechanik (Engine) vs. Inhalte (Mod-Daten); ggf. ADR für Skill-Subsystem |
| **IP-Recht:** Skill-System ist generisch (RuneScapes Formel/Mechaniken sind nicht schützbar im Sinne von Ideen/Mechaniken), aber Namen/Assets dürfen nicht kopiert werden | Niedrig | Eigene Namen, eigene Assets; Formel ist mathematisches Faktum |
| **Offene Fragen:** (1) Ist die Interpreter-RNG für Mod-Skripte nutzbar und snapshot-sicher? (2) Wie groß ist die Variablenbank real? (3) Ist ein `item-add` geplant? (4) Greift der Studio-Masterplan Skill-Authoring später auf? | — | Vor MVP-Start klären; Punkte 1–2 sind Engine-Verifikation, 3–4 Roadmap-Entscheidungen |

---

## 7. Abhängigkeiten

| Abhängigkeit | Warum nötig | Status (laut Kontext) |
|---|---|---|
| **S25 field-add-Runtime** | Ohne neue Fields keine dedizierten Sammel-Areas | geplant |
| **S22 Script-Patches** | Anbindung von Nodes/Quests an bestehende Felder | geplant |
| **S21 Menü-Grundmodul (lesend)** | Basis für späteres Skill-Panel (E3) | geplant |
| **Manifest v2** (`entity-add`, `script-add`, `dialogue-add`, `model-add`, `variable-claim`) | Gesamte Mod-Umsetzung | spezifiziert |
| **E1 (Mod-State im Save)** — neue Arbeit, dieses Dokument | Persistenter Skill-State ohne Variablenbank-Fragilität | offen |
| Studio-Masterplan (optional) | Beschleunigt Content-Erstellung (Field-/Quest-Editoren) | Masterplan existiert |
| Battle-Modul (Post-1.0) | Nicht benötigt — bewusste Scope-Entscheidung: keine Kampf-Skills | Post-1.0 |

**Kritischer Pfad:** S25 → E1 → M1. Ohne S25 kein sinnvoller MVP.

---

## 8. Empfehlung / Stufenplan

**Empfehlung: Umsetzen, aber strikt gestuft.** Der Loop ist engine-kompatibel, mod-freundlich und IP-sauber; die Unsicherheit liegt im Singleplayer-Balancing — genau das prüft der MVP billig ab.

1. **Stufe 0 — Verifikation (1–3 PT):** Offene Fragen aus §6 klären (RNG-Nutzbarkeit, Variablenbank-Größe, Save-Format-Erweiterbarkeit). Entscheidung E1 vs. reines `variable-claim`.
2. **Stufe 1 — MVP "Fischen" (nach S25):** E1 (Namensraum-State) + E2 (XP-Datenkern) + M1. Ein Skill, eine neue Field-Area, 3–5 Nodes, 20–30 Levels, Dialog-basierte UI, Ressourcen als Zähler. Erfolgskriterium: macht der Loop ohne externe Ökonomie Spaß? (Playtest, M3-Lite.)
3. **Stufe 2 — Zweiter Skill + Veredelung:** Holzfällerei + Kochen/Handwerk; erste Gathering→Artisan-Kette; Tool-Tiers. Erst hier entscheiden, ob das System trägt.
4. **Stufe 3 — UI-Reife:** E3 Skill-Panel im Menü (nach S21), Icons (erfordert ggf. Manifest v3 `texture-add`/UI-Capability).
5. **Stufe 4 — Ausbau:** Weitere Skills, Sammler-Log, Quest-Anbindung (Studio-Tooling nutzen), optional Utility-Skills. Explizit **nicht** im Scope: Kampf-Skills (abhängig vom Post-1.0-Battle-Modul).
6. **Querschnitt ab Stufe 1:** Determinismus-/Replay-Regressionstests mit Skill-State; Claim-Registry dokumentieren; Mod-Schema-Versionierung pflegen.

**Nicht-Ziele (explizit):** MMO-Features (Handel, Highscores), 99er-Kurve 1:1, Original-FF7-Assets im Mod, Runtime-Code im .wmmod.

---

## 9. Quellen

- [Q1] Old School RuneScape Wiki: *Experience* — Level/XP-Formel, Kurveneigenschaften, Fixed-Point-Speicherung, 13.034.431 XP für 99, "92 ist die Hälfte von 99": https://oldschool.runescape.wiki/w/Experience
- [Q2] tip.it-Forum: *RuneScape Experience Formula* — Pseudocode-Implementierungen der Summenformel: https://forum.tip.it/topic/263459-runescape-experience-formula/
- [Q3] tip.it-Forum: *RuneScape Levels and Experience formula* — C++-Referenzimplementierung (Level↔XP): https://forum.tip.it/topic/90657-runescape-levels-and-experience-formula/
- [Q4] RuneScape Wiki: *Skills* — vier Skill-Typen (Combat, Gathering, Artisan, Support), Elite-Skills: https://runescape.wiki/w/Skills
- [Q5] Old School RuneScape Wiki: *Skills* — F2P-/P2P-Skill-Liste, Kategorien Combat/Gathering/Production/Utility: https://oldschool.runescape.wiki/w/Skills
- [Q6] RuneScape: Dragonwilds Wiki: *Artisan* — Beispiel Veredelungsketten (Materialien → Produkte, Tool-Tiers): https://dragonwilds.runescape.wiki/w/Artisan
- [Q7] Respec: *Why is RuneScape (OSRS) so addictive?* — permanenter Fortschritt, Goal-Gradient, AFK-Design, unendliche Ziele: https://joinrespec.com/why-is-runescape-so-addictive/
- [Q8] Scapelikes Blog: *Why RuneScape's Skilling System Still Works* — Skilling als eigenständiger Loop, selbstgewählte Ziele, Aktion→XP→Level→Unlock-Kette: https://scapelikes.com/blog/why-runescapes-skilling-system-still-works
- [Q9] Crimsonland-Dokumentation: *Game Loop Architecture* — Update/Render-Trennung, Fixed-Timestep für Replay-Verifikation: https://banteg-crimson.mintlify.app/rewrite/architecture/game-loop
- [Q10] bugnet.io: *How to Make a Game Simulation Deterministic for Replays* — Fixed Timestep, geseedete RNG, Input-Recording statt State-Recording: https://bugnet.io/blog/how-to-make-a-game-simulation-deterministic-for-replays
- [Q11] o3de-diorama: *Design: deterministic fixed-tick simulation* — Snapshot/Restore, Golden-State-CI-Tests: https://github.com/nickschuetz/o3de-diorama/blob/main/Docs/design/2d-deterministic-sim.md
- [Q12] Qhimm.com Forums — FF7-Modding-Community als Referenz für langjährige FF7-Mod-Ökosysteme (Gameplay-Mods, 7th Heaven, FFNx): https://forums.qhimm.com/index.php ; https://forums.qhimm.com/index.php?topic=19970.0

*Hinweis: Aussagen zur WebMidgar-Architektur stammen aus dem übergebenen Projektkontext, nicht aus eigenständiger Code-Inspektion. Alle Annahmen sind im Text markiert.*