# ff7-fenrir (+ Braver) — Recherchenotizen für WebMidgar

Erhebungsdatum: 2026-08-15
Quellen: https://github.com/dangarfield/ff7-fenrir · https://github.com/ficed/Braver
Zugehörig, bereits im Register: [kujata.md](kujata.md)

---

## 0. LIZENZLAGE (zuerst lesen) — am 2026-08-15 selbst geprüft

Über die GitHub-API abgefragt, nicht aus einer Beschreibung übernommen:

| Repo | `LICENSE`-Datei | GitHub-Erkennung | `package.json` | Stand |
|---|---|---|---|---|
| `dangarfield/ff7-fenrir` | **keine** | `null` | **`"ISC"`** | `pushed_at` 2025-07-31, 5,3 MB, 30 ★ |
| `dangarfield/kujata` | **keine** | `null` | **`"ISC"`** | 2025-08-14, 6,4 MB, 10 ★ |
| `picklejar76/kujata` | **keine** | `null` | `"ISC"` | 2023-01-29, 5,6 MB, 25 ★ |
| `ficed/Braver` | `LICENSE.txt` | **`EPL-2.0`** | n/a (.NET) | 2023-12-04, 2,2 MB, 38 ★ |

**Der Widerspruch bei fenrir und kujata ist die eigentliche Nachricht.** Ohne
`LICENSE`-Datei gilt nach GitHubs eigener Dokumentation „alle Rechte
vorbehalten"; die `package.json` erklärt gleichzeitig ISC, eine echte,
maschinenlesbare SPDX-Angabe. Zwei Angaben, die sich widersprechen, sind
schlechter als eine fehlende — sie machen jede Übernahme zur Auslegungsfrage.

**Folge für uns:** Für diese beiden gilt weiterhin, was
[ADR-027](../ADR-027-DECOMP-REFERENZ.md) für unlizenzierte Fremdquellen
festhält: **Fakten ja, Quelltext nein.** Die Freigabe aus
[ADR-028](../ADR-028-EIGENE-CODEANALYSE.md) betrifft ausschließlich den
**eigenen** EXE-Bestand und erstreckt sich ausdrücklich **nicht** auf
Fremdrepositorien.

**Braver ist die sauberste der drei** (EPL-2.0, schwaches Copyleft mit
Patentklausel) — **außer** `IrosArchive/`, das MS-PL steht. Wer `IrosArc.cs`
oder `Lzs.cs` übernimmt, steht unter MS-PL, nicht EPL. Für uns ohnehin
gegenstandslos: Unser LZS ist realdaten-belegt.

**Ein Hinweis, der nicht übergangen werden darf:** kujata liefert fremde
Binärwerkzeuge mit (`unlgp.exe`, `lgp.exe`, `lzs.exe`, `TexTool.exe`,
`sfxdump.exe`), deren Lizenzen im Repo nicht genannt sind. Nie in unseren Baum.

---

## 1. Herkunft dieser Notiz — und ihre Grenze

**Diese Sichtung ist zweiter Hand.** Die Fähigkeitsmatrix unten stammt aus
`decomp/spec/spec-prior-art-diff.md` (s.
[ff7-exe-eigenanalyse.md](ff7-exe-eigenanalyse.md)), die die drei Repos **aus
den Quellbäumen** gemessen hat statt aus den READMEs — und die READMEs dabei in
fünf Punkten korrigiert. Selbst nachgeprüft habe ich nur die Lizenzlage (§0);
die Zahlen sind übernommen und tragen deshalb 🟡.

Der Vergleichsstand ist eine Momentaufnahme bewegter Repositorien
(fenrir 2025-07-31, kujata 2025-08-14, Braver 2023-12-04). Wer daraus etwas
ableitet, sollte den Stand nachziehen.

---

## 2. Fähigkeitsmatrix — 🟡, weil zweiter Hand gemessen

Legende: **Voll** implementiert und benutzt · **Teil** echter Code mit bekannten
Lücken · **Stub** Datei da, Rumpf leer · **Kein** fehlt.

| Teilsystem | fenrir | kujata | Braver | WebMidgar |
|---|---|---|---|---|
| LGP, LZS, flevel, Kernel | über kujata | **Voll** | **Voll** | **Voll** (realdaten-belegt) |
| **Field-Script-VM** | **Teil — 240/245 Opcodes (98 %)** | nur Dekoder | **Voll-ish** (103 KB) | **Voll** — 99,92 % Spannen-Abschluss, 0 unknown-Ops |
| Field-Hintergründe / Layer | **Voll** (36 KB) | Voll | Voll | Voll |
| Field-Walkmesh + Bewegung | **Voll** (74 KB) | n/a | Voll | Voll |
| Menüs | **Voll** (alle Hauptmenüs, Shop, PHS, Materia) | nur Assets | Teil | Teil (F24 offen) |
| Dialog + Text | Voll | Voll | Voll | Voll (Fontblatt aus `WINDOW.BIN`) |
| Savemap | Teil | n/a | Teil | **Voll** (inkl. Prüfsumme, 8/8 Slots) |
| Kampf: `scene.bin` | Voll | Voll | Voll | **Voll**, byteexakt |
| Kampf: Gegner-KI-VM | Teil | n/a | Teil (viele TODOs) | **Voll** — 612/612 Skripte enden regulär |
| Kampf: **Schadensformeln** | **Stub — fest verdrahtete 1234/2468** | n/a | Teil, eine Formel falsch | 🔵 Eigenentwurf |
| Kampf: Aktions-/Motion-Sequenzen | **Teil — 18/40 Ops** | nur Dekoder | Teil, Operandentabelle mit 3 Fehlern | 🔴 offen (K9) |
| Kampf: Kameraskripte | **Teil — 58/60 Ops** | **Voll** Dekoder | **Voll** Dekoder | 🔴 offen (K11) |
| Kampf: **Magie-/Beschwörungs-VFX** | **Kein** | nur Assetkarten | Teil | 🔴 offen |
| **Weltkarte** | **Stub — ein grüner Würfel** | **Voll** Extraktor | **Voll** (30 KB, mit Streaming, Begegnungen, Fahrzeugen) | **Voll** (S28/S29) |
| **Minispiele** | **Stub** (`loadTempMiniGame2d/3d`) | Kein | Kein | 🔴 offen (S34/S35) |
| Klang, Musik | Teil — spielt vorgerenderte `.ogg` | Voll Extraktor | Voll | Teil (O2, MS-ADPCM offen) |
| Filme | Voll | Voll | Voll | 🔴 offen (S36) |

**Die Lage ist kein Teilüberlapp, sondern nahezu komplementär.** fenrir ist
dort stark, wo wir noch nicht sind (Menüs, Field-Rendering, Bewegung), und
genau dort leer, wo wir belegt sind (Weltkarte, Savemap, KI-VM) — oder wo beide
leer sind (Schadensformeln, Minispiele, VFX).

**Drei unabhängige Reimplementierungen stecken an derselben Stelle fest: keine
kann eine echte Schadenszahl rechnen.** Das ist die schärfste Aussage dieser
Sichtung und sie bestätigt die Lagebeurteilung von
`PROJEKTSTAND.html`: Der Engpass ist nicht der Szenengraph, sondern die
Schadenstabelle.

### Korrekturen, die die Matrix an gängigen Beschreibungen anbringt

- „fenrir Klang: nicht begonnen" ist **falsch** — Wiedergabe steht (howler.js,
  `.ogg` nach Klang-ID). Was fehlt, ist der *Klangmotor*: Sequenzer,
  Parametermodell, Streaming.
- „fenrir Field ~93 % der Opcodes" ist **veraltet** — das repo-eigene
  `OPS_CODES_FIELD_README.md` sagt 240/245 = 98 %.
- „Braver frühe Beta" **untertreibt die Weltkarte** — `WMScreen.cs` ist die
  fortgeschrittenste Weltkarte der drei.
- fenrirs Minispielmodul ist ein **Platzhalter**, keine Teilumsetzung.

---

## 3. Zwei Behauptungen daraus, an unseren Daten entschieden (K10)

Der Wert einer Fremdquelle liegt nicht in ihrer Zustimmung, sondern in der
Hypothese, die sie liefert. Zwei aus Braver's `Scene.cs` betrafen unseren
`EnemyRecord` unmittelbar. Beide sind hier **gemessen** worden, nicht
übernommen — Probe `tools/realdata-scan/src/gegnerrecord-k10.rdtest.ts`.

### 3.1 `+0xB0` heißt „erlaubt", nicht „immun" — wir hatten das Vorzeichen falsch

Unser Feld hieß `statusImmunity`. Braver liest dasselbe Feld als
`AllowedStatuses`. Das ist kein Namensstreit: Wer die Maske als Immunität
liest, dreht jede Zustandsprüfung um.

Gemessen über **625** belegte Gegnerrecords der `lang-en`-`scene.bin`:

| | |
|---|---:|
| verschiedene Werte | 100 |
| gesetzte Bits im Mittel | **26,2 von 32** |
| Records mit `0xFFFFFFFF` | **209 (33,4 %)** |

Als Immunitätsmaske gelesen wäre der Durchschnittsgegner gegen 26 von 32
Zuständen immun und ein Drittel aller Gegner gegen **alle**. Ein Spiel, in dem
Gift, Schlaf und Stopp bei einem Drittel der Gegner grundsätzlich nicht wirken,
gibt es nicht — und `scene.bin` trägt für genau diese Zustände Angriffsdaten.
Die Gegenprobe „das Feld ist ohnehin konstant" fällt aus: 100 verschiedene
Werte.

✅ **Feld umbenannt** in `statusesAllowed`; die Laufzeit-Immunität ist
`~statusesAllowed`. Der Name folgt jetzt dem, was auf der Platte steht.

### 3.2 `+0xA2` ist der Rückenangriffs-Faktor in Achteln — bei uns ungedeutet

Braver: `BackDamageMultiplier = ReadByte() / 8f`. Gemessen:

| Wert | Faktor | Records |
|---:|---|---:|
| **16** | **×2,0** | **602 (96,3 %)** |
| 255 | (Sentinel) | 20 |
| 32 / 40 / 64 | ×4 / ×5 / ×8 | je 1 |

**Die Gütefunktion ist bewusst nicht „wenige verschiedene Werte"** — das
erfüllt in diesem Record fast jedes dünn belegte Byte, und der Nachbar `+0xA3`
hat sogar nur einen einzigen. Die Achtel-Deutung sagt etwas Schärferes vorher:
Alle Nicht-Sentinel-Werte müssen **Vielfache von 8** sein.

**Kontrolle über alle 184 Byteversätze des Records: 2 erfüllen sie** — `+0xA2`
und `+0x8B`. Faktor 92 gegen die volle Kandidatenmenge, weit über der
Projektschwelle 3. `+0x8B` liegt im Dropraten-Block und hat dort einen eigenen
Grund.

✅ **Feld ergänzt** als `backAttackScale`.

---

## 4. Was noch zu holen wäre

Aus der Übersicht, nach Ertrag für unsere offenen Posten:

| Posten bei uns | Was dort liegt |
|---|---|
| **K9** `da`/`ab`-Animationen | fenrir hat 18 von 40 Ops, Braver eine Operandentabelle mit **drei belegten Fehlern** (`0xDB`, `0xCE`, `0xFE`) — als Gegenhypothese brauchbar, als Vorlage nicht |
| **K11** `camdat` | fenrir 58/60 Kamera-Ops; kujata und Braver haben je einen **vollständigen Dekoder**. Für uns die dichteste Fremdabdeckung eines offenen Postens |
| Menü-Aufteilung (F24) | fenrir hat alle Hauptmenüs — der Aufbau ist beobachtbar, ohne Code zu nehmen |
| Field-Rendering, Bewegung | fenrir/Braver sind hier weiter als wir; als Sichtvergleich nützlich |
| Zeichenkodierung | kujatas `char-map.js` hat belegte Fehler (Einzelbyte `0xD2..0xDD` gelten **nur nach `0xFE`**); deckt sich mit unserer offenen Aufgabe 2 |

**Nicht zu holen:** Schadensformeln, Minispielphysik, VFX. Dort ist keine der
drei Quellen weiter als wir — bei den Minispielen hat **niemand** etwas.

---

## 5. Offene Fragen dieser Sichtung

1. **Die Fähigkeitsmatrix ist nicht selbst nachgemessen.** Wenn ein Posten
   daraus einen Arbeitsbogen auslöst, gehört der betroffene Baum vorher
   angesehen — Repositorien bewegen sich, und die Beschreibungen lagen
   nachweislich fünfmal daneben.
2. **Die Lizenzambiguität bei fenrir/kujata ist auflösbar.** Der billigste Weg
   wäre, den Autor um eine `LICENSE`-Datei passend zur `package.json` zu
   bitten. Solange das offen ist, bleibt es bei Fakten statt Code.
3. **Braver verdient einen eigenen Registereintrag**, wenn seine Weltkarte je
   als Gegenprobe zu S28/S29 herangezogen wird — EPL-2.0 ist die einzige klare
   Lizenz im Feld, und die Weltkarte ist dort die stärkste der drei.
