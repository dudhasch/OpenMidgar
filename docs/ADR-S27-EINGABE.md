# ADR-024 — Eingabe-Abstraktion: Aktionen als taktgebundene Daten (S27)

**Status:** Akzeptiert (2026-08-10). **Kontext:** ROADMAP-S27-S36, S27.

## Entscheidung

1. **Ein semantischer Aktionsraum** (`ok, cancel, menu, up/down/left/right,
   run, pageUp/pageDown, switch`) für alle Quellen (Tastatur, Gamepad API,
   Touch/Pointer). Alles hinter der Abbildung — Aufzeichnung, Replay, Digest —
   kennt nur Aktionen; die Quelle (`sourceKinds`) ist **Metadatum** und fließt
   nachweislich nicht in den Digest (`recordingDigest` schließt `meta` aus).
2. **Abtastung genau einmal pro Tick.** Flanken (`pressed/released`) entstehen
   aus dem Vergleich zweier Tick-Abtastungen im `InputSampler`, nie aus
   Event-Handlern. Ein Ereignis, das zwischen zwei Ticks beginnt und endet,
   existiert für die Spiellogik nicht (Fixture-Test belegt das).
3. **Ganzzahlige Achsquantisierung** (🔵 Eigenentwurf): 8 Stufen je Richtung,
   Deadzone 0,25, nur IEEE-exakte Operationen — Begründung R9
   (Replay-Portabilität; Float-Achswerte sind treiberabhängig).
4. **Richtungs-Normalisierung im Sampler:** Richtungsaktionen im Aktionsrahmen
   werden aus der *finalen* Achse abgeleitet (digital = Vollausschlag, der
   betragsgrößte Analogbeitrag gewinnt). Ohne diese Normalisierung wären
   Stick- und Tastenströme strukturell nie digestgleich — die
   Quellunabhängigkeit wäre per Konstruktion verletzt.
5. **Belegungen und Touch-Layout sind Daten** (`BindingTable`,
   `TouchLayoutSpec` + DOM-freier Resolver mit Safe-Area als hartem Rand).
   `battle`, `world` und `minigame` sind reservierte Tabellenplätze (`null`);
   ein reservierter Kontext liefert die **leere** Abtastung, keinen Durchgriff.
6. **Achskonvention:** +x = rechts, +y = oben (Field-Grundriss). Die
   Stick-Umkehr (oben = negativer Rohwert) ist ein Belegungsdatum
   (`gamepadAxes.invertY`), keine Sonderlogik.

## Nachweise (packages/input, 29 Fixture-Tests)

- **Dreifach-Replay:** dieselbe semantische Folge aus Tastatur-, Gamepad- und
  Touch-Ereignissen ⇒ identischer Strom- UND FieldSession-Digest; Gegenprobe:
  ein um einen Takt verschobener Strom ändert beide Digests (die Bewegung
  läuft dafür bis zum letzten Takt — sonst wäre der Session-Digest gegen die
  reine Verschiebung translationsinvariant und die Gegenprobe blind).
- **Nullwert-Zweitrechnung:** Gleichheit zusätzlich nur über Takte mit
  Eingabe gerechnet; deren Anzahl muss > 0 sein.
- **Belegungsänderung wirkungsfrei im Replay:** Aufzeichnung trägt Aktionen;
  Replay (`fieldInputPlan`) nimmt keine Belegung entgegen — andere Taste,
  gleiche Aktion, gleicher Digest (Test).
- **Gamepad-Lebenszyklus:** Trennung mitten im Lauf ⇒ `released`-Flanken am
  nächsten Tick, kein eingefrorener Letztzustand; Zustand vor Wiederverbindung
  wird verworfen (Test).
- **Quantisierung:** Property-Test über 1000 seeded Zufallswerte (Ganzzahl,
  Wertebereich, Fixpunkt über die Rückabbildung, Monotonie, Punktsymmetrie,
  nie −0).
- **Touch-Layout:** vier Viewport-Klassen inkl. Safe-Area als Golden-Werte
  des Resolvers; Überlappungsfreiheit; `hitTest`-Ellipsen.

## Bewusste Abweichungen / Restlücken

- **Golden-Screenshots** des Touch-Overlays: durch Resolver-Goldens ersetzt
  (der Resolver ist die einzige Layoutquelle; die Overlay-Schale zeichnet nur
  dessen Ausgabe). Browser-Sichtprüfung: Overlay in der Mobil-Emulation
  vollständig im sichtbaren Viewport (visualViewport-Umstellung), am Desktop
  verborgen.
- **Bedienbarkeitsnachweis am R7-Referenzgerät:** entfällt weiterhin per
  ADR-019 (kein Referenzgerät); Nachhol-Auslöser unverändert.
- **Gamepad-Messmatrix** (Standard-Mapping über Browser × Controller): ohne
  physische Controller nicht messbar — 🟡 offen, Nachweis beim ersten
  Nutzerlauf über die Fähigkeitsanzeige der App-Shell nachziehen.
- Analoge Eingabe des PC-Originals im Field: ungeprüft, für die FieldSession
  ohnehin auf Vorzeichen kollabiert (die Feinstufung bleibt der Weltkarte
  vorbehalten).
