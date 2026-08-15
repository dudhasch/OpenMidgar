# FF7SND — Quellenauswertung (audio.dat / audio.fmt)

**Ziel:** https://github.com/julianxhokaxhiu/FF7SND
**Lokale Kopie:** `…\scratchpad\repos\FF7SND` (vollständige Historie nachgeladen, HEAD `6add0fc` „Core: Upgrade to .NET 9.0")

## ⚠️ Lizenz — zuerst lesen

| Punkt | Wert |
|---|---|
| Lizenz | **GNU GPL v3** (`LICENSE`, 674 Zeilen, unverändertes FSF-Original) |
| Copyright-Vermerke | „FF7SND is a Final Fantasy VII Audio Extraction app — Copyright (C) 2003 Qhimm.com, Copyright (C) 2020 Julian Xhokaxhiu" (Dateikopf der alten C++-Quellen); `.csproj`: „Julian Xhokaxhiu 2021" |
| Konsequenz für WebMidgar | **Kein Quelltext übernehmen, auch nicht umgeschrieben Zeile für Zeile.** GPL-3.0 ist copyleft und mit einem MIT/Apache-Monorepo unvereinbar. Zulässig ist ausschließlich, **Tatsachen über das Dateiformat** zu entnehmen (Offsets, Feldbedeutungen, Satzgrößen) — die sind nicht schutzfähig. |
| Risikoposten, **nicht** wörtlich übernehmen | die C#-Strukturdefinitionen (`FmtFileHeader`, `AudioFile`, …), die RIFF-Zusammenbau-Routinen (`getWaveStream`, `OnExtract`), die Schleifenformel-Zeilen. Diese Datei beschreibt sie nur, sie zitiert sie nicht. |
| Zusätzlicher Hinweis | Der Ursprungscode stammt aus Qhimm-Kreisen (2003, MFC/VC6). Der Zeitstempel im MFC-Header (`…11D4…`, Jahr 2000) deutet auf einen noch älteren Kern. |

## Was das Projekt überhaupt ist

Ein Windows-GUI-Werkzeug (heute .NET 9 / WinForms, davor MFC/C++), das
`Data\Sound\audio.fmt` einliest, die Klipp-Liste anzeigt, einen Klipp abspielt
und beliebig viele als `.wav` exportiert. Neu in der C#-Fassung: Mehrfachauswahl,
`CTRL+A`, Ordnerauswahl beim Export, Schleifen-Tags, sowie ein
„Save As…", das `audio.dat`/`audio.fmt` wieder herausschreibt.

Dateien: `src/Core/DataStructures.cs` (Layout), `src/Entry.cs` (gesamte Logik,
254 Z.), `src/Extensions/StreamExtensions.cs` (Struct-Serialisierung),
`src/Core/WinMM.cs` (`PlaySound`). Historisch:
`src/FF7SNDDlg.cpp` / `src/FF7SNDDlg.h` bis Commit `cac4988` („Goodbye C++ version").

**Wichtigster Rahmenbefund: FF7SND dekodiert nichts.** Es baut um die
unveränderten `audio.dat`-Bytes einen RIFF-WAVE-Kopf aus den `audio.fmt`-Angaben
und überlässt das Dekodieren dem Betriebssystem (`sndPlaySound`/`PlaySound` bzw.
dem ACM-Codec `msadp32`). Es gibt daher in dieser Quelle **weder eine
Koeffiziententabelle noch Nibble-Reihenfolge, Prädiktor- oder Step-Semantik**.
Das ist zugleich eine harte Aussage: die Nutzdaten in `audio.dat` sind
**byteidentisches Standard-MS-ADPCM** (`wFormatTag == 2`), ohne Verschlüsselung,
Verschachtelung oder Square-Eigenheit — sonst könnte der Windows-Codec sie nicht
abspielen.

## Fundort der Dateien

Registry (32-Bit-Sicht, `KEY_WOW64_32KEY` / `RegistryView.Registry32`):
`HKLM\Software\Square Soft, Inc.\Final Fantasy VII`, Wert `AppPath`.
Daraus `<AppPath>\Data\Sound\`, darin `audio.dat` + gleichnamiges `.fmt`.
Die `.fmt`-Datei wird ausschließlich über den Namenswechsel der Endung
gefunden — es gibt keinen Verweis in der `.dat`.

## Satzlayout `audio.fmt` (aus dem Code abgeleitet)

### Kopf, 24 B — sechs `uint32`, little endian

| Off | Größe | Name C# (`FmtFileHeader`) | Name C++ (2003) | Bedeutung laut Verwendung |
|---:|---:|---|---|---|
| +0 | u32 | `Length` | `length` | Länge der Nutzdaten in `audio.dat`; **`0` = Sondersatz** (s.u.) |
| +4 | u32 | `Offset` | `offset` | absolute Byteposition in `audio.dat` (C++ macht `Seek(hdr->offset)`) |
| +8 | u32 | `Loop` | *unbenannt* | Schleifenschalter; C# schreibt nur bei `> 0` Schleifen-Tags |
| +12 | u32 | `Count` | *unbenannt* | **wird nirgends gelesen** — reiner Namensvorschlag |
| +16 | u32 | `Start` | *unbenannt* | Schleifenanfang |
| +20 | u32 | `End` | *unbenannt* | Schleifenende |

**Provenienz-Befund (wichtig).** Der C++-Ursprung deklarierte die Bytes +8…+23
als `char zz1[16]`, also ausdrücklich *unbekannt*. Die Namen
`Loop` / `Count` / `Start` / `End` sind **erst in der C#-Neufassung (2020 ff.)
von Julian Xhokaxhiu vergeben** worden, und `Count` wird von keiner Zeile des
Programms benutzt. Für WebMidgar heißt das: die Bezeichnung „Count" in
`FINDINGS.md` trägt **keinerlei Beweislast** — sie ist eine Vermutung dritter
Hand. Das deckt sich mit dem WebMidgar-Messwert (Feld +12 in 724/724 Sätzen `0`).

### Formatteil ab +24

| Off | Größe | Feld | Anmerkung |
|---:|---:|---|---|
| +24 | u16 | `wFormatTag` | 2 = `WAVE_FORMAT_ADPCM` |
| +26 | u16 | `nChannels` | |
| +28 | u32 | `nSamplesPerSec` | in der GUI als „Sample Format" angezeigt |
| +32 | u32 | `nAvgBytesPerSec` | |
| +36 | u16 | `nBlockAlign` | |
| +38 | u16 | `wBitsPerSample` | |
| +40 | u16 | `cbSize` | Größe des Zusatzteils; 32 bei 7 Koeffizientenpaaren |
| +42 | u16 | `wSamplesPerBlock` | Teil des Zusatzes |
| +44 | u16 | `wNumCoef` | Anzahl Prädiktorpaare |
| +46 | 4·n | `ADPCMCOEFSET[wNumCoef]` | je zwei 16-Bit-Werte (`Coef1`,`Coef2`) |

Damit: Satz = **24 + 18 + cbSize**, bei `cbSize = 32` also **74 B**;
Sondersatz = **24 + 18 = 42 B**.

### Der entscheidende Schrittweiten-Befund — zwei Fassungen, zwei Regeln

| Fassung | Regel zum Weiterschreiten | Bewertung |
|---|---|---|
| C++ (2003…2020) | Bei `length == 0`: **+42**, sonst **`46 + wNumCoef·4`**. Schleife läuft bis Dateilänge; Sätze mit `length == 0` werden **übersprungen und nicht gezählt** | inhaltlich dieselbe Regel wie WebMidgar, nur über `wNumCoef` statt über `cbSize` geführt |
| C# (heute) | feste Schleife über **750** Sätze; bei `Length == 0` **18 B überspringen** (`SeekStruct<WAVEFORMATEX>`) und den Listenplatz **leer stehen lassen**, sonst 50 B `ADPCMWAVEFORMAT` lesen | starre Satzgröße 74/42, hartkodierte Satzzahl |

Beide Fassungen bestätigen also **unabhängig von WebMidgar**: `audio.fmt` ist
**kein Feld gleich großer Sätze**, und die Unterscheidung läuft über
`Length == 0`. Die C++-Fassung ist dabei die allgemeinere (variabel über
`wNumCoef`); WebMidgars `cbSize`-Regel ist gleichwertig und in einem Punkt
robuster (s. Randfälle).

### Die Zahl 750

Die C#-Fassung legt `audioList = new AudioFile[750]` an und iteriert genau
750-mal über `audio.fmt`. **724 Klangsätze + 26 Abschlussmarken = 750** — die
Zahl passt byteexakt zu WebMidgars Messung und ist offensichtlich empirisch aus
der Realdatei gewonnen (eine kleinere Zahl ließe Sätze liegen, eine größere
liefe über das Dateiende und würfe eine Ausnahme). Der C++-Ursprung
reservierte `800` Indexplätze als lose Obergrenze.

## Klipp-Nummerierung — die beiden Fassungen widersprechen sich

| Fassung | angezeigte / exportierte Nummer |
|---|---|
| C++ | fortlaufender Zähler **nur über echte Sätze**, Abschlussmarken übersprungen; Anzeige und Dateiname `i+1` ⇒ **1…724** (Commit `59a1a0e` „Fix clip ID" hat die 0-Basis auf 1-Basis gezogen) |
| C# | Listenindex über **alle 750 Plätze**, Abschlussmarken bleiben als leere Zeilen stehen; Dateiname `index+1` ⇒ **1…750 mit Lücken** |

**Folge für Quellenvergleiche:** Community-Tabellen „FF7 sound id → Klang", die
aus FF7SND-Exporten stammen, sind je nach Werkzeugfassung gegeneinander
verschoben. Nur die alte C++-Nummerierung entspricht dem flachen Index über
724 Sätze. WebMidgars gemessenes Ergebnis (`SOUND`-Operand < 724, **0** Werte im
Band 724…749) deckt sich mit der **C++**-Zählung und widerlegt die C#-Zählung
als Modell des Spiels.

Eine **Zuordnung Sound-ID → Eintrag gibt es in FF7SND nicht** — weder eine
Namensliste noch eine Bank- oder Kategorielogik. Die Bänke werden vom Werkzeug
gar nicht als Struktur wahrgenommen (die C#-Fassung „stolpert" nur über die
Marken, die C++-Fassung überspringt sie kommentarlos).

## WAV-Erzeugung (Beschreibung, kein Zitat)

Erzeugt wird: `RIFF`-Kopf → `WAVE` → `fmt `-Chunk mit **18 + cbSize** Bytes
(also inklusive `wSamplesPerBlock`, `wNumCoef` und der Koeffizientenpaare) →
`data`-Chunk mit den unveränderten `Length` Bytes ab `Offset` aus `audio.dat`.
Die C#-Fassung hängt bei `Loop > 0` über die Bibliothek *z440.atl.core* zusätzlich
einen `smpl`-Chunk (`NumSampleLoops = 1`, ein `SampleLoop` mit Start/Ende) und
ID3v2.3-Felder `LOOPSTART`/`LOOPEND` an. Ein eigener Chunk-Typ `fflp`
(Id + Größe + Start + Ende, 16 B) ist im C#-Modell zwar deklariert, wird beim
Schreiben aber **nicht** in den Strom gelegt — nur in die Größenrechnung
eingerechnet (s. Randfälle).

### Schleifenmarken — die Formel hat dreimal gewechselt

| Stand | Rechnung für Start/Ende | Commit |
|---|---|---|
| C++ (bis 2020) | **gar nicht** — Felder +8…+23 galten als unbekannt | — |
| C# initial | Rohwert unverändert als Sample-Position | `38b8ab1` |
| 2024-03-10 | Rohwert **geteilt durch `44100 / nSamplesPerSec`** — Begründung im Commit: das Spiel lege die Samples grundsätzlich bei 44100 Hz ab, halbe Abtastrate ⇒ halbe Samplezahl | `5752e20` |
| 2024-03-16 (aktuell) | Rohwert **mal `nChannels / 2`** — Begründung: manche Titel hätten trotz 44100 Hz „doppelt so viele Samples wie nötig", deshalb Kanalzahl als Kriterium | `f9b0fb7` |

**Vergleich mit WebMidgar** (`loopFrames()`: Rohwert `/ (2 · Kanalzahl)`):

* **Mono** (716 von 724 Sätzen): FF7SND rechnet `Start · 0,5`, WebMidgar
  `Start / 2` — **identisch**. Zwei unabhängige Quellen, gleiche Aussage.
* **Stereo** (8 Sätze): FF7SND rechnet `Start · 1`, WebMidgar `Start / 4` —
  **Faktor 4 Widerspruch**. WebMidgars Fassung ist die besser belegte (Kontrolle:
  90/90 Marken innerhalb der Frameanzahl, Gegenprobe 0/90); FF7SNDs Fassung
  entstand aus Gehörprüfung an Einzeltiteln.
* Die zweite Fassung (`/ (44100 / rate)`) ist mit WebMidgars Messung
  „Abtastrate ausnahmslos 44100" unvereinbar bzw. wirkungslos (Divisor 1) —
  sie erklärt sich nur, wenn der Autor sie an modifizierten Beständen
  (Steam/Mod-Installationen mit umkodierten Klängen) getestet hat.

Beide Autorenfassungen bestätigen aber gemeinsam die **Größenordnung**: die
Rohwerte sind **nicht** direkt Frames, sondern brauchen einen Faktor ≤ 1 —
genau WebMidgars Befund „Byteversatz im dekodierten PCM16-Strom".

## Randfälle und Fallen (aus dem Code lesbar)

1. **`cbSize == 0` bei `Length > 0`.** Der C++-Schreibpfad behandelt diesen Fall
   ausdrücklich (dann nur 18 B `fmt `, kein Zusatz) — der C++-**Lesepfad** nicht:
   er schreitet trotzdem um `46 + wNumCoef·4` weiter und liest dabei
   Nachbarbytes als `wNumCoef`. Die C#-Fassung liest bedingungslos 50 B.
   **WebMidgars `18 + cbSize`-Regel ist hier die einzig korrekte.** Im Realbestand
   tritt der Fall laut WebMidgar nicht auf (`cbSize == 32` in 724/724), das Risiko
   betrifft also nur Mod-/Fremdbestände.
2. **RIFF-Größenfeld: beide Fassungen rechnen falsch.**
   Die korrekte Größe ist `Dateigröße − 8 = 70 + Length` (12 RIFF + 8+50 fmt +
   8 data + Nutzdaten). C++ schreibt `Length + 36 + 4 + wNumCoef·4` = `Length + 68`
   (zwei Byte zu wenig — die `36` stammt aus dem 16-B-PCM-`fmt`, nicht aus 18 B).
   C# rechnet `sizeof(FormatChunk) + sizeof(DataChunk) + Length − sizeof(RiffChunk)`
   = `Length + 54` und addiert **nur bei `Loop > 0`** die 16 B des nie
   geschriebenen `fflp`-Chunks — trifft also zufällig nur bei Schleifen den
   richtigen Wert und ist ohne Schleife 16 B zu klein.
   **Konsequenz: die Größenarithmetik dieser Quelle nicht übernehmen.** Windows
   toleriert die Abweichung; ein strikter WAV-Parser nicht.
3. **Der C#-Lesepfad ignoriert `Offset` vollständig** und liest `audio.dat`
   rein sequenziell. Das funktioniert nur, weil die Bereiche lückenlos und in
   Dateireihenfolge liegen (WebMidgar: 100,0000 % Deckung, 0 Lücken,
   0 Überlappungen) — es ist also eher eine unabsichtliche Bestätigung dieser
   Eigenschaft als ein Layoutbeleg. Der C++-Pfad springt korrekt auf `Offset`.
4. **Der Rückschreibpfad („Save As…") schreibt für Abschlussmarken einen
   vollen 74-B-Satz** (24 B genullter Kopf + 50 B genullter Formatteil) statt
   der 42 B. Eine so erzeugte `audio.fmt` hat eine andere Größe als das
   Original und würde von der C++-Fassung falsch gelesen. Zusätzlich gehen die
   `0xCD`-Füllbytes verloren. **Kein taugliches Vorbild für einen Composer** —
   WebMidgars `audio-composer.ts` macht es richtig.
5. **`wNumCoef` wird in der C++-Struktur mit 8 Plätzen reserviert**, gelesen
   werden `wNumCoef` (real 7). Reine Reserve, kein Formatfakt.

## Top-Befunde für WebMidgar (gereiht)

1. **Zwei unabhängige Bestätigungen der Satzregel.** Die C++-Fassung schreitet
   über `46 + wNumCoef·4` bzw. `42` bei `length == 0` — inhaltlich WebMidgars
   Bank-/Abschlussmarkenmodell, nur anders parametriert. Damit ist die S38-Regel
   nicht mehr nur eigenmessig belegt, sondern deckt sich mit einer seit 2003
   im Umlauf befindlichen Auslegung. **Übereinstimmung.**
2. **`Offset` (+4) ist eine absolute Byteposition in `audio.dat`** — belegt
   durch den C++-`Seek(hdr->offset)`. WebMidgar liest das Feld genauso.
   **Übereinstimmung.**
3. **Die Bezeichnung „Count" für +12 hat keinen Beleg.** Der Ursprungscode
   nannte +8…+23 pauschal `zz1[16]`; die Namen stammen aus einer Neufassung
   von 2020 und `Count` wird von keiner Zeile benutzt. WebMidgar sollte den
   Verweis „(in FF7SND „Count")" in `FINDINGS.md` um diesen Provenienzhinweis
   ergänzen — sonst wirkt er wie eine Fremdquelle, die er nicht ist. **Neu.**
4. **Kein Dekoder nötig, um Ton zu bekommen.** Die Nutzdaten sind unverändertes
   MS-ADPCM; ein RIFF-Kopf mit `fmt `-Chunk der Länge `18 + cbSize` (Koeffizienten
   mitgeschrieben!) und einem `data`-Chunk über die rohen `Length` Bytes genügt.
   Für WebMidgar heißt das: der geplante Dekoder ist eine
   **Standard-MS-ADPCM-Implementierung** — die Koeffizienten kommen aus der
   Datei (7 Paare), nicht aus einer Konstante des Spiels. Ob
   `AudioContext.decodeAudioData` einen so zusammengebauten RIFF frisst, ist
   browserabhängig und **zu messen**, kein Ersatz für den eigenen Dekoder.
   **Ergänzung, kein Widerspruch.**
5. **Schleifenmarken: Übereinstimmung für Mono, Widerspruch für Stereo.**
   Mono `/2` gleich in beiden Quellen; für Stereo rechnet FF7SND `·1`, WebMidgar
   `/4`. WebMidgars Beleglage (90/90 mit Kontrolle 0/90) ist stärker; die 8
   Stereosätze sind aber eigens nachzuprüfen. **Widerspruch, eingegrenzt.**
6. **Die Zahl 750** in der C#-Fassung ist die unabhängige Bestätigung von
   `724 + 26`. **Übereinstimmung.**
7. **Klipp-Nummerierung.** Die alte C++-Zählung (1…724, Marken übersprungen)
   entspricht WebMidgars gemessenem flachem `SOUND`-Index; die neue C#-Zählung
   (1…750 mit Lücken) tut es nicht. Wer Exportdateien Dritter als Referenz
   heranzieht, muss die Werkzeugfassung kennen. **Übereinstimmung + Warnung.**
8. **Negativbefund: FF7SND kennt keine Sound-ID-Zuordnung, keine Bank-Semantik,
   keine Namensliste.** Der offene Posten „was die Bänke fachlich bedeuten"
   lässt sich aus dieser Quelle **nicht** schließen. **Quelle scheidet aus.**
9. **Nicht übernehmen: RIFF-Größenarithmetik und der Rückschreibpfad.** Beide
   sind nachweislich fehlerhaft (Punkte 2 und 4 der Randfälle).
10. **Registry-Fundort** `HKLM\Software\Square Soft, Inc.\Final Fantasy VII\AppPath`
    (32-Bit-Sicht) → `Data\Sound\` — für Werkzeuge auf dem Entwicklerrechner
    nützlich, für die Browserlaufzeit belanglos.

## Offene Fragen

1. **Stereo-Schleifenmarken.** Tragen von den 8 Stereosätzen überhaupt welche
   `Loop > 0`? Nur dann ist der Widerspruch zu FF7SND messbar. (Probe:
   Schnittmenge `channels == 2` ∧ `loop > 0` in `audio-bank-probe`.)
2. **Feld +12.** Weder FF7SND noch WebMidgar haben einen Beleg; im Bestand
   ausnahmslos 0. Bleibt 🔴 — FF7SND liefert dazu **nichts**.
3. **`nAvgBytesPerSec`-Falle.** WebMidgars Befund (620/724 tragen
   `21 · nBlockAlign`) erklärt zugleich, warum FF7SNDs erste Schleifenformel
   über die Abtastrate scheitern musste; ein Quervergleich mit dem Erzeuger-
   werkzeug wäre reizvoll, ist aus dieser Quelle aber nicht zu führen.
4. **`decodeAudioData` mit MS-ADPCM.** Chrome/Firefox stützen sich auf
   ffmpeg-nahe Dekoder, die `WAVE_FORMAT_ADPCM` grundsätzlich kennen — ob das
   im Browserkontext freigeschaltet ist, muss gemessen werden, bevor man einen
   Schnellpfad darauf baut.
5. **Herkunft der Bänke.** Das Muster „16 von 26 Bänken leer" (WebMidgar) und
   das MSVC-Füllmuster `0xCD` in den Marken deuten auf eine Erzeuger-Werkzeug-
   kette, die je Eingabesatz eine Marke schreibt. FF7SND enthält dazu keine
   Information; eine zweite Quelle wäre nötig.

## Nachweise (Datei : Fundstelle, ohne Quelltextzitat)

* Lizenz: `LICENSE` (GPL-3.0), Dateikopf `src/FF7SNDDlg.cpp` @ `cac4988~1`
* Kopf- und Formatlayout: `src/Core/DataStructures.cs` (`FmtFileHeader`,
  `WAVEFORMATEX`, `ADPCMWAVEFORMAT`, `ADPCMCOEFSET`)
* `zz1[16]`: `src/FF7SNDDlg.h` @ `cac4988~1`, `struct FF7SNDHEADER`
* Schrittweite C++ / Marken-Überspringen: `src/FF7SNDDlg.cpp` @ `cac4988~1`,
  `CFF7SNDDlg::OnLoad`
* `Seek(hdr->offset)`: ebd., `OnPlay` / `OnExtract`
* 750 Sätze, 18-B-Sprung bei `Length == 0`: `src/Entry.cs`, `parseAudioFile`
* RIFF-Zusammenbau, `fflp`, `smpl`/ID3-Tags: `src/Entry.cs`, `getWaveStream`
* Schleifenformel-Historie: Commits `38b8ab1`, `5752e20`, `f9b0fb7`
* Klipp-Nummerierung: Commit `59a1a0e`; `src/Entry.cs`, `renderList` / `btnExtract_Click`
* Rückschreibpfad: `src/Entry.cs`, `dumpAudioFile`
* Registry: `src/Entry.cs`, Konstruktor; `src/FF7SNDDlg.cpp`, `OnInitDialog`

## Gegenstelle in WebMidgar (nur gelesen, nichts geändert)

* `C:\ff7-web\packages\audio\src\audio-fmt.ts` — Parser, Audit, `loopFrames`,
  `predictSamplesPerBlock`
* `C:\ff7-web\tools\realdata-scan\FINDINGS.md` — Abschnitte „`audio.fmt` —
  Vorspann gelöst" und „`audio.fmt` — die 48,5 MB sind adressiert"
* `C:\ff7-web\tools\realdata-scan\src\audio-sound-id-probe.rdtest.ts` — Probe
  zur Sound-ID-Obergrenze (724 vs. 750)
