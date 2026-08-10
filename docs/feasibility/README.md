# Machbarkeitsanalysen (Feasibility Studies)

Sammlung von Machbarkeitsanalysen zu möglichen Erweiterungen von WebMidgar.
Alle Analysen sind **Entwürfe/Entscheidungsvorlagen** — sie ändern nichts an
der verbindlichen Roadmap ([ROADMAP-S20-S26.md](../ROADMAP-S20-S26.md)),
sondern liefern die Grundlage, um diese Themen künftig einzuplanen.
Aufwands- und Performance-Zahlen sind als begründete Schätzungen markiert;
Quellen sind in den jeweiligen Dokumenten verlinkt.

| # | Thema | Verdikt (Kurzfassung) | Dokument |
|---|---|---|---|
| 01 | FF7-MMORPG auf OpenMidgar-Basis | Bedingt Go — Co-op (2–8 Spieler) ja; volles MMORPG auf FF7-IP No-Go (rechtlich/technisch) | [01-mmorpg-auf-openmidgar-basis.md](01-mmorpg-auf-openmidgar-basis.md) |
| 02 | Skilltrees „RuneScape-like" (Fischen, Holzfällerei …) | Machbar als datengetriebene Mod auf Manifest v2 + 3 Engine-Erweiterungen (Mod-Save-State, Skill-UI, det. Zufall) | [02-skilltrees-runescape-like.md](02-skilltrees-runescape-like.md) |
| 03 | Worldmap-Erweiterung für Skill-Orte | Machbar, strikt nach dem Worldmap-Modul; deklarative POI-Records (`world-poi-add`), ff7-landscaper nur als Referenz | [03-worldmap-erweiterung-skill-orte.md](03-worldmap-erweiterung-skill-orte.md) |
| 04 | Worldmap-Skalierung: ab wann laggt es? | ×2–×10 mehr Orte unkritisch bei Disziplin (Merge/Atlas/Instancing/Streaming); naive POI-Darstellung kippt ab ~300–1.000 POIs | [04-worldmap-skalierung-performance.md](04-worldmap-skalierung-performance.md) |
| 05 | AI-Skill, der selbstständig Mods implementiert | Bedingt machbar, „Ja, gestuft" — deklaratives Format + totaler Compiler als Validierungs-Orakel; Aufwand steckt in Repo-Vorbedingungen | [05-ai-skill-automatische-mods.md](05-ai-skill-automatische-mods.md) |
| 06 | Steam Controller / Steam Input | Machbar, gestuft: W3C Gamepad API jetzt (passt zum Tick-Eingabe-Replay); echtes SAPI nur über nativen Wrapper; Steam Deck kostenlos via Overlay-Configurator | [06-steam-controller-integration.md](06-steam-controller-integration.md) |
| 07 | 7th-Heaven-Mod-Integration (IRO) | Teilweise machbar — nur als Einbahn-Konverter IRO → .wmmod; je Mod-Klasse unterschiedlich (Texturen ja, Hext/DLL nie) | [07-7th-heaven-mod-integration.md](07-7th-heaven-mod-integration.md) |

Verwandt: [STEAM-LIZENZNACHWEIS.md](../STEAM-LIZENZNACHWEIS.md) — Konzept zum
Nachweis einer legalen FF7-Kopie (gestuft: lokale FSA-Prüfung, optionaler
Steam-OpenID-Relay), relevant u. a. für Analysen 01 und 07.