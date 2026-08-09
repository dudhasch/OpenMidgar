# Machbarkeitsanalyse 05: AI-Skill „Automatische Mods"

> **Thema:** Ein Agent-Skill (SKILL.md-Paket à la Anthropic Agent Skills), der
> einen Coding-Agenten (Claude Code, Kimi, Cursor o. ä.) befähigt, aus einer
> natürlichsprachlichen Mod-Idee eigenständig ein valides `.wmmod`-Paket zu
> erzeugen — inklusive Validierungsschleife.
>
> **Projektkontext:** WebMidgar (github.com/dudhasch/OpenMidgar), Clean-Room-
> FF7-PC-Reimplementierung im Browser, TypeScript-Monorepo.
> **Status:** Entwurf. Annahmen sind explizit als *(Annahme)* markiert.
> **Hinweis:** Meilenstein-Bezeichnungen (MS3, S22, S25) stammen aus dem
> Projektkontext; nicht spezifizierte Inhalte sind als Annahme markiert.

---

## 1. Executive Summary (Verdikt)

**Verdikt: Bedingt machbar — Empfehlung „Ja, gestuft".**

Ein AI-Skill, der `.wmmod`-Mods aus natürlichsprachlichen Ideen generiert, ist
ein überdurchschnittlich gut geeigneter LLM-Anwendungsfall, aus drei Gründen:

1. **Das Zielformat ist deklarativ, textbasiert und deterministisch
   validierbar.** Mods = Manifest mit klarer Capability-Taxonomie plus
   Mnemonic-Skripte — keine Binärformate, kein Bytecode, kein Runtime-Code
   (ADR-007, ADR-014). Genau das, was menschliches Modding teuer macht, ist
   für LLMs teils irrelevant, teils gut abbildbar.
2. **WebMidgar besitzt (bzw. plant) das perfekte Orakel:** einen *totalen*
   Studio-Compiler — deterministisch, Node-fähig, CI-tauglich, vollständige
   Befundliste statt First-Error. Exakt das „Compiler-in-the-loop"-Muster,
   das die Forschung (TypeChat, Voyager, Feedback-Loop-Studien) als
   funktionierenden Weg für LLM-generierte Artefakte belegt.
3. **Der Skill selbst ist klein** (SKILL.md + Referenzen + Skripte +
   Beispiele). Der eigentliche Aufwand steckt in den Vorbedingungen im Repo
   (Assembler-Promotion, Compiler-CLI, Mod-Doktor, Beispiel-Mods) — die aber
   ohnehin auf der Studio-Roadmap stehen.

**Hauptvorbehalt:** Die Validierungsschleife garantiert *formale* Korrektheit,
nicht *inhaltliche* Qualität (Field-Ästhetik, Dialog-Ton, Balancing) — hier
bleibt der Mensch (bzw. das Studio-GUI) in der Schleife. Die Provenienz-
Schleuse (ADR-017) ist eine harte, nicht verhandelbare Nebenbedingung.

**Kernsatz:** WebMidgar ist — bewusst oder unbewusst — so entworfen, wie man
ein Modsystem entwerfen würde, wenn KI-Agenten die primären Mod-Autoren
wären. Der Skill operationalisiert diese Architekturentscheidung.

## 2. Ausgangslage

### 2.1 Warum menschliches Modding (hier) schwer ist

Klassisches Modding scheitert für Nicht-Entwickler am gleichzeitigen
Durchdringen mehrerer Spezialdomänen: Binärformate, Bytecode/Mnemonics,
undokumentierte Engine-Invarianten, manuelle Toolchains, Debugging ohne
Diagnoseausgabe. Selbst in WebMidgar muss ein Modder Manifest-Taxonomie,
Mnemonic-Taxonomie, Auflösungskette und Provenienz-Regeln gleichzeitig
beherrschen. Die Hürde liegt nicht in der Kreativität („was will ich?"),
sondern im formalen Handwerk („wie drücke ich das korrekt aus?").

### 2.2 Warum WebMidgar ungewöhnlich KI-freundlich ist

Sechs Architektureigenschaften fallen zusammen — jede einzelne ist eine
Best Practice für LLM-generierte Artefakte:

| Eigenschaft | Nutzen für den Agenten |
|---|---|
| **Deklarativ, kein Runtime-Code** (ADR-007) | LLM-Fehlverhalten (Seiteneffekte, Exploits) strukturell ausgeschlossen; Output-Raum klein und aufzählbar. |
| **Mnemonic-Taxonomie statt Bytecode** | Selbstdokumentierende Text-DSL — der native Modus von LLMs; Bytecode-Übersetzung delegiert an den Assembler. |
| **Totaler Compiler** (Befundliste statt First-Error) | Maximaler Informationsgehalt pro Feedback-Runde → minimale Anzahl Agenten-Iterationen. |
| **Deterministisch & Node-fähig** | Compiler läuft lokal im Checkout und identisch in CI; kein Browser/Spielstart nötig. |
| **fixture-gen + vitest** | Zweites Orakel jenseits reiner Validität: „Verhält sich der Mod wie das Referenz-Fixture?" |
| **Provenienz-Schleuse** (ADR-017) | Rechtsregel ist *maschinell prüfbar* → als harter Gate-Schritt einbaubar statt als Prompt-Appell. |

### 2.3 Stand von Forschung und Praxis (Belege)

- **Agent-Skills als Format:** Anthropic führte Agent Skills Okt. 2025 ein und
  veröffentlichte sie Dez. 2025 als offenen Standard (SKILL.md + YAML-
  Frontmatter + progressive disclosure: ~100 Token Metadaten immer im Kontext,
  Body bei Aktivierung — Empfehlung < 500 Zeilen —, Referenzen bei Bedarf).
- **Compiler/Validator-in-the-loop ist der etablierte Reparaturmechanismus:**
  Microsofts TypeChat ersetzt Prompt- durch Schema-Engineering (Validierung
  gegen Typen, Fehler als Reparatur-Feedback zurück ans Modell). Feedback-
  Loop-Studien zeigen: Reasoning-Modelle verbessern sich über Iterationen
  deutlich; syntaktische Fehler sind gut, logische schlecht behebbar.
- **Voyager (NVIDIA, Minecraft, 2023):** LLM-Agent, der per iterativem
  Prompting mit Ausführungs-Feedback und Selbstverifikation ausführbaren Code
  erzeugt und in einer Skill-Bibliothek persistiert — konzeptioneller Beleg,
  dass „Agent erzeugt Spiel-Artefakte mit Fehler-Loop" funktioniert.
- **Zentrale Einschränkung:** Schema-/Grammar-Validierung garantiert nur
  *syntaktische* Validität; die „parse-semantic gap" muss durch Tests und
  menschliche Prüfung abgedeckt werden.

## 3. Konzept des AI-Skills

### 3.1 Zielpersona und Betriebsmodus

Zielpersona ist **kein Mensch**, sondern ein Coding-Agent (Claude Code, Kimi,
Cursor o. ä.) in einem **lokalen Checkout**. Zwei denkbare Szenarien:

- **(Annahme, empfohlen)** Schlankes eigenes *Mod-Projekt-Repo* mit Skill,
  Schema, Referenzen, Beispielen und Compiler-CLI — der Agent muss nicht das
  ganze Engine-Monorepo verstehen.
- **(Alternative)** Direkt im WebMidgar-Monorepo unter `mods/…`: einfacherer
  Start, aber mehr Kontext, mehr Verwechslungsgefahr, Rechtefragen.

Durch den offenen Agent-Skills-Standard bleibt der Skill agentenneutral;
agentenspezifische Erweiterungen (Tool-Restriktionen, Hooks) sind optional.

### 3.2 Ein- und Ausgaben

- **Eingabe:** Natürlichsprachliche Mod-Idee („neuer NPC in den Slums mit
  Dialog X und Miniquest Y"), ggf. bereitgestellte Assets, Ziel-Capability.
- **Ausgabe:** Ein validiertes `.wmmod`-Paket, dazu Validierungsbericht (leere
  Befundliste), Testergebnisse (fixture-gen/vitest), Provenienz-Nachweis
  (Hashabgleich bestanden) und eine kurze menschenlesbare Zusammenfassung.
- **Nicht-Ziele:** visuelle Bewertung, Balancing, spielerische Qualität.

### 3.3 Abgrenzung zum Studio-GUI (MS1–MS8)

**Komplementär, nicht konkurrierend.** Das Studio richtet sich an Menschen
(visuelles Authoring, Live-Vorschau, Mod-Doktor): „sieht es richtig aus?";
der Skill an Agenten (Automatisierung, Batch, CI): „ist es formal korrekt?".
Beide konsumieren denselben totalen Compiler und den Mod-Doktor als Backend.
Empfohlener Workflow: *Skill generiert → Studio verifiziert → Mensch
akzeptiert.* Das Studio muss nicht fertig sein — der CLI-Kern genügt.

## 4. Entwurf der Skill-Struktur

### 4.1 Verzeichnislayout (progressive disclosure)

```text
skills/wmmod-authoring/
├── SKILL.md                    # ≤ 500 Zeilen: Workflow, harte Regeln, Navigation
├── references/                 # Level-3-Wissen: nur bei Bedarf gelesen
│   ├── manifest-schema.md      # Capability-Taxonomie v1/v2, Feld für Feld
│   ├── mnemonic-taxonomy.md    # Mnemonics, Signaturen, Beispiele
│   ├── provenance-rules.md     # ADR-017, Hashabgleich, erlaubte Quellen
│   ├── variables-bank.md       # belegte/freie Variablen (variable-claim, v2)
│   └── resolution-chain.md     # fünfstufige Auflösungskette, Konfliktregeln
├── recipes/                    # Capabilities-Kochrezepte
│   ├── new-npc.md              # entity-add + dialogue-add + script-add
│   ├── new-field.md            # field-add + Assets (background/model)
│   └── dialogue-quest.md       # dialogue-add/replace + variable-claim
├── scripts/                    # deterministische Werkzeuge (Agent führt aus)
│   ├── validate-mod.sh         # totaler Compiler (CLI), JSON-Befundliste
│   ├── pack-wmmod.sh           # deterministisches ZIP-Packen
│   ├── check-provenance.sh     # Hashabgleich / ADR-017-Schleuse
│   └── run-fixtures.sh         # fixture-gen + vitest-Tests
└── examples/                   # vollständige, valide Beispiel-Mods
    ├── hello-texture-override/
    └── slums-npc-miniquest/
```

Die Aufteilung folgt den dokumentierten Best Practices: `references/` = Wissen
zum Lesen, `scripts/` = ausführbarer, deterministischer Code (nicht dem Modell
überlassen), `examples/` = Vorlagen. Verzweigungsspezifisches Wissen
(Rezepte) bleibt getrennt — nur das nötige Rezept verbraucht Kontextbudget.

### 4.2 SKILL.md-Gliederung (konkret)

1. **Frontmatter:** `name`, `description` mit expliziten Auslösern („Erstellt/
   validiert `.wmmod`-Pakete für WebMidgar. Nutzen bei: neuer NPC, neues
   Field, Dialog-Änderung, Textur-/Modell-Override …") — die Description
   ist das Routing-Signal und muss „was + wann" enthalten.
2. **Harte Regeln (immer zuerst):**
   - Nie Runtime-Code in Mods (ADR-007) — nur deklarative Dokumente und
     Mnemonic-Skripte.
   - Nie Originalbytes/extrahierte Original-Assets (ADR-017); Provenienz-
     Check ist Pflichtschritt.
   - Nur dokumentierte Mnemonics/Capabilities; im Zweifel Referenz lesen.
   - Iterationslimit *(Annahme: 5–8 Runden)*, danach an den Menschen
     eskalieren.
3. **Workflow (Kern):**
   0. Idee klassifizieren → Rezept wählen und laden.
   1. Paketstruktur + Manifest erzeugen (Schema-Referenz dazulesen).
   2. `validate-mod.sh` ausführen (totaler Compiler).
   3. Befundliste durcharbeiten: pro Befund minimaler Fix, dann revalidieren —
      Loop bis leere Liste oder Iterationslimit.
   4. `run-fixtures.sh` (sofern Tests konfiguriert).
   5. `check-provenance.sh`.
   6. `pack-wmmod.sh` → finales `.wmmod`.
   7. Ergebnisbericht: Validierung, Tests, Provenienz, bekannte Grenzen.
4. **Fehlerbehandlung:** explizite Eskalationspfade (Compiler-CLI fehlt →
   Vorbedingung melden; Befund unklar → Mod-Doktor-Ausgabe anhängen;
   Capability existiert nicht → zurückmelden statt improvisieren).
5. **Verweise:** wann welche Referenz zu lesen ist („bei script-add: zuerst
   `mnemonic-taxonomy.md` lesen").

### 4.3 Validierungs-Loop als Zentrum („totaler Compiler als Orakel")

```text
Idee → Entwurf (Manifest + Mnemonic-Dokumente)
     → wmmod compile --total --json        # vollständige Befundliste
     → Agent fixt Befunde (minimal, gezielt)
     → recompile → … bis leer oder Iterationslimit
     → check-provenance → fixtures/tests → pack
```

Voraussetzung: ein **maschinenlesbarer, stabiler CLI-Ausgabekanal** — JSON mit
Fehlercode, Schweregrad, mod-lokalem Pfad/Spanne, idealerweise Fix-Hinweis.
Die mod-lokalen Fehlermeldungen der Manifest-Validierung bilden die Basis;
der Mod-Doktor (S22) ergänzt als Diagnose-Backend für unklare Befunde.

### 4.4 Test-Hooks über fixture-gen/vitest

- **Muster A (Referenzvergleich):** Generierter Mod wird gegen ein Golden
  Fixture derselben Capability-Klasse geprüft (z. B. assembliert der
  script-add-Block zum erwarteten Bytecode-Muster?).
- **Muster B (neue Fixtures):** Aus dem generierten Mod wird per fixture-gen
  ein neues Fixture abgeleitet und unter vitest eingecheckt — jeder
  Skill-erzeugte Mod wird regressionsfest.
- *(Annahme)* Vitest läuft headless in Node; der Agent erhält Pass/Fail +
  Diffs als Text — gut verarbeitbares Feedback.

### 4.5 Provenienz-Regeln im Skill

ADR-017 wird als unverhandelbare Schrittfolge kodifiziert: Erlaubt sind vom
Nutzer bereitgestellte, neu erzeugte oder frei lizenzierte Assets mit
dokumentierter Herkunft; verboten ist alles, was dem Hashabgleich standhält.
`check-provenance.sh` läuft zwingend vor `pack-wmmod.sh`; ein Verstoß ist
harter Abbruch.

## 5. Technischer Lösungsansatz & benötigte Vorbedingungen im Repo

Leitgedanke: Der Skill ist bewusst „dumm" — das Modell liefert Ideen-
übersetzung und Fehlerkorrektur, alle Garantien liegen in deterministischen
Werkzeugen. Benötigte Bausteine:

| # | Vorbedingung | Stand laut Kontext | Bemerkung |
|---|---|---|---|
| V1 | **script-assembler-Promotion** (`tools/fixture-gen` → `packages/script-assembler`) | geplant | Stabile API/CLI nötig, damit Agenten ohne interne Tool-Pfade arbeiten. |
| V2 | **Studio-Compiler-Kern** (total, deterministisch, Node-fähig) | Konzept | Herzstück des Orakels; ohne ihn bleibt nur Schema-Validierung. |
| V3 | **Compiler-CLI mit JSON-Diagnostics** | nicht vorhanden *(Annahme)* | Kleine, kritische Adapter-Schicht: Exit-Codes, stabile Fehlercodes, Befundliste als JSON. |
| V4 | **Mod-Doktor** | geplant (S22) | Für den Skill reicht eine headless/CLI-Variante oder JSON-Report. |
| V5 | **Beispiel-Mods / Golden Fixtures** | Infrastruktur vorhanden, Inhalte auszubauen *(Annahme)* | „Trainingsmaterial": wenige, vollständige, kommentierte Mods pro Capability. |
| V6 | **Pack-Tool** (deterministisches `.wmmod`-ZIP) | nicht spezifiziert *(Annahme)* | Reproduzierbare Pakete, Hash-Stabilität. |
| V7 | **Generierbare Referenzdokumente** (Schema, Taxonomie → Markdown) | neu *(Annahme)* | Referenzen aus dem Quellcode generieren, sonst driftet Skill-Wissen von der Engine. |

Technisch implementiert der Skill das bewährte Muster „LLM erzeugt DSL/JSON →
Compiler validiert → Befundliste zurück an den Agenten" (TypeChat-Prinzip),
erweitert um einen zweiten Orakel-Pfad (Fixtures/Tests) und eine rechtliche
Schranke (Provenienz). Auf Decoding-seitige Garantien (Grammar-Constrained
Decoding) wird verzichtet: Der Skill bleibt plattformneutral; die Garanten
sitzen im Repo-Tooling, nicht im Inferenz-Stack.

## 6. Aufwandsschätzung

*(Grobe Annahmen in Personentagen (PT); kleines Team mit Repo-Kenntnis.)*

| Arbeitspaket | Umfang *(Annahme)* | Anmerkung |
|---|---|---|
| AP1: Compiler-CLI (JSON-Diagnostics, Exit-Codes) | 5–8 PT | setzt V2 voraus |
| AP2: script-assembler-Promotion + stabile CLI | 8–12 PT | größtes Einzelpaket, ggf. schon geplant |
| AP3: Referenz-Generator (Schema/Taxonomie → Markdown) | 3–5 PT | verhindert Doku-Drift; in CI verankern |
| AP4: Beispiel-Mods + Fixtures (1–2 pro Capability) | 5–8 PT | dient als Skill-Referenz und Testsuite |
| AP5: SKILL.md + 3 Rezepte + Scripts (MVP) | 5–8 PT | reine Skill-Arbeit — überraschend klein |
| AP6: Provenienz-Check + Pack-Tool-Härtung | 3–5 PT | ADR-017 als eigenständiger Gate-Schritt |
| AP7: Eval-Prompts, A/B-Tests, Modellvergleich | 4–6 PT | empfohlenes Vorgehen laut Skill-Best-Practices |
| **Summe MVP (AP1–AP6, v1-Capabilities)** | **~29–46 PT** | Großteil entfällt auf Repo-Vorbedingungen |
| **Summe inkl. Eval + v2-Capabilities** | **~45–70 PT** | v2-Rezepte bauen auf v1 auf |

**Kernaussage:** Der Skill selbst (AP5) ist ein Zwei-Wochen-Projekt. Die
Machbarkeit steht und fällt mit V1–V4 — die liegen aber ohnehin auf der
Studio-/Compiler-Roadmap: Der Skill reitet bestehende Investitionen.

## 7. Risiken & offene Fragen

### 7.1 Risiken

1. **Halluzinierte Mnemonics/Capabilities.** Das Modell erfindet Opcodes oder
   Manifest-Felder. *Mitigation:* Referenzen aus dem Quellcode generieren
   (V7); der totale Compiler lehnt Unbekanntes deterministisch ab; Regel
   „Referenz lesen statt raten". Restrisiko: valide, aber falsche Mnemonics.
2. **Parse-Semantik-Lücke.** Ein Paket kann valide und trotzdem inhaltlich
   falsch sein (Koordinaten, Trigger) — die Structured-Output-Forschung zeigt
   genau diese Grenze. *Mitigation:* Fixture-/Test-Hooks, Beispielvergleiche,
   menschliche Abnahme über Studio; keine „Auto-Publish"-Pfade.
3. **Qualität ohne GUI-Vorschau.** Der Agent sieht weder Field noch NPC —
   für Dialog/Logik akzeptabel, für Layout nicht. *Mitigation:* (a) zunächst
   nur text-/logiklastige Capabilities, (b) Headless-Render/Screenshot-Export
   prüfen *(offene Frage)*, (c) Studio als Verifikationsstufe.
4. **Rechtsrahmen-Einhaltung durch den Agenten.** Ein „hilfsbereiter" Agent
   könnte Originalassets extrahieren oder dem Hashabgleich knapp entkommende
   Nachbauten erzeugen. *Mitigation:* Provenienz-Check als harter, nicht-
   promptbasierter Gate-Schritt; Tool-Restriktionen (kein Zugriff auf
   Original-Container); Verbotsliste im SKILL.md.
5. **Variablenbank-Kollisionen (v2, variable-claim).** Agenten-gewählte
   Variablen können mit Basisspiel oder anderen Mods kollidieren.
   *Mitigation:* `variables-bank.md` als Register + Kollisionsprüfung im
   Compiler (Befund statt stiller Konflikt). *Offen:* Wer vergibt Namespaces?
6. **Modellabhängigkeit der Reparaturschleife.** Reasoning-Modelle profitieren
   von Feedback-Loops, schwächere Modelle plateauen früh. *Mitigation:*
   Iterationslimit + saubere Eskalation; Eval über mehrere Modelle.
7. **Skill-Sicherheit generell.** Öffentliche Skill-Marktplätze enthalten
   nachweislich manipulierte Skills (Prompt Injection). *Mitigation:* Skill
   lebt im eigenen Projekt-Repo, wird wie Code reviewt, keine Drittquellen.
8. **Drift zwischen Skill und Engine.** Schema-/Taxonomie-Änderungen lassen
   Rezepte veralten. *Mitigation:* generierte Referenzen (V7), Versionsangabe
   im Frontmatter, CI-Test „Skill-Beispiele kompilieren".

### 7.2 Offene Fragen

- Wo lebt das Mod-Projekt: eigenes Repo, Unterordner im Monorepo, beides?
- Wie wird Kompatibilität Manifest-Schema-Version ↔ Skill-Version abgesichert
  (Frontmatter-Feld? CLI-Handshake)?
- Gibt es einen Headless-Preview-Pfad (Screenshot/Field-Export in Node) für
  minimale visuelle Rückmeldung? *(Annahme: aktuell nein)*
- Welches Iterationsbudget gilt pro Capability-Klasse?
- Bekommt der Mod-Doktor eine CLI/JSON-Schnittstelle, oder bleibt er GUI-only?

## 8. Abhängigkeiten

| Abhängigkeit | Rolle für den Skill | Kritikalität |
|---|---|---|
| **MS3** *(Annahme: Studio-Compiler/Compiler-CLI-Meilenstein)* | Liefert das Validierungs-Orakel (total, Node-fähig, JSON-Befunde) | **Blocker** — ohne totalen Compiler kein Compiler-in-the-loop |
| **S22 — Mod-Doktor** | Vertiefte Diagnose unklarer Befunde; menschliche Abnahme-Ansicht | Hoch, nicht blockierend (MVP kommt mit Rohbefunden aus) |
| **S25** *(Annahme: script-assembler-Promotion)* | Stabile Assemblierungs-API/CLI für den Agenten | **Blocker** für script-add/-patch-Rezepte; texture-/dialogue-only-MVP ohne möglich |
| Studio-Strang MS1–MS8 insgesamt | Verifikations-/Qualitätssicherungsebene für Skill-Output | Komplementär; Skill wartet nicht auf fertige GUI |

Sequenzierung: MVP startet, sobald MS3 (Compiler-CLI) und — für Skript-
Capabilities — S25 abgeschlossen sind; S22 verbessert den Skill nachträglich.

## 9. Empfehlung / Stufenplan

**Empfehlung: Ja — als kleines eigenes Arbeitspaket parallel zum Studio-Strang
aufsetzen, aber hinter den Compiler-Vorbedingungen priorisieren.**

- **Stufe 0 — Vorbedingungen schließen (MS3, S25):** Totalen Compiler hinter
  eine CLI mit JSON-Befundliste bringen; script-assembler promoten. Ohnehin
  Roadmap — der Skill gibt dem Ausbau nur ein konkretes Qualitätsziel:
  „agententaugliche Fehlermeldungen".
- **Stufe 1 — MVP-Skill (v1-Capabilities):** SKILL.md, Referenz-Generator,
  2–3 Beispiel-Mods, Validierungs-Loop, Provenienz-Gate, Pack-Tool. Bewusst
  klein: texture-override, dialogue-replace, script-patch.
- **Stufe 2 — Rezepte & Tests:** Kochrezepte („neuer NPC", „neues Field",
  „Dialog-Quest"), fixture-gen/vitest-Hooks, Eval-Prompts und A/B-Messung
  (Agent mit vs. ohne Skill: Erfolgsrate, Iterationen bis valide).
- **Stufe 3 — v2 & Studio-Integration:** entity-add, script-add, dialogue-add,
  variable-claim inkl. Variablenbank-Register; Übergabe-Workflow „Skill
  generiert → Studio/Mod-Doktor verifiziert → Mensch akzeptiert".
- **Leitprinzipien:** (1) Alle Garantien in deterministische Werkzeuge,
  nicht in den Prompt. (2) Eval-getrieben entwickeln. (3) Provenienz niemals
  delegieren. (4) Mensch für Inhalt/Ästhetik in der Schleife lassen — der
  Skill ersetzt die Hürde, nicht das Urteilsvermögen.

---

## 10. Quellen

**Agent-Skills / SKILL.md-Format:**

1. Anthropic Engineering: „Equipping agents for the real world with Agent Skills"
   (16.10.2025; offener Standard seit 18.12.2025) —
   https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
2. Agent Skills Open Standard / Spezifikation — https://agentskills.io/specification
3. Anthropic Skill-Authoring-Best-Practices —
   https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
4. anthropics/skills (offizielle Beispiel-Skills, u. a. skill-creator) —
   https://github.com/anthropics/skills
5. „Claude Code skills: architecture, limits, and design patterns for scale" —
   https://github.com/liatrio-labs/claude-code-gauntlet/blob/main/docs/research/artifacts/18-skill-architecture-limits-and-progressive-disclosure.md
6. Skill-Best-Practices-Konsolidierung —
   https://github.com/kalepail/skills/blob/main/research/skill-best-practices.md

**LLM-Generierung mit Validierungs-/Compiler-Schleife:**

7. Microsoft TypeChat (Schema-Engineering, Validierung + Repair-Loop) —
   https://github.com/microsoft/TypeChat
8. Zhang/Kothari: „Unlocking LLM Code Correction with Iterative Feedback
   Loops" — https://arxiv.org/html/2606.17514
9. „Helping LLMs improve code generation using feedback from testing and
   static analysis" (Springer, 2026) — https://link.springer.com/article/10.1007/s44163-026-01009-5
10. „Structured Outputs and Constrained Decoding in Production" —
    https://www.tmls.nyc/research/structured-outputs-constrained-decoding
11. Überblick Structured-Output-Ansätze (Strict-Modi, XGrammar/Guidance/
    Outlines, JSONSchemaBench) — https://collinwilkins.com/articles/structured-output

**KI-Agenten im Game-/Minecraft-Kontext:**

12. Wang et al. (NVIDIA u. a.): „Voyager: An Open-Ended Embodied Agent with
    Large Language Models" — https://arxiv.org/abs/2305.16291 ,
    https://github.com/MineDojo/Voyager
13. *(Recherchebefund)* Ein etabliertes System, das klassische PC-Spiele-Mods
    aus natürlicher Sprache erzeugt, wurde nicht gefunden — bekannte Beispiele
    betreffen KI *in* Mods (KI-gesteuerte NPCs) oder Agenten, die spielen
    (Voyager), nicht Agenten, die Mod-Pakete erzeugen. Der Skill wäre hier ein
    früher, formatbedingt gut geeigneter Fall.

**Sicherheit von Agent-Skills:**

14. Snyk: „ToxicSkills"-Studie (Prompt Injection in öffentlich verteilten
    Skills) — https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/ ;
    Anthropic-Sicherheitshinweise zu Skills siehe Quelle 1.

**Projektinterne Grundlagen (Kontext, keine externen Quellen):**

ADR-007 (kein Runtime-Code in Mods), ADR-014 (deklarative NAM-nahe
Mod-Fields), ADR-017 (Provenienz-Schleuse, Hashabgleich), Studio-Compiler-
Konzept (total/deterministisch/Node-fähig), Mod-Doktor (S22), Studio-Strang
MS1–MS8, tools/fixture-gen, packages/script-assembler (geplant),
github.com/dudhasch/OpenMidgar.