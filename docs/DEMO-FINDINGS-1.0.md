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

## Sichtbewertungskampagne 2026-08-10 (110 Aufnahmen, Nutzerurteil)

110 automatisiert erzeugte Aufnahmen der Demo (`apps/demo/.shots/`, Fragebogen
`bewertung.html`, Rohdaten `webmidgar-bewertung.json`) wurden vom Projektinhaber
bewertet: **3× „sieht gut aus", 23× „auffällig", 80× „katastrophal"** (4 offen).
Kein Bereich blieb ohne Befund; die Menü- und Weltkartenkategorien wurden zu
100 % als katastrophal bewertet. Die 103 Einzelbefunde fallen auf sieben
Ursachen zurück — F20–F26. Die Nummern F20–F23 sind im Code belegt, nicht
vermutet.

| # | Bereich | Beobachtung | Bewertung | Status |
|---|---|---|---|---|
| F20 | Field/Modelle | **Alle Feldfiguren liegen flach am Boden** („Cloud liegt auf dem Boden, Kopf nach rechts"; bei anderen Blickrichtungen dreht sich der liegende Körper mit). Ursache belegt: `buildActor` legt die zentrale FF7→Scene-Basis als `root.quaternion` an (actor.ts, ADR-009: „trägt als EINZIGE Stelle die Basis"), `game-demo.ts:792` und `:826` schreiben danach `root.rotation.y` — die Euler-Zuweisung **ersetzt das Quaternion vollständig** und löscht damit die Z-hoch→Y-hoch-Basis. Übrig bleibt der rohe FF7-Modellraum: die Figur liegt, und `facing` rotiert sie in der Bodenebene | Kernfehler — betrifft jede Field-Aufnahme | ✅ behoben: `setActorFacing` (render-actor) multipliziert den Gierwinkel um die FF7-Hochachse **auf** die Basis; die Demo setzt `root.rotation` nicht mehr. Zwei Abnahmetests (Hochachse bleibt (0,1,0) über alle Winkel; Gierabbildung deckungsgleich zur alten Absicht) |
| F21 | Field/Modelle | **„Lila Sprites" statt Figuren** — und die Magenta-Hypothese war FALSCH. Gemessen (Diagnosehaken `onMissing` in der Modellkette, acht Fields): 0 fehlende `.hrc/.rsd/.p/.tex`, 0 Texturslot-Überläufe, 0 Ersatzkapseln, 0 Materialien mit `0xff00ff`. Die „lila Sprites" sind **texturierte NPCs, die flach am Boden liegen** — ihre Kleidung ist rot/violett. Ursache: Der Demo wies eine Animation nur zu, wenn ein Script eine setzte; sonst lief die Figur in der **Bindpose**, und die ist keine Standhaltung, sondern die unposierte Bone-Kette (`boneRotSumme = 0` gemessen). Auch der Spieler lief ohne jede Animation | Kernfehler — Sichtqualität | ✅ behoben: NPCs und Spieler bekommen die Ruheanimation (Index 0, 🟡 Konventionshypothese); Sichtnachweis `.shots/nach_f21c_lauf.jpg` |
| F22 | Field/Hintergrund | **„Verschwommene Blöcke" überall dort, wo animierte Tiles gehören** (Flammen in md8_1, Flipper in mds7pb_1, Gondelbahn in bigwheel, 20 weitere Fields). Ursache belegt: `buildBackgroundMesh` kennt weder Animationsparameter noch Zustandsbits — es zeichnet **alle Zustände einer Animationsgruppe gleichzeitig übereinander**. Das Ergebnis ist genau die beschriebene Unschärfe, und bewegte Elemente fehlen als Bewegung komplett | Kernfehler — systematisch, größter Einzelposten | ✅ behoben: `param` (u8@28) und `state` (u8@29) im Parser belegt und ausgewertet; je Parameter ist genau ein Zustand sichtbar. 🟡 Welcher, schaltet die Demo reihum weiter — im Original entscheiden das die Parameter-Opcodes des Field-Scripts (offen) |
| F23 | Field/Hintergrund | **Schwarze Flächen statt Rauch, Wasser, Feuer** (ujunon1 Schornstein, uutai1 Fluss, nrthmk, gonjun1, cosin1). Ursache belegt: der Tile-Shader in `background.ts` kennt nur „undurchsichtig oder verworfen" (`discard` bei a<0.5, `outColor.a = 1.0`, `depthWrite` immer an). Die FF7-Mischmodi (Mittelwert / additiv / subtraktiv / 25 % additiv) fehlen vollständig — additiv gemischte Effekttiles werden dadurch als deckende dunkle Blöcke gezeichnet | Kernfehler — Sichtqualität | ✅ behoben: `blending` (u8@30) und `typeTrans` (u8@32) im Parser belegt; getrennte Zeichenstapel je Mischart mit additivem bzw. gemitteltem Blending und `depthWrite: false`, deckend zuerst. Sichtnachweis: Schornsteinrauch in `ujunon1` und der Fluss in `uutai1` erscheinen statt schwarzer Blöcke |
| F24 | Menü | Menü-UI **durchgängig als katastrophal bewertet** (10/10): Rahmen, Schrift, Anordnung entsprechen nicht dem Original — die Demo zeigt eine Diagnosetabelle, kein FF7-Menü. Zusätzlich inhaltlich: Materia werden unter „Gegenstände" gelistet, Itemnamen teils falsch (`?307`, `?260`, s. F18) | Ausbaustufe + Datenlesung | 🟡 offen (Nachfolger von F07) |
| F25 | Weltkarte | Weltkarte **durchgängig katastrophal** (13/13): „KOMPLETT FALSCHE FARBEN — 3D-Modell an sich plausibel". Das Terrain rendert weiterhin die Klassenfarben-Diagnose (F11). Ausdrücklicher Referenzwunsch des Projektinhabers: **an FF7-Landscaper orientieren**. Nebenbefund: bei „3× Tab" ist kein Fahrzeugmodell erkennbar | Bekannte Lücke, jetzt priorisiert | 🟡 offen (verschärft F11) |
| F26 | Kampf | 19/27 katastrophal. Bestätigt und zusammengefasst: **keine Kampfbühne** (schwarzer Hintergrund), **Party wird nicht gerendert** (nur Quader bzw. gar nichts), **Gegnermodelle erscheinen verzögert** (die ersten Takte zeigen Farbflächen) **und sind viel zu klein**, Blickrichtung der Gegner vermutlich gespiegelt, **HUD nicht im Originalstil** (Diagnosekasten statt FF7-Kampfmenü) | Sammelbefund über F05/F19 hinaus | 🟡 offen |

| F27 | Field/Modelle | **Die Gehanimation legt die Figur flach.** Beim Umschalten des Spielers auf Animationsindex 1 (aaaa.hrc, 8316 B ≈ Bewegungszyklus) kippt Cloud um; mit Index 0 steht er. Die Frames der `.a` tragen eine Wurzelrotation, die sich mit der Wurzelrahmen-Korrektur (`ROOT_FRAME_FIX_DEG`) und der von uns gesetzten Blickrichtung beißt. Der Umschalter ist deshalb bewusst nicht aktiv — die Figuren stehen beim Gehen | Sichtqualität — blockiert die Laufanimation | 🔜 Wurzelrotations-Semantik der `.a`-Frames gegen die selbst gesetzte Blickrichtung messen |

Zuordnung ohne neue Nummer: „MP 122/116" → F12 · `?215/?257/?307` → F18 ·
Weltkartentexturen → F11 · Kampfbühne/Party-Modelle → F05/F19 ·
fehlendes Menü-Handeln → F07.

## Sichtbewertung Runde 2 (117 Aufnahmen, nach F20–F23)

Zweite Kampagne mit **anderen** Szenen: 34 neue Fields (gleichmäßig über die 640
nicht in Runde 1 verwendeten gestreut), zwei neue Kategorien **Story-Dialoge**
(18) und **Hintergrund-Animation** (12), dazu Bewegung (12), Kampf (25),
Weltkarte (10), Menü (6). Bewertet: 98 von 117 — **13× gut, 27× auffällig,
58× katastrophal**.

Die Fixes wirken messbar: „gut" stieg von 3/106 auf 13/98, und der Fluss in
Wutai (F23) wurde dreimal mit „gut" bewertet. Zwei Kategorien bleiben ohne
jedes „gut": Bewegung/Haltung (12/12 katastrophal, ausschließlich wegen der
Figurengröße) und Menü (6/6).

| # | Bereich | Beobachtung | Bewertung | Status |
|---|---|---|---|---|
| F28 | Field/Kamera | **„Chars viel zu klein" ist ein KAMERA-, kein Modellproblem.** Gemessen (`kameraSonde`, 12 Fields): Die Modellhöhe ist bestandsweit konstant **35,4 Welteinheiten**, und der Skalenfaktor ist überall **512/512 = 1** (`scaleGlobal` und Modellskala sind in allen geprüften Fields 512). Die Bildgröße der Figur schwankt trotzdem um Faktor 5: `md1stin` 54 px, `jail4` 44 px, `mds5_i` 50 px, `tin_1` 49 px — alle unbeanstandet; dagegen `nvmin1_1` 29 px, `startmap` 23 px, `rkt_i` 22 px, `sinin1_1` 18 px, `farm` 17 px — alle beanstandet. Die Trennlinie liegt sauber bei ~40 px. Ursache der Streuung ist die **Kameradistanz** (505 bei `md1stin` gegen 2080 bei `farm`, Faktor 4) bei unskaliertem Modell | Kernfehler — häufigster Einzelbefund beider Runden | 🔜 Verdächtig ist die Behandlung der Kameratranslation: FF7 legt sie im Kamerarahmen ab, die Weltposition ist `−Rᵀ·T`. Gegenprobe: Bringt die korrigierte Translation `farm` von 17 px auf ~45 px? |
| F29 | Dialoge | **Steuercodes werden als Buchstaben ausgegeben.** Ursache belegt im Code, nicht vermutet: `decodeFieldDialogs` (field-runtime/src/dialog.ts) nutzt `buildAsciiTable(DEFAULT_ASCII_OFFSET)` — eine **rein lineare ASCII-Tabelle ohne jede Steuercode-Behandlung**. Bytes oberhalb des ASCII-Fensters landen dadurch als Latin-1-Glyphen (`Ò`, `Ó`) oder als Ersatzzeichen (`◇`/`�`) im Text. Sichtbar in jedem der 18 Story-Dialoge; in `del1` werden dadurch drei getrennte Sprechblasen in ein Fenster gequetscht | Kernfehler — betrifft jeden Text im Spiel | 🔜 Steuercode-Tabelle einführen: Farbcodes, `{PAUSE}`, `{CHOICE}`, `{OK}`, **Zeilenumbruch** und **Seitenwechsel** sowie die Charakternamen-Platzhalter. Referenztabelle: `ff7-asset-loader/char-map.js` in Kujata |
| F30 | Field/Hintergrund | **Schwarze Blockränder um animierte Kacheln** („block pixel für animationen sichtbar", 9× in Runde 2). Unser Tile-Shader kennt nur `discard` bei `alpha < 0.5`; Kujata dagegen führt je Palettenfarbe ein `noRender`-Merkmal und setzt es für **schwarze Pixel**, sowohl im Palettenpfad als auch bei Direktfarbe (`if (!usePalette && paletteItem.isBlack)`). Ohne diese Regel bleibt das Schwarz der Effektkacheln deckend und rahmt jede animierte Kachel sichtbar ein | Kernfehler — Sichtqualität | 🔜 Schwarzregel je Palettenfarbe umsetzen; Wechselwirkung mit F23 beachten (bei additiver Mischung ist Schwarz ohnehin neutral, bei deckenden Kacheln nicht) |
| F31 | Field/Hintergrund | **Verwürfelte Kachelblöcke (F16) haben eine benannte Ursache.** Kujata wählt die Quellkoordinaten nach der Regel `if (tile.layerID > 0 && tile.textureId2 > 0 && tile.depth !== 0)` → dann `srcX2`/`srcY2` **mit `textureId2`**, sonst `srcX`/`srcY` mit `textureId`. Unser Parser kennt `srcX2`/`srcY2`, aber **kein `textureId2`** — die zweite Quellkoordinate wird also gegen die falsche Texturseite gelesen. Ebenso relevant: `usePalette` gilt bei Kujata nur für `depth === 1` | Kernfehler — erklärt F16 | 🔜 `textureId2` (u8@36, in `md8_1` mit den Werten 0/15/16 belegt) parsen und die Auswahlregel übernehmen |
| F32 | Field/Hintergrund | **Rückschritt durch F23:** In `sbwy4_6` liegt der Wasserhintergrund über den eigentlichen Texturen. Mein Zeichenpass sortiert nur nach „deckend vor gemischt" und ignoriert Layer und Tiefenschlüssel — eine gemischte Kachel aus Layer 1 landet dadurch über allem, was danach käme. Kujata teilt die Stapel nach **Layer-ID, Z-Index, param, state UND transType** auf; meine Aufteilung ließ Layer und Z weg | Von mir eingeschleppt | 🔧 Aufteilung um Layer-ID und Z-Index ergänzen, Reihenfolge Layer→Z→Mischart |
| F33 | Kampf | **Party sind blaue Quader** (in Runde 2 zehnmal wörtlich benannt), Gegner zusätzlich „viel zu klein" — dieselbe Größenfrage wie F28, nur im Kampfraum. Ohne Party-Battle-Modelle und ohne Bühne ist die Kategorie nicht sinnvoll bewertbar; 15 von 25 Bildern katastrophal, kein einziges „gut" | Bekannte Lücke, jetzt quantifiziert | 🟡 offen (s. F05/F19/F26) |
| F34 | Weltkarte | Unverändert „Farbe falsch, 3D-Modelle gut". Referenzwunsch bleibt **ff7-landscaper**; aus dem README ließen sich keine Formatdetails ziehen, die Texturzuordnung steckt im Quellcode (`src/`, `src-tauri/`) und in `docs/map-state.md` | Bekannte Lücke | 🟡 offen (F11/F25) |
| F35 | Field/Modelle | **Fehlende 3D-Objekte:** In `junonr2` fehlt die Gondel, in `bigwheel` fehlen Tür und Gondel in allen drei Animationsphasen. Das sind Script-gesteuerte Feldobjekte, keine Hintergrundkacheln — sie hängen an Opcodes, die die Demo noch nicht ausführt | Spielbarkeit/Sichtqualität | 🔜 messen, welche Opcodes diese Objekte sichtbar schalten |

### Quellenlage der Fremdrecherche

- **Kujata** (`picklejar76/kujata`): ergiebigste Quelle. `ff7-asset-loader/char-map.js` liefert die Steuercode-Tabelle für F29; `background-layer-renderer.js` liefert die Kachelregeln für F30/F31/F32 — und **bestätigt unseren F22/F23-Ansatz**: dort wird „a layer … split out for every unique combination of: Layer ID, Z index, Param, State, transType". `typeTrans === 3` skaliert die Farbe dort auf 25 %.
- **ff7-landscaper** (`maciej-trebacz/ff7-landscaper`): README ohne Formatangaben; die Weltkarten-Texturzuordnung muss aus dem Quellcode gelesen werden. Für F34 noch auszuwerten.
- **FFNx** (`julianxhokaxhiu/FFNx`): noch nicht ausgewertet.
- **Die drei Tutorial-PDFs** (`ff7modhd.yolasite.com`) sind **nicht abrufbar**: der Server liefert statt der Dateien eine Bot-Schutz-Seite („Just a moment…", HTTP 403 über den normalen Abruf). Eine Umgehung des Schutzes kommt nicht in Frage. Wenn die Dateien lokal abgelegt werden, lese ich sie aus — inhaltlich erwarte ich dort vor allem Material zu F28 (Modellmaßstab) und F33 (Kampfmodelle).

## Runde 3: Abgleich gegen Original-Screenshots (2026-08-10 Abend)

Referenz: 18 Screenshots eines Original-Durchlaufs (Steam, dieselben
Spieldateien) in `apps/demo/.shots/ref/`, pixelvermessen (Katalog per
Subagent). Der Überlagerungsvergleich `md1stin` gegen
`20260810223237_1.jpg` zeigt: **Hintergrund nahezu deckungsgleich** (mittlere
Abweichung 18,9/255, Ausreißer fast nur an den Figuren).

| # | Bereich | Beobachtung | Bewertung | Status |
|---|---|---|---|---|
| F37 | Field/Modelle | **Figurenmaßstab war um Faktor 4 zu klein** — die Kamera-Hypothese aus F28 ist damit WIDERLEGT: Kamerarekonstruktion und Positionen stimmen (Überlagerung: Füße der Wächter deckungsgleich), nur die Größe nicht. Faktorsweep 1–6 gegen die Referenz: **4** trifft Kopf und Füße deckungsgleich (3,5/4,5 sichtbar daneben). Bezugswert der Modellskala also 512/4 = **128**, neue Vorgabe `model-over-128` | Kernfehler — häufigster Befund beider Runden, jetzt behoben | ✅ sichtkalibriert (`SCALE_REFERENCE_KALIBRIERT`, 2 Abnahmetests); 🟡 pixelgenau belegt nur an `md1stin`, Gegenprobe in 4 Fields stimmig |
| F36 | Field/Modelle | **Regression aus der Skalen-Kalibrierung sichtbar gemacht:** „bei Faktor 4 liegen alle wieder am Boden" (Nutzerbefund). Gemessen: NICHT der Faktor — die Figuren standen in der **Bindpose**, weil `setAnimation` asynchron bindet und `advanceTick` bis dahin die Bindpose anwendet. Bei jedem Fieldwechsel lagen die Figuren für die ersten Takte flach | Von Anfang an vorhanden, durch die großen Figuren erst auffällig | ✅ behoben: Figuren bleiben unsichtbar, bis ihre Animation gebunden ist (`whenAnimationSettled`) |
| F38 | Field/Modelle | **Blickrichtung um 90° verdreht** (Nutzerbefund Runde 3: „runter"→rechts, „hoch"→links, „links"→Kamera, „rechts"→hoch). Sweep +90/−90 gegen die Referenz (Cloud frontal in `223303`): **−90°** stellt hoch=Rücken, links=Linksprofil, rechts=Rechtsprofil her | Kernfehler | ✅ behoben (`MODEL_FRONT_OFFSET_DEG = -90`, 🟡 Vorzeichen-Herleitung offen, sichtkalibriert); Abnahmetest angepasst |
| F39 | Dialoge | **F29 abgeschlossen — Zeichentabelle jetzt zweifach belegt:** (a) Rohbytes per `gameDebug.dialogRoh` (del1: `eb e7 b2` = {Barret}+Umbruch+`“`, `b3 e8 b2` = `”`+Seite+`“`, `e7 e1` = Umbruch+Einzug, `a9` = `…`); (b) ff7tk `FF7Text.h` (vollständige Westtabelle). Wichtige Korrekturen: das lineare ASCII-Fenster gilt **nur bis 0x5E** (0x60–0x7F sind Umlaute — `ä`=0x6A, `ß`=0x87; die alte Fenstergrenze 0xBF hätte deutsche Texte zerstört), und **0xF8/0xF9 sind PS-Buttons (□/✕), keine Steuersequenzen** — die alte Skip-Deutung hätte echte Zeichen verschluckt. 0xFE-Mehrbytesequenzen (Farben, {PAUSEnnn}, {MEMORY}) vorerst pauschal 1 Folgebyte 🟡 | Kernfehler — behoben | ✅ `buildFieldTextTable` in formats-kernel; Sichtnachweis: Barret-Dialog in del1 dekodiert zeichengleich zum Original inkl. Namenszeile und Einzügen |
| F40 | Dialoge/UI | Dialogfenster-Optik nach Pixelvermessung der Referenz umgesetzt: Bordüre 2px `#7A7C7D` / 2px `#C6C4C5` / 1px `#313035`, Eckenradius 4px, Füllung Diagonalverlauf `#0001B7`→`#000022`, Text weiß mit 1px-Schatten (+1/+1), **Zeilenhöhe 32px**. Weitere vermessene Konstanten im Referenzkatalog: Kampf-HUD-Fenster `(1,333)–(270,442)` und `(275,333)–(637,442)`, ATB grün `rgb(145,210,170)` → voll sandgelb `rgb(227,181,129)`, Kommandofenster `(145,341)–(261,450)`, Renderfläche Field/Battle **640×448** mit 32px-Balken unten, Menüs 640×480 | Angleichung | ✅ Dialogfenster; 🔜 Kampf-HUD und Ergebnisbildschirme nach denselben Konstanten |
| F12 | Menü | **GELÖST** (ff7tk `Type_FF7CHAR.h`): Der Charakterrecord trägt ZWEI Wertepaare — Basiswerte @46/@50 (ohne Ausrüstung) und echte Maxima @56/@58 (mit Ausrüstungs-/Materiaboni), getrennt durch 4 Füllbytes. Unsere Lesung nahm die Basiswerte als Maxima → „MP 122/116" | Datenlesung | ✅ behoben (savemap.ts + Fixture-Komponist schreibt beide Paare) |
| F18 | Menü | **ERKLÄRT** (ff7tk `FF7Item.h`): Item-IDs sind bereichskodiert — 0–104 Gegenstände, **128–255 Waffen** (Yuffie ab 0xD7=215!), **256–287 Rüstungen**, **288–319 Accessoires**; u16 = ID in Bits 0–8, Menge in Bits 9–15. `?215`/`?257`/`?307` sind Conformer-Bereich, Rüstung, Accessoire — deren Namen liegen in anderen kernel.bin-Sektionen | Kosmetisch → verstanden | 🔜 Namenslisten der übrigen Sektionen anbinden |
| F41 | Field/Modelle | **Cloud fehlt ein Auge** (Nutzerbefund Runde 3). Vermutlich Aufkleber-/Alphaproblem der Gesichtstextur (`alphaTest`/Decal-Versatz oder gespiegelte UV des zweiten Auges) | Sichtqualität | 🔜 messen (Texel des Augen-Aufklebers gegen texToRgba prüfen) |
| F42 | Field/Modelle | **„Sattere" Modelle im Original** (Nutzerbefund Runde 3, Punkt 1). Verdacht: (a) texturierte Flächen ignorieren bei uns die Vertexfarben (`MeshBasicMaterial` ohne `vertexColors` — das Original moduliert Textur × Vertexfarbe), (b) Sektion 3 trägt womöglich Lichtfarben je Modell, die wir nicht anwenden | Sichtqualität | 🔜 Makou-Reactor-Recherche (läuft) klärt (b); (a) ist ein Einzeiler-Experiment mit Sichtvergleich |
| F43 | Interpreter | **Story-Fortschritt** (Nutzerbefund Runde 3, Punkt 2): Die Hauptfortschrittsvariable liegt in der Savemap bei Slot-Offset **0x0BA4** (u16 `mprogress`, ff7tk `FF7Save_Types.h`). Wie weit unsere Interpreter-Bänke sie den Field-Scripts bereitstellen (Entity-Sichtbarkeit, alternative Entries), ist ungemessen | Spielbarkeit | 🔜 messen; Makou-Reactor-Recherche (läuft) liefert die Opcode-Seite |

Offen aus Runde 2 bleiben: **F30** (Transparenzregel — Blockränder,
Nutzerpunkt 3), **F31** (`textureId2` — verwürfelte Kacheln), **F32**
(Layer/Z-Sortierung der Mischstapel), **F27** (Wurzelrotation der
Gehanimation — Nutzerpunkt 5), F24/F25/F26 (Menü/Weltkarte/Kampf als
Ausbaustufen).

## Makou-Reactor-Recherche: belegte Formatfakten (2026-08-10, master@931dd37)

Subagent-Auswertung des Quellcodes von `myst6re/makoureactor` (+ ff7tk als
dessen Text-Backend). Die für unsere offenen Findings entscheidenden Fakten,
jeweils mit Quelldatei:

- **Tile-Record-Verschiebung +4 bestätigt unsere Deutung:** Makous `TilePC`
  (BackgroundTilesIO.h) beginnt 4 Bytes später als unser Record-Nullpunkt —
  alle Felder decken sich dann exakt (paletteID→@24, Z→@26, param→@28,
  state→@29, blending→@30, typeTrans→@32, textureID→@34, depth→@38 in
  UNSERER Zählung). **`textureID2` liegt damit bei uns @36** — F31-Vermutung
  belegt. Auswahlregel (`tilePC2Tile`): bei `blending > 0` UND `layerID > 0`
  gelten `srcX2/srcY2/textureID2`, sonst die ersten Felder. Layer 0 immer die
  ersten.
- **Mischformeln** (`BackgroundFile::blendColor`): typeTrans 0 = (dst+src)/2,
  1 = dst+src (Clamp 255), 2 = dst−src (Clamp 0), 3 = dst + src/4. Unsere
  F23-Umsetzung stimmt für 0/1; **3 braucht Faktor 0,25** (bisher wie 1
  behandelt), **2 fehlt** (bisher wie 0). → F23-Nachbesserung.
- **Sichtbarkeitsregel** (`BackgroundTiles::filter`): Layer 0 immer; sonst
  sichtbar wenn `state == 0` ODER `aktiveStates(param) & state` — state ist
  eine **Bitmaske**, und die Bits schalten die Script-Opcodes **BGON (0xE0,
  setzt Bit 1<<bgStateID) / BGOFF (0xE1, löscht) / BGROL/BGROL2 (weiter/
  zurück) / BGCLR (alles aus)**. Das ist der echte F22-Mechanismus — unser
  Reihum-Takt ist Demo-Ersatz, die Opcodes gehören in den Interpreter.
- **Transparenz** (Palette.cpp/PaletteIOPC): Ein Pixel ist transparent, wenn
  der Palettenwert **roh 0x0000** ist (Schwarz ohne STP-Bit); auf PC
  zusätzlich **Palettenindex 0, wenn das Per-Palette-Flag gesetzt ist**
  (max. 20 Flag-Bytes ab Offset 12 der Background-Sektion). NICHT „alle
  schwarzen Pixel" (Kujas Regel war gröber). 5→8-Bit-Expansion: `(c<<3)|(c>>2)`.
  STP-Bit (Bit 15) wird gespeichert, von Makou aber nicht gerendert. → F30-Fixpfad.
- **Stand/Gehen/Rennen = Animations-Slots 0/1/2** — im Code verankert
  (FieldModelLoaderPS.cpp setzt für Hauptcharaktere genau diese drei auf die
  ersten Slots; Cloud AAAA.HRC → ACFE/AAFF/AAGA „Standing, walking, running").
  Unsere ANIM_STEHEN=0/ANIM_GEHEN=1-Hypothese ist damit belegt; Opcode **CCANM
  (0xDC)** ersetzt gezielt eine der drei (`standWalkRun` 0/1/2). Animations-
  Opcodes: DFANM 0xA2 (Loop), ANIME1 0xA3, ANIMW 0xAC, CANIM1/2 (Teilbereich
  firstFrame/lastFrame), ASPED 0xBD. → Nutzerpunkt 5 beantwortet; bleibt F27.
- **Blickrichtung**: 0–255 = volle Umdrehung, gerendert als −360°·dir/256 um
  die Hochachse (WalkmeshWidget.cpp). Nullpunkt-Semantik definiert Makou
  nicht — unser sichtkalibrierter −90°-Versatz (F38) bleibt die Referenz.
- **$GameMoment = Bank 2, Adresse 0** (vars.cfg) — die 16-Bit-Sicht auf
  denselben Speicher wie Bank 1; Scripts prüfen sie mit gewöhnlichen
  IF-Opcodes, es gibt KEINE Engine-Sonderlogik. Savemap-Feld `mprogress`
  @0x0BA4 (F43). Entity-Sichtbarkeit läuft über VISI (0xA4) in den Scripts.
- **Sektion-3-Licht** (FieldModelLoaderPC.cpp): pro Modell 3 gerichtete
  Lichter à RGB + s16-Richtungsvektor, plus 3 Bytes Globalfarbe (Defaults
  128/204/77 grau + Global 64). Makou rendert sie selbst nicht; die
  Lambert-Anwendung aufs Vertexlicht ist die plausible Erklärung für den
  „satteren" Original-Look (F42-Fixpfad).
- **Kamera bestätigt**: Position im Kameraraum, Welt-Auge = −Rᵀ·T; Achsen
  /4096; `fovy = 2·atan(240/(2·zoom))` — deckt sich mit unserer
  Rekonstruktion (und erklärt, warum die Hintergrund-Überlagerung passt).
- **0xFE-Subcodes** (ff7tk toPC): ≥0xD2; 0xDD trägt 1 Folgebyte (Pausendauer),
  0xE2 {MEMORY} trägt 4. Unsere Pauschale „1 Folgebyte" ist für 0xDD korrekt,
  für {MEMORY} zu kurz 🟡.

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
