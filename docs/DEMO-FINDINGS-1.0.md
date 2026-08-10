# Demo-Findings — 1.0-Integrationstest (2026-08-10)

Testkampagne der integrierten Demo `apps/demo/game.html` gegen die lokale
Installation (Dev-HTTP-Quelle `/ff7data`). Jedes Finding wird hier dokumentiert,
bewertet und mit Fix-Status geführt. Konvention: F-Nummern sind stabil.

| # | Bereich | Beobachtung | Bewertung | Status |
|---|---|---|---|---|
| F01 | Build | `vite.config.ts` kannte die Pakete world-runtime/formats-battle/battle-runtime/render-battle nicht (Aliasliste veraltet) | Blocker für die Seite | ✅ behoben (Aliase ergänzt) |
| F02 | Field/Modelle | NPC-Modelle luden nie: `modelIndex` wird erst durch Script-Opcodes während der ersten Ticks gesetzt, der Lader lief aber einmalig beim Betreten. Spielermodell erschien nur über den Manifest-0-Fallback | Kernfehler der Integration | ✅ behoben (Lazy-Load je Tick in `game-demo.ts`) |
| F03 | Field/Hintergrund | `md1stin`: große schwarze Löcher — Ursache war das Tiefenfenster: vorberechnete NDC-Tiefen (z·zScale) fielen mit NEAR=100/FAR=10000 aus [−1,1], 795/795 Layer-0-Tiles wurden weggeclippt (nur 73/1115 Tiles sichtbar). Fix: ordnungserhaltende Klemmung in `render-field/src/background.ts`; 1115/1115 Tiles in allen 6 Kontroll-Fields | Kernfehler — Sichtqualität | ✅ behoben (Sichtnachweis `.shots/bg-fixed.jpg`) |
| F04 | Field/Interaktion | Keine Talk-Interaktion vorhanden. Fix: `requestEntityScript(entity, entry)` im Interpreter (TALK_SCRIPT_SLOT=1, Leerspan-Erkennung über Slot-Wiederholungen 288.665/0-Gegenbeleg), Talk-Auslösung in FieldSession (TALK_RANGE=40 🟡, confirm-Flanke, nächster NPC). Sichtnachweis: OK neben dem Bahnsteig-Wächter liefert dekodierten Text „Received "Potion"!" wie im Original; Folgedialog + Sound 360 laufen | Kernfehler — behoben | ✅ (Slot-1-Konvention bleibt 🟡) |
| F05 | Kampf | Echter Kampfmodus integriert: Zufalls-/Script-Encounter → BattleStarter → BattleSession; ATB, Kommandos (Angriff/Flucht), Gegner-KI, Sieg/EXP/AP/Gil/Fanfare, Rückkehr ins Field mit battle-finished-Event. Sichtnachweis `.shots/battle-fixed.jpg` | Integrationslücke | ✅ integriert (Bühne=Ersatzscheibe, Party=Quader, Kamera=Intro-Kamera — 🔴-Formatlücken) |
| F06 | Weltkarte | Echte World↔Field-Einstiegspunkte sind 🔴 (S29); die Demo nutzt eine kuratierte Ersatz-Ortsmarke nahe der Startposition und F9 als Ersatzwechsel | Bekannte Formatlücke, Demo-Ersatz dokumentiert | 🟡 Ersatz aktiv |
| F07 | Menü | Menü ist lesend (S21-Stand): kein Ausrüsten/Benutzen/Speichern | Bekannte Ausbaustufe | 🟡 offen |
| F08 | Charaktergröße | Sichtvergleich der Feldmodell-Skalierung (scale/512-Hypothese) gegen Referenzbilder steht aus | Kalibrierung | 🔜 geplant |
| F09 | Audio | music/sound-HostRequests werden nur geloggt (music.idx→OGG-Kette wäre seit S37 möglich) | Integrationslücke, nicht 1.0-kritisch | 🟡 offen |
| F10 | Weltkarte | Demo-Startposition (Rastermitte) liegt auf Wasser (Klasse 3) — zu Fuß bewegungsunfähig; erst Fahrzeugwechsel (Highwind) macht die Karte befahrbar | Startplatzierung | 🔧 Landstart suchen |
| F11 | Weltkarte | Terrain rendert als Klassenfarben-Diagnose; Weltkarten-Texturen sind nicht erschlossen | Bekannte S28-Lücke | 🟡 offen |
| F12 | Menü | Party-Ansicht zeigt „MP 122/116" (aktuell > Maximum) — Verdacht Feldvertauschung mp/mpMax in Savemap-Lesung oder Anzeige | Datenlesung prüfen | 🔜 messen |
| F13 | Kampf | Aufstellung falsch: `placeFormation`/`placeParty` deuten Slot-Koordinaten über die FIELD-Konvention (ff7ToScene) — Gegner unter dem Boden (y −1700/−2000), Party schwebt (+3200). Gegnermodelle selbst laden korrekt („aq" 3 Teile, „ar" 6 Teile) | 🟡-Deutung widerlegt durch Sichtbefund | 🔧 Subagent misst Konvention |
| F14 | Field/Encounter | Zufallskämpfe feuern in Stadt-Fields (md1stin: Encounter 302/303 alle ~100 bewegte Takte) — im Original hat der Bahnhofsvorplatz keine Zufallskämpfe. Encounter-Aktivierungs-Gating (Sektion-7-Flag bzw. Script) fehlt | Spielbarkeit | 🔜 Gating messen (nach Talk-Agent) |
| F16 | Field/Hintergrund | Verwürfelte Kachelblöcke in md1_1 (Mosaik-Flecken), nmkin_1 (Magenta-Rauschen), md8_1 (halbe Bildfläche) — md1stin sauber. Quellregion/Texturseite/bpp-Deutung einzelner Tiles falsch | Sichtqualität, systematisch | 🔧 Subagent misst Trennvariable |
| F17 | Weltkarte | encounter-check schien nie zu feuern — Ursache: Die Session würfelt bereits (Check alle 32 Schritte, Schwelle 24/256 ⇒ ~1 Treffer je ~350 Takte), und die Demo filterte das Ergebnis ein ZWEITES Mal (roll<16). Doppel-Gating entfernt | Kein Paketfehler | ✅ behoben (Demo) |
| F15 | Field/Gateway | Gateway-Übertritt feuert nicht: die Austrittslinie von md1stin liest sich als (353,3669,29368)→(353,1049,400) — nur die Deutung [1],[2] des ersten Punkts liegt auf dem Walkmesh (placeAt-Probe), die Linie wäre eine Diagonale über die halbe Karte. Achs-/Offsetdeutung des 24-B-Gateway-Records prüfen | Feldwechsel blockiert | 🔜 messen (nach Talk-Agent) |

| F18 | Menü | Inventar-IDs außerhalb der Item-Namensliste zeigen „?215/?256/?258" — vermutlich Waffen-/Rüstungs-/Materia-Bereiche, deren Namen in anderen Kernel-Sektionen liegen | Kosmetisch | 🟡 offen |
| F19 | Kampf | Aufstellung nach Fix korrekt (Gegner links am Boden, Party rechts — Battle-Basis x-rechts/y-ab/z-Tiefe, 91,8 % Slots auf Boden 0, Kameras 1000/1000 über dem Boden); offen: z-Spiegelfrage (Sichtvergleich), Gameplay-Kamera (co.bin/camdat 🔴), echte Bühne (Stage-Format 🔴), Party-Battle-Modelle | Sichtqualität | 🟡 teilbehoben |

## Testprotokoll (fortlaufend)

- ✅ Boot über Dev-HTTP-Quelle: 8 Archive indexiert, maplist (787 Namen), KERNEL.BIN, scene.bin, WM0.MAP, wm0.ev, Spielstand geladen.
- ✅ Start-Field `md1stin` betreten, Spielermodell (aaaa.hrc = Cloud) steht auf dem Walkmesh, Kamera + Letterbox korrekt.
- ✅ Bewegung: 45 Takte „hoch" ⇒ Tri 0→22, y 27462→27659, Blickrichtung 0→90°; Solver-Events plausibel.
- ✅ Script-Läufe: NPC-Richtungen und Animation (Actor 11: anim id 6, loop) werden vom Interpreter gesetzt.
- ✅ NPC-Modelle nach F02-Fix geladen (Actors 2/9/10); „pinkes Objekt" neben Cloud ist die POTION-Flasche (Pickup-Objekt, korrekt klein) — kein Fehler.
- ✅ Talk-Kette End-to-End: OK am Wächter ⇒ Talk-Script ⇒ MESSAGE dialogId 6 ⇒ dekodierter Text „Received "Potion"!" ⇒ Folgedialog ⇒ Sound-Requests ⇒ Dialog schließbar.
- ✅ Zufallskampf: Encounter 302/303 in md1stin; voller Ablauf ATB→Angriff→Gegner-KI→Sieg (EXP 36/AP 4/Gil 22) → Rückkehr, mehrfach reproduziert; Kampf robust auch bei gehaltener Bewegung.
- ✅ Menü: Party-Ansicht mit echten Spielstandsdaten (Tifa Lv 17, Cloud Lv 18, Yuffie Lv 17), Gegenstandsseiten mit deutschen KERNEL-Namen, Öffnen/Blättern/Schließen.
- ✅ Weltkarte: Landstart (Spiralsuche, F10), zu Fuß begehbar, Highwind fliegt über alles, Terrain-Streaming + Verfolgerkamera, Höhenverfolgung.
- ✅ Welt→Field: Ortsmarke + OK ⇒ world-transition ⇒ md1stin geladen (zweifach bestätigt); F9/Buttons wechseln Field↔Welt.
- ✅ Kampf-Sicht nach F13-Fix: Gegner-MPs als texturierte Modelle am Boden links, Party rechts (`.shots/battle-fixed.jpg`).
- ✅ Musik verdrahtet (F09): music-HostRequests → music.idx (1-basiert→0-basiert) → OGG; Kampf „bat", Sieg „fanfare", danach Feldmusik zurück (Autoplay-Sperre wird toleriert).
- ✅ Charaktergröße (F08): Cloud ≈ 68 px auf 640×480 im md1stin-Startblick, Proportionen zu Türen/Zug/Potion stimmig (scale/512-Hypothese sichtplausibel); pixelgenauer Web-Referenzabgleich scheiterte an CORS — offen als Feinkalibrierung.
