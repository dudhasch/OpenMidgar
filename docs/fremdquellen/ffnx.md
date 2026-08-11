# FFNx — Research-Notizen (Reverse-Engineering-Quelle für WebMidgar)

## 0. LIZENZ- UND CLEAN-ROOM-WARNUNG (zuerst lesen)

| Punkt | Fakt |
| --- | --- |
| Repo | `https://github.com/julianxhokaxhiu/FFNx` |
| Commit (Stand dieser Analyse) | `665b845f030d08d3e12e4dd1bf08ac2dad3e685f`, 2026-08-06 |
| Lizenz | **GPL-3.0** — `COPYING.TXT` ist der vollständige GPLv3-Text; `README.md:323` sagt explizit „FFNx is released under GPLv3 license". Die Datei-Header (z. B. `src/ff7.h:14-20`) formulieren „either version 3 of the License" **ohne** „or (at your option) any later version" ⇒ praktisch **GPL-3.0-only**. |
| Copyright-Halter | Aali132 (2009), quantumpencil, Maxime Bacoux, myst6re, Chris Rizzitello, John Pritchard, Julian Xhokaxhiu, Marcin 'Maki' Gomulak, Cosmos, Tang-Tang Zhou (Header-Blöcke in jeder Datei) |

**Regeln für WebMidgar:**

1. **Kein FFNx-Quellcode darf nach `C:\ff7-web` kopiert werden** — weder wörtlich noch als „übersetzte" Zeile-für-Zeile-Portierung. WebMidgar ist Clean-Room; GPLv3 ist copyleft und würde das gesamte Projekt infizieren.
2. Diese Notizen enthalten **absichtlich keinen Quellcode**, nur Beschreibungen von Fakten, Datenlayouts und Algorithmen in eigenen Worten, jeweils mit Zitat `pfad/datei.cpp:zeile`.
3. **ff7.exe-Adressen (`0x64A070`, `0x649B50`, …) und Original-Datenformate sind Fakten über die *Binärdatei*, nicht FFNx-Code.** Sie sind nicht durch FFNx' Copyright geschützt. Struct-*Namen* wie `field_tile` sind FFNx-Nomenklatur — WebMidgar sollte eigene Namen wählen (die deutschen Begriffe des Projekts).
4. Wo FFNx eine *Interpretation* liefert (z. B. „Feld X ist die Palette"), ist das eine **Hypothese, die WebMidgar unabhängig an echten Daten verifizieren muss** (Tools: `tools/realdata-scan`).
5. FFNx' *Bugfixes* (60-FPS-Interpolation, Widescreen) sind kreative Werke — ihre bloße Existenz als Hinweis („hier hat das Original ein Problem") ist ein Fakt, die konkrete Lösung ist es nicht.

---

## 1. Repo-Überblick

Shallow-Clone: 12 MB, `src/` + `docs/`.

| Bereich | Pfade | Größe (Top) |
| --- | --- | --- |
| ff7.exe-Strukturen + Adressen | `src/ff7.h` (107 KB), `src/ff7_data.h` (157 KB) | zentral |
| Feld | `src/ff7/field/{background,model,field,opcode,camera}.cpp`, `src/field.cpp` | `background.cpp` 56 KB |
| Kampf | `src/ff7/battle/{animations,camera,effect,battle,menu}.cpp` | `animations.cpp` 89 KB |
| Weltkarte | `src/ff7/world/{renderer,player,camera,world}.cpp` | `renderer.cpp` 37 KB |
| Renderer-Abstraktion | `src/renderer.cpp/.h` (bgfx), `src/gl/{gl,deferred,texture,special_case}.cpp` | `renderer.cpp` 98 KB |
| Grafik-Treiber-Ersatz | `src/common.cpp` (121 KB), `src/fake_dd.cpp`, `src/ff7/graphics.cpp` | |
| Audio | `src/{music,audio,sfx,voice}.cpp`, `src/audio/**` | |
| Video | `src/video/movies.cpp` (48 KB), `src/movies.cpp` | |
| Docs | `docs/color_modes.md` (29 KB), `docs/mods/audio_engine.md`, `docs/mods/video_encoding_guide.md` | |

Architektur: FFNx ersetzt `ff7_opengl.dll`/den originalen Grafiktreiber. Es (a) implementiert die vom Spiel erwartete **Treiber-Funktionstabelle** (`ff7_gfx_driver`, `src/ff7.h:2014`) neu auf bgfx, und (b) **patcht Funktionen in ff7.exe** (`replace_function`, `replace_call_function`, `patch_code_*` aus `src/patch.cpp`), um Engine-Bugs zu beheben und Framerate/Seitenverhältnis zu ändern. Adressen werden **relativ aufgelöst** (`get_relative_call`, `get_absolute_value` in `src/ff7_data.h`), ausgehend von wenigen Ankerpunkten — also robust über Sprachversionen (US/DE/FR/SP via `src/externals_102_*.h`).

---

## 2. FELD — Hintergrund-Komposition (höchster Wert für S39)

### 2.1 Vier Ebenen, Tile-Auswahl

`src/ff7/field/background.cpp` implementiert exakt die vier Original-Funktionen neu:
`field_layer1_pick_tiles` (:45), `field_layer2_pick_tiles` (:80), `field_layer3_pick_tiles` (:142), `field_layer4_pick_tiles` (:269).

Gemeinsames Muster jeder Ebene:

1. Iteration läuft **nicht** über die Tile-Reihenfolge, sondern über ein separates **Paletten-Sortier-Array** `field_layerN_palette_sort` (`background.cpp:70, 104, 181, 303`). Das Original sortiert die Tiles also nach Palette, um Palettenwechsel im Treiber zu minimieren. → *WebMidgar: Zeichenreihenfolge innerhalb einer Ebene ist palettensortiert, nicht datenreihenfolge-sortiert.*
2. Ursprungsoffset: `initial_pos = bg_multiplier * (320 − bg_pos.x, 224 − bg_pos.y)` (`:62-63`). **320 × 224 ist der Bildschirm-Halbmittelpunkt-Bezug**; FFNx ersetzt 224 durch 232, wenn vertikale Zentrierung aktiv (`ff7_field_center`).
3. `field_bg_multiplier` ist ein globaler Ganzzahl-Skalierungsfaktor (interne Auflösungsverdopplung), Adresse abgeleitet aus `field_layer2_pick_tiles+0x23` (`src/ff7_data.h:366`).
4. Jedes Tile wird über eine einzige Engine-Funktion eingereiht: `add_page_tile(x, y, z, u, v, palette_index, page)` (`src/ff7_data.h:367`, Aufrufe `background.cpp:75, 121, 201, 324`). **Das ist die Kern-API der Hintergrund-Komposition: Position, Tiefe, UV, Palettenindex, Textur-Page.**

### 2.2 Z-Werte pro Ebene (Tiefensortierung gegen 3D-Modelle)

| Ebene | Z-Quelle | Zitat |
| --- | --- | --- |
| Layer 1 (Hintergrund) | Konstante **0.9997** | `background.cpp:75` |
| Layer 2 (Haupt-/Overlay-Tiles) | **Pro Tile**: `field_tile.z` (float) | `background.cpp:121` |
| Layer 3 (Parallax A) | `field_layer_sub_623C0F(camera_rot_matrix, modules_global.field_B0, 0, 0)`, Fallback **0.9998**, wenn `field_B0 >= 0xFFF` | `background.cpp:165-168` |
| Layer 4 (Parallax B) | `field_layer_sub_623C0F(camera_rot_matrix, modules_global.field_AE, 0, 0)` | `background.cpp:290` |

⇒ **Layer 3/4 haben eine skript-steuerbare Tiefe** (`field_AE`/`field_B0` im globalen Modul-Objekt), die durch die Kamera-Rotationsmatrix projiziert wird. Layer 1 liegt ganz hinten (fast 1.0), Layer 2 interleaved mit den 3D-Modellen.

### 2.3 Blend-Modi — der wichtigste Fund

**Original-Engine-Design (`src/ff7/field/field.cpp:78-116`, `field_load_textures`):** Der Hintergrund besteht aus **29 Textur-„Pages"** (`for i in 0..28`). Der Blend-Modus ist **nicht pro Tile im Treiber gesetzt, sondern pro Page fest verdrahtet** — die Page-Nummer *kodiert* den Blend-Modus:

| Layer-Typ | Page-Index | Blend-Modus |
| --- | --- | --- |
| Typ 1 (palettiert) | 0 … 14 | 4 (kein Blending / opak) |
| Typ 1 | 15 … 23 | 1 (additiv) |
| Typ 1 | 24 … 28 | 0 (50/50-Mittelung) |
| Typ 2 (Direktfarbe) | < 33 | 4 |
| Typ 2 | 33 … 39 | 1 |
| Typ 2 | ≥ 40 | 0 |

**Lücke im Original:** Blend-Modi **2 (Subtraktion)** und **3 (25 % additiv)** waren im PC-Port *nicht erreichbar*, weil keine Page sie trug. FFNx legt zusätzliche Kopien an (`field.cpp:111-112`): Pages 15–18 → Kopie auf +14 mit Blend 2; Pages 15–20 → Kopie auf +18 mit Blend 3; `layer2_end_page += 18` (`:115`). Beim Tile-Zeichnen wird dann umgeleitet (`background.cpp:118-119`): `blend_mode == 2` ⇒ `page += 14`, `blend_mode == 3` ⇒ `page += 18`.
→ *Der Kommentar `field.cpp:107-110` sagt, die Zahlen stammen „aus Original-Daten": genau in diesen Pages treten die fehlenden Modi auf.*

**Sonderfall-Bug:** Feld-ID **347 (`fr_e`)** benutzt für Slots 15–18 Blend-Modus 2 (`field.cpp:96`) — im Original falsch dargestellt (Changelog: „Fix `fr_e` field blend mode", `Changelog.md:78`).

**Blend-Modus → GPU-Gleichung** (`src/renderer.h:53-58`, `src/renderer.cpp:1404-1423`):

| Index | Name | Blend-Gleichung |
| --- | --- | --- |
| 0 | `BLEND_AVG` | ADD, `src=SRC_ALPHA`, `dst=INV_SRC_ALPHA` (klassisches Alpha-Blending; PSX „50 % + 50 %") |
| 1 | `BLEND_ADD` | ADD, `src=ONE`, `dst=ONE` |
| 2 | `BLEND_SUB` | **REVERSE_SUBTRACT**, `src=ONE`, `dst=ONE` (dst − src) |
| 3 | `BLEND_25P` | ADD, `src=SRC_ALPHA`, `dst=ONE` (PSX „100 % dst + 25 % src") |
| 4 | `BLEND_NONE` | ADD, `src=ONE`, `dst=ZERO` (opak). **Ausnahme:** bei externen (Mod-)Texturen in FF7 wird stattdessen SRC_ALPHA/INV_SRC_ALPHA benutzt (`renderer.cpp:1422`). |

Das ist die 1:1-Entsprechung der PSX-GPU-Semi-Transparenzmodi. → `render-field` sollte genau diese fünf WebGL-Blendzustände führen.

### 2.4 Tile-Datensatz (`field_tile`, `src/ff7.h:1562-1602`)

Laufzeit-Struktur (nicht Dateiformat!), ~0x105C Bytes/Tile:

| Offset | Feld | Bedeutung / Anmerkung |
| --- | --- | --- |
| 0x00 | `x`, `y` (short) | Tile-Position im Hintergrundraum |
| 0x04 | `z` (float) | Tiefe — nur Layer 2 nutzt sie pro Tile |
| 0x0C | `img_x`, `img_y` (WORD) | Quellposition in der Page |
| 0x10 | `u`, `v` (float) | vorberechnete UVs (an `add_page_tile` übergeben) |
| 0x18 | `fx_img_x`, `fx_img_y` | Quellposition in der **FX-Page** |
| 0x2C | `tile_size_x/y` (WORD) | Tile-Größe |
| 0x30 | `palette_index` (WORD) | Palettenindex |
| 0x32 | `flags` (WORD) | |
| 0x34 | `anim_group` (char) | **Animationsgruppe** |
| 0x35 | `anim_bitmask` (char) | **Animations-Bitmaske** |
| 0x38 | 4096-Byte-Puffer | (unbenannt) |
| 0x103C | `use_fx_page` | wählt `fx_page` statt `page` |
| 0x1040 | `field_1040` | „gezeichnet"-Flag Layer 2/3/4 |
| 0x1044 | `field_1044` | „gezeichnet"-Flag Layer 1 |
| 0x1058 | `blend_mode` (WORD) | 0–4 |
| 0x105A | `page`, `fx_page` (WORD) | Page-Index (kodiert Blend-Modus, s. o.) |

### 2.5 Hintergrund-**Animation** (Kern von S39)

Der Mechanismus ist einfach und global (`background.cpp:107-109, 189-192, 311-314`):

```
sichtbar(tile) = (tile.anim_group == 0)
              || (modules_global.background_sprite_layer[tile.anim_group] & tile.anim_bitmask) != 0
```

- `background_sprite_layer` ist ein **64-Byte-Array** im globalen Modul-Objekt (`src/ff7.h:2218`), indiziert mit `anim_group` (0…63).
- Jedes Byte ist eine **Bitmaske aktiver Frames**; ein Tile ist sichtbar, wenn sein `anim_bitmask` gegen die aktuelle Gruppenmaske trifft.
- Layer 1 kennt **keine** Animationsgruppe (dort wird nicht gefiltert, `background.cpp:68-77`) ⇒ Layer 1 ist statisch.
- Gesetzt wird das Array vom Skript-Opcode **BGON/BGOFF** und vom `field_trigger`-Datensatz (`bg_group_id`, `bg_frame_id`, `src/ff7.h:2356-2357`).

**Original-Bug + Fix:** Die Hintergrundanimation lief weiter, während das Menü (`_mode == 5`) das Skript pausierte ⇒ Desynchronisation der Windwand-Felder `woa_*`. FFNx gibt in `ff7_field_update_background_smooth`/`_original` bei `_mode == 5` früh zurück (`background.cpp:938-943, 1015-1021`; Changelog `:79, :125`). → *WebMidgar muss Hintergrundanimation an den Skript-Tick koppeln, nicht an den Renderer-Tick.*

### 2.6 Parallax-Scrolling Layer 3/4

`set_world_and_background_positions` (`background.cpp:885-896`) — die exakte Formel:

```
bg3_pos.x = rem( bg3_pos_x/16 + (bg3_speed_x * delta.x)/256 , bg3_width )
            + 320 − bg_offset.x − shake_bg_x.shake_curr_value
bg3_pos.y = rem( bg3_pos_y/16 + (bg3_speed_y * delta.y)/256 , bg3_height )
            + 232 − bg_offset.y − shake_bg_y.shake_curr_value
```
(analog für Layer 4 mit `bg4_*`).

- `bg3_pos_*` ist **1/16-Fixkomma**, `bg3_speed_*` ist **1/256-Fixkomma** relativ zur Kameraverschiebung.
- Wrapping über `remainder(...)` gegen `bg{3,4}_width/height`.
- Diese acht Werte stehen im **`field_trigger_header`** (`src/ff7.h:2378-2402`): `bg3_width, bg3_height, bg4_width, bg4_height, bg3_pos_x/y, bg4_pos_x/y, bg3_speed_x/y, bg4_speed_x/y`. → *Das ist die Sektion 9 („triggers") der Feld-Datei; für `formats-field` direkt verwertbar.*

**Tile-Wrapping** (`field_layer3_shift_tile_position`, `:126-140`): Ein Tile außerhalb des Fensters `[bg.x − 352, bg.x]` × `[bg.y − 256, bg.y]` wird um ±`layer_width`/`layer_height` verschoben, je nachdem, ob es rechts/links der Halbbreite (160) bzw. Halbhöhe (112) liegt. → *Sichtbares Fenster im Hintergrundraum ist 352 × 256 (ein Rand über 320 × 224 hinaus).*

### 2.7 Kamera-Bereich (Clipping des Scrollings)

`field_clip_with_camera_range_float` (`background.cpp:417-479`):

```
x ∈ [camera_range.left + 160 , camera_range.right − 160]
y ∈ [camera_range.top  + 120 , camera_range.bottom − 120]
```
`camera_range` ist `{left, top, right, bottom}` (short) im `field_trigger_header` (`src/ff7.h:2370-2376, 2383`).

`float_sub_643628` (`:481-516`) implementiert zwei **Sonderbewegungsmodi** über `trigger_header.field_14[0]`:
- `== 1`: Kamera folgt der **Diagonalen von (left+160, top+120) nach (right−160, bottom−120)** — Projektion des gewünschten Punkts auf diese Gerade.
- `== 2`: dieselbe Projektion auf die **Gegendiagonale** (von unten-links nach oben-rechts).
- `== 0`: freie 2D-Bewegung.
→ *Das erklärt Felder, in denen die Kamera nur entlang einer Linie scrollt. `field_14[0]` ist damit als „Kamera-Bewegungstyp" identifiziert.*

### 2.8 Bildschirm-Shake

`ff7_shake_bg_data` (`src/ff7.h:2120-2131`), je einmal für X und Y im globalen Modul-Objekt (`:2209-2210`):
`do_shake, shake_phase, amp_index, shake_curr_value, shake_amplitude, shake_initial, shake_final, shake_n_steps, shake_idx`.
`shake_curr_value` wird direkt von allen Ebenenpositionen abgezogen (`background.cpp:880-896`) ⇒ **Shake betrifft alle vier Ebenen und die 3D-Weltposition gleichermaßen**. Der Opcode SHAKE wird von FFNx ganz ersetzt (`field/field.cpp:340`).

### 2.9 Feld-„Direktfarbe" (Typ-2-Layer) — Original-Quirk

`field_convert_type2_layers` wandelt Direktfarb-Layer um. FFNx patcht dort eine Konstante auf **`0x8000`** (`src/ff7_opengl.cpp:321`, Kommentar „field direct color black"). 0x8000 = A1R5G5B5 mit gesetztem Maskenbit und RGB=0 ⇒ **opakes Schwarz**. Ohne den Patch wird Schwarz in Direktfarb-Layern transparent.
Passend dazu die Texturkonvertierung (`src/common.cpp:1845, 1857`):
- `color_key == 1`: Pixel ist transparent, wenn **alle Nicht-Alpha-Bits null** sind (PSX-Maskenbit-Semantik).
- `color_key == 3`: Pixel ist transparent, wenn **der ganze 16-Bit-Wert 0** ist. (Feld-Typ-2-Header setzt genau `color_key = 3`, `field/field.cpp:58`.)
- `invert_alpha`: Alpha wird invertiert **außer** für den exakten Wert `0x8000` — „Sonderfall für schlecht konvertierte PSX-Bilder in FF7".

### 2.10 Palette: das 0xFE-Alpha-Idiom

`pal2bgra` (`src/common.cpp:1762-1773`): Ein Paletteneintrag mit **Alpha-Byte == 0xFE** wird durch `reference_alpha` aus dem TEX-Header ersetzt. Kommentar: *„FF7 uses a form of alpha keying to emulate PSX blending"*. Zusätzlich: `color_key != 0` ⇒ **Index 0 ist immer transparent**.
→ *Für `formats-field`/`render-field`: TEX-Paletten müssen auf 0xFE geprüft und mit `reference_alpha` (TEX-Header `+0xC4`, `src/ff7.h:536`) ersetzt werden.*

### 2.11 TEX-Header (`ff7_tex_header`, `src/ff7.h:490-546`)

Relevante Felder mit Offsets: `version` (0), `color_key` (8), Union `{minbitspercolor…}` / `{x,y,w,h}` (0x14), Union `{minbitsperpixel,maxbitsperpixel}` / `{psx_name, pc_name}` (0x24), `palettes` (0x30), `palette_entries` (0x34), `bpp` (0x38), `tex_format` (0x3C), `use_palette_colorkey`, `palette_colorkey`, `reference_alpha` (0xC4), `blend_mode` (0xC8), `palette_index` (0xD0), `image_data`, `old_palette_data`, `vram_positions`.
Die zweite Union zeigt: **dieselben 8 Bytes sind auf Disk `minbitsperpixel/maxbitsperpixel`, zur Laufzeit zwei Dateinamen-Zeiger** — der PC-Port recycelt Felder.

### 2.12 Feld-Modelle und -Objekte

**`field_object`** (`src/ff7.h:619-660`, ~0x288C Bytes): `name[256]`, `hrc_filename[256]`, **Beleuchtung pro Modell**: `r/g/b_ambient` + drei Lichter mit je RGB und `x/y/z`-Richtung (short) (`:631-652`), `num_animations` (WORD), `anim_filenames[8880]` (= 8880/37? — Slots à fester Länge).
→ *Das ist Sektion 2/3 der Feld-Datei (Modell-Loader). Drei gerichtete Lichter + Ambient pro Feldmodell ist eine harte Vorgabe für `render-actor`.*

**`field_event_data`** (`src/ff7.h:2261-2321`, 0x88 Bytes) — Laufzeitzustand pro Modell:
- `model_pos` / `model_initial_pos` / `model_final_pos` (`vector3<int>`) — **1/4096-Fixkomma**, belegt durch `model_pos.x / 4096.f` (`background.cpp:624-626`, `:916-918`).
- Rotation: `rotation_value, rotation_curr_value, rotation_n_steps, rotation_step_idx, rotation_steps_type, rotation_initial, rotation_final`. `rotation_steps_type` ∈ {0 = keine, 1 = linear, 2 = geglättet, 3 = fertig} (`field/model.cpp:74, 218, 243`).
- Offset-Bewegung: `offset_position_x/y/z`, `offset_initial_*`, `offset_final_*`, `offset_n_steps`, `offset_step_idx`, `offset_movement_phase`.
- `movement_type` (1 = laufen/rennen), `animation_id`, `animation_speed`, `currentFrame`, `lastFrame`, `movement_speed`, `movement_phase`.
- **`collision_radius`, `talk_radius`** — getrennte Radien.
- `field_triangle_id` (Walkmesh-Dreieck), `character_id`, `entity_id`, `field_direction_or_collision`.
- `blink_wait_frames`, `apply_kawai`, `opcode_params` (Zeiger auf KAWAI-Parameter).

**Interpolationskurven der Engine** (`src/ff7/field/utils.h:59-68`):
- linear: `lerp(a, b, i/n)`
- „smooth": `a + (b−a) · (0.5 + sin(−π/2 + π·i/n)/2)` — also eine **Sinus-Ease-in-out-Kurve**. Genau diese Formel steuert geglättete Rotation und Offset-Bewegung. *Direkt für `field-runtime` übernehmbar (mathematische Formel, kein Code).*

**Sichtbarkeitstest für 3D-Modelle** (`field/model.cpp:36-44`): Modell wird gezeichnet, wenn Bildschirmposition in `[viewport.x − 40, viewport.x + 400] × [viewport.y − 120, viewport.y + 460]` liegt — bzw. immer, wenn `field_bg_flag_CC15E4` (skriptgesteuerter Hintergrund) gesetzt ist.

**Augen-Blinzeln / Mund (KAWAI)**: `field_model_blink_data {blink_left_eye_mode, blink_right_eye_mode, blink_mouth_mode, model_id}` (`src/ff7.h:2413-2419`); Modi 1 = blinzeln, 2 = fixiert. Der Kopf-Bone wird per Namensvergleich `"head"` gefunden (`field/model.cpp:320`); Augentexturen sitzen in `hundred_data_group_array`, der **Mund in Gruppe 3** (`:331`). Engine-Limit: `eye_texture_idx >= 33` bricht ab (`:318`); FFNx hebt das per Patch auf 128 an (`ff7_opengl.cpp:306-307`). Blinzeln dauert `BLINKING_FRAMES = 4` (`field/model.h:47`). Max. Feldmodelle: **`FF7_MAX_NUM_MODEL_ENTITIES = 32`** (`src/ff7.h:32`).

### 2.13 Feld-Kamera und Projektion — Kernfakten

**`ff7_camdata`** (`src/ff7.h:2099-2118`) = das CAMDAT-Format:
`eye` (3×short), `target` (3×short), `up` (3×short), 2 Byte Padding, `position` (3×int), `pan_x`, `pan_y` (short), `zoom` (short), 2 Byte Padding. Gesamt 0x26 Bytes.

**View-Matrix-Aufbau** (`src/ff7/graphics.cpp:975-1023`): eye/target/up sind die **drei Spalten der Rotationsmatrix in 1/4096-Fixkomma** (durch 4096 teilen), `position` ist die Translation (`_41/_42/_43`), `_44 = 1`. Also:
`M = [ eye/4096 | target/4096 | up/4096 ]` spaltenweise, dann Translation.
→ *Die Namen „eye/target/up" sind irreführend: es sind Basisvektoren, keine Punkte. Wichtiger Fund für `render-field`.*

**Projektion (PSX-Stil, `field/utils.h:70-96`):**
```
v  = R · p + T                        (R,T aus der Engine-Rotationsmatrix)
sx = v.x · scale / v.z + delta_x
sy = v.y · scale / v.z + delta_y
depth_key = v.z · 0.25
```
`scale`, `delta_x/y` stammen aus `ff7_game_engine_data` (`src/ff7.h:1131-1148`). Das ist eine **echte Perspektivdivision ohne Matrix**, mit einem projektiven Skalar `scale` (entspricht PSX-„h"/Projektionsdistanz). `delta_x/y` wird auf `field_viewport_xy` gesetzt und danach auf `field_max_half_viewport_width_height` zurückgesetzt (`utils.h:103-108`) — also **Viewport-Offset als Teil der Projektion**, nicht als Viewport-Transform.

`transform_matrix` (`src/ff7.h:1112-1128`, gepackt): 9 shorts (eye/target/up) + 3 ints (Position) — dieselbe Konvention, gepackt für die Engine-Matrixfunktionen. `rotation_matrix` (`:1104-1110`) ist `short[3][3]` + `int[3]` — **PSX-typisch 1/4096-Fixkomma-Rotationsmatrix mit 32-Bit-Translation**.

### 2.14 Feld-Trigger/Gateways (`field_trigger_header`, `src/ff7.h:2378-2402`)

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `field_name[9]` | byte | Feldname |
| `control_direction` | byte | Richtung, in die „oben" auf dem Steuerkreuz zeigt |
| `focus_height` | short | Kamera-Fokushöhe |
| `camera_range` | 4×short | left/top/right/bottom |
| `field_14[4]` | byte | `[0]` = Kamera-Bewegungstyp (0/1/2, s. 2.7) |
| `bg3/bg4 width,height,pos_x/y,speed_x/y` | short | Parallax (s. 2.6) |
| `gateways[12]` | `field_gateway` | je: 2 Endpunkte der Ausgangslinie (`vector3<short>`), Zielvertex, `field_id` (short), 4 Byte unbekannt |
| `triggers[12]` | `field_trigger` | 2 Eckpunkte (`vector3<short>`), `bg_group_id`, `bg_frame_id`, `behavior`, `sound_id` |
| `show_arrow_flag[12]` | byte | |
| `arrows[12]` | `field_arrow` | `pos_x/y/z` (int), `arrow_type` (int) |

→ *`field_trigger` verbindet Trigger direkt mit **Hintergrundanimation** (`bg_group_id`/`bg_frame_id`) und **Sound** (`sound_id`). Bestätigt 2.5.*

### 2.15 Feld-Skript-Header (`ff7_field_script_header`, `src/ff7.h:2223-2233`)

`unknown1` = immer **0x0502**; `nEntities` (char); `nModels` (char); `wStringOffset` (WORD); `nAkaoOffsets` (WORD); **`scale` (WORD) — „Scale of field. For move and talk calculation (9bit fixed point)"**; 3 WORD leer; `szCreator[8]`; `szName[8]`.
→ *Der Feld-`scale` als 9-Bit-Fixkomma (Divisor 512) ist ein konkret prüfbarer Fakt für `formats-field` und die Kollisions-/Sprechradius-Berechnung.*

### 2.16 Globales Modul-Objekt (`ff7_modules_global_object`, `src/ff7.h:2133-2221`)

Zentraler Zustandsblock, u. a.: `game_mode`, `battle_id`, `field_model_pos_x/y`, `field_model_triangle_id`, `field_model_anim_id`, `previous_game_mode`, `num_models`, `field_model_id`, Skript-Flags **`SCRLO_flag, MPDSP_flag, MVCAM_flag, BGMOVIE_flag, BTLON_flag`**, `midi_id`, Fade-Block (`fade_type, fade_adjustment, fade_speed, fade_r/g/b, nfade_r/g/b`), `field_id`, `current_key_input_status`, `previous_key_input_status`, `MOVIE_frame`, `shake_bg_x/y`, **`bg2_scroll_speed_x/y`, `bg3_scroll_speed_x/y`**, `field_AE`/`field_B0` (Layer-4/3-Tiefe), `background_sprite_layer[64]`.

### 2.17 Feld-Skript-Bewegungsmodi (`field_init_scripted_bg_movement`, `background.cpp:632ff`)

`world_move_mode` (0…n) im Modul-Objekt steuert skriptgetriebenes Hintergrund-Scrolling (SCRLA/SCRLC/SCR2D…); `world_move_status` ist der Fortschritt (2 = fertig); `world_move_follow_model_id` das verfolgte Modell (`src/ff7.h:2153-2155`).

### 2.18 Feld-Opcodes, die FFNx anfasst (Indikatoren für Original-Quirks)

`src/ff7/field/field.cpp:259-370`, `src/field.cpp`:
`KAWAI` (mit Subcodes **0x0 EYETX, 0x1 TRNSP, 0x2 AMBNT, 0x6 LIGHT, 0x7, 0x8/0x9, 0xD SHINE**, `src/field.cpp:79-199`), `BGSCR`, `SHAKE`, `SCRLC`, `SCRLA`, `SCR2DC`, `SCR2DL`, `SCRLP`, `NFADE`, `FADE` (Bug bei `type=2`, Changelog `:126`), `VWOFT`, `OFST`, `MVIEF`, `BGMOVIE`, `WAIT`, `IFKEY`, `IFSW`, `VISI`, `CANIM1/2`, `CANMX1/2`, `JUMP`.
→ *KAWAI-Subcode-Zuordnung ist ein sofort verwertbarer Fakt für den Interpreter. Bemerkenswert: der KAWAI-Zustand ist **persistent pro Modell**, muss beim Feldwechsel zurückgesetzt werden (`field/model.cpp:272-300`) — sonst „hängt" Beleuchtung/Transparenz. LIGHT (0x6) setzt `polygon_set->light = nullptr` (`field/field.cpp:245-248`), deaktiviert also die globale Beleuchtung für das Modell.*

---

## 3. RENDERER-ABSTRAKTION (Original-Treiber → moderne GPU)

### 3.1 Polygon-Typen (`polygon_types`, `src/ff7.h:44-66`)

Systematik `[T=texturiert|S=untexturiert][F=flat|G=gouraud][optional T=?][2D|3D]`:
`PT_TF2D=0, PT_TF3D, PT_TG2D, PT_TG3D, PT_T2D, PT_T3D, PT_TGT2D, PT_TGT3D, PT_SF2D, PT_SF3D, PT_SG2D, PT_SG3D, PT_S2D, PT_S3D, PT_SGT2D, PT_SGT3D, (10), (11), PT_LF2D, PT_L2D`.
Kommentar `src/ff7.h:42`: **„2D bedeutet keinerlei Transformation; Billboards/Sprites gelten weiterhin als 3D."** Feld-Hintergrundebenen werden als `PT_S2D` geladen (`field/field.cpp:74`).

### 3.2 Spielmodi (`ff7_game_modes`, `src/ff7.h:69-99`)

`1 FIELD, 2 BATTLE, 3 WORLDMAP, 5 MENU, 6 HIGHWAY, 7 CHOCOBO, 8 SNOWBOARD, 9 CONDOR, 10 SUBMARINE, 11 COASTER, 12 CDCHECK, 14 SNOWBOARD2, 17 BATTLE_MENU, 19 EXIT, 20 MAIN_MENU, 22 INTRO, 23 SWIRL, 25 ENDING2, 26 GAMEOVER, 27 CREDITS`.

### 3.3 Modell-Flags (`model_modes`, `src/ff7.h:102-114`)

`MDL_ROOT_ROTATION 0x1`, `…_NEGX 0x2`, `…_NEGY 0x4`, `…_NEGZ 0x8`, `MDL_ROOT_TRANSLATION 0x10`, `…_NEGX 0x20`, `…_NEGY 0x40`, `…_NEGZ 0x80`, `MDL_USE_STRUC110_MATRIX 0x4000`, `MDL_USE_CAMERA_MATRIX 0x8000`.
→ *Root-Motion aus der `.a`-Animation kann pro Achse einzeln an-/abgeschaltet und negiert werden. Direkt relevant für `render-actor`.*

### 3.4 Animationsformat `.a` (`anim_header`, `src/ff7.h:1201-1223`; Loader `src/ff7/loaders.cpp:29-89`)

- `version` muss **1** sein.
- Kopf: `num_frames`, `num_bones`, **`rotation_order[4]`** (Achsenreihenfolge als 4 Zeichen).
- Frame-Datengröße = `(num_bones · sizeof(vec3f) + sizeof(anim_frame_header)) · num_frames` (`loaders.cpp:33`).
- `anim_frame_header` = `root_rotation` (vec3f) + `root_translation` (vec3f) (`src/ff7.h:1189-1193`).
- Danach `num_bones` × vec3f **Euler-Rotationen pro Bone** — d. h. **keine Quaternionen, keine Translationen pro Bone**; Bone-Länge kommt aus der HRC.

**`hrc_bone`** (`src/ff7.h:1241-1250`): `bone_name`, `bone_parent` (**per Name**, nicht Index — `parent_index` wird beim Laden aufgelöst), `bone_length` (float), `num_rsd`, `rsd_names[]`, `rsd_array[]`.
**`battle_hrc_header`** (`:1172-1187`): `bones`, `num_textures`, `num_animations_1`, `animations_2_start_index`, `num_weapons`, `num_animations_2`; Bone-Array folgt direkt (`loaders.cpp:120`). Battle-HRC hat die Endung **„D"** statt der übergebenen (`loaders.cpp:102`).
`ff7_hrc_polygon_data` (`:1272-1296`) enthält u. a. **`fps` (int, Offset 0x2C)** und `number_of_frames` — die Abspielrate steckt also im Modellobjekt, nicht in der `.a`-Datei.

### 3.5 Skinning

FFNx unterscheidet `draw_3d_model` (`graphics.cpp:441`, hartes Bone-Parenting) und `draw_3d_model_smooth_skinning` (`:632`) mit `ff7_extended_vertex_data { int boneIndices[4]; float boneWeights[4]; }` (`src/ff7.h:477-481`). **Das Original kennt nur hartes Parenting**; 4-Bone-Skinning ist eine FFNx-Erweiterung. → *WebMidgar sollte Original-Verhalten (1 Bone pro Vertex) implementieren.*

### 3.6 Deferred Rendering / Sortierung (`src/gl/deferred.cpp`)

FFNx puffert Draw-Calls und sortiert sie neu, weil die Original-Zeichenreihenfolge auf einer GPU ohne PSX-Sortier-Tabelle falsch aussieht.

- `gl_defer_sorted_draw` (`:444`) berechnet pro Dreieck ein **mittleres Screen-Space-Z** (Durchschnitt der drei Vertex-Z nach World-View-, Projektions- und Viewport-Transform, `:531-551`), gruppiert Dreiecke mit **identischem** Z zu „Layern" (`:555-601`) und zeichnet sie danach von **hinten nach vorne** (größtes Z zuerst, `:798-813`) mit erzwungenem Depth-Test/Write (`:816-817`).
- **Ausschlusskriterien** für die Neusortierung (`:462-518`): Depth-Test aus, Framebuffer-Textur, Blend-Modus ≠ NONE/AVG (außer in MENU/BATTLE), Textur ohne Alpha (`alpha_bits < 2`), Primitivtyp ≠ Dreiecke (Quads sind GUI).
→ *Kernaussage für WebMidgar: **Das Original sortiert Feld-Geometrie über diskrete Z-Ebenen, nicht über einen Z-Buffer.** Gleiche Z-Werte müssen als eine Ebene behandelt werden. Alpha-getestete Texturen brauchen Back-to-front.*
- Deferred „Draw-Call-Typen": `DCT_CLEAR`, `DCT_BLIT` (Framebuffer→Textur), `DCT_DRAW_MOVIE` (YUV-Frame), `DCT_ZOOM`, `DCT_BATTLE_DEPTH_CLEAR`, `DCT_WORLD_EXTERNAL_MESH`, `DCT_CLOUD_EXTERNAL_MESH`, `DCT_EXTERNAL_MESH` (`:635-689`). **`DCT_BATTLE_DEPTH_CLEAR`**: der Kampf löscht mitten im Frame den Tiefenpuffer.

### 3.7 Texturformat-Konvertierung (`src/common.cpp:1776-1864`)

- Ziel ist immer **32-Bit BGRA**; FFNx registriert beim Spiel das Format `32 Bit, R=0xFF0000, G=0xFF00, B=0xFF, A=0xFF000000` (`common.cpp:1120`).
- Palettierte Quellen: **1 Byte/Pixel**; **4-Bit-Paletten expandiert das Spiel selbst auf 8 Bit** (`:1783`).
- Nichtpalettiert: 2/3/4 Byte/Pixel; Kanäle über generische `mask/shift/max` skaliert (`:1852-1854`).
- Mehrere Paletten pro Textur: `tex_header.palettes`, ausgewählt über `palette_index`; FFNx alloziert `palettes · 2` GPU-Texturen (`:1899`) und lädt bei Änderung der Palettenanzahl komplett neu (`:1912-1916`).

### 3.8 Projektionsmatrix

FFNx erhält die D3D-Projektionsmatrix vom Spiel und modifiziert sie nur (`renderer.cpp:2428-2461`) — die Engine liefert also eine fertige Matrix. Für Widescreen wird `m[0]`/`m[8]` skaliert; für die Weltkarte werden `n`/`f` aus `m[10]`/`m[11]` rückgerechnet und `f` um 0.0035 erhöht (Sichtweite).

---

## 4. TIMING / FRAMERATE — Original-Modell

**`ff7_limit_fps` (`src/ff7/misc.cpp:672-758`) rekonstruiert die Original-Zielraten pro Modus:**

| Modus | Original-Zielrate |
| --- | --- |
| FIELD | **30 fps** |
| WORLDMAP | **30 fps** |
| BATTLE | **15 fps** |
| SWIRL (Kampfwirbel) | 30 fps |
| MENU / MAIN_MENU | **60 fps** |
| SNOWBOARD / COASTER / CONDOR | **60 fps** |
| CREDITS | **39 fps** (!) |
| SUBMARINE | 30 fps |
| GAMEOVER | ungelimitet |

Der Limiter ist ein **Busy-Wait** auf `QueryPerformanceCounter` gegen `countspersecond / framerate` (`:752-757`). Das Original nutzte `rdtsc`; FFNx ersetzt `get_time`/`diff_time` durch QPC (`ff7_opengl.cpp:230-239`).

**FPS-Multiplikatoren** (`src/ff7_opengl.cpp:254-266`): `battle_frame_multiplier` = 2 (30 fps) bzw. 4 (60 fps); `common_frame_multiplier` = 2 bei 60 fps. FFNx skaliert damit systematisch: Bewegungsgeschwindigkeit (`/ multiplier`, `field/model.cpp:88`), Encounter-Rate (`field/field.cpp:174`, `world/world.cpp:135`), Textbox-Paging-Verzögerungen, Fade-Dauern (`field/field.cpp:317-318`: 25 Frames × Multiplikator), Kamera-Skript-Wartezeiten (`battle/camera.cpp:94`).
→ **Für WebMidgar wichtig:** Alle Zeitangaben in Skripten/Daten sind in **Ticks der modusspezifischen Rate**, nicht in Sekunden. Ein Feld-`WAIT n` = n/30 s, ein Kampf-Wartewert = n/15 s.

**Frame-Interpolation** (FFNx-Erfindung, nicht Original): Positionen werden zwischen zwei Logikschritten linear interpoliert (`field/model.cpp:124-134`) und die Hintergrundposition auf **1/10-Pixel gerundet** (`MIN_STEP_INVERSE = 10`, `background.cpp:39, 898-906`), weil sonst Risse zwischen Tiles entstehen. → *Fakt über das Original: **Tiles stoßen exakt aneinander; subpixelgenaue Hintergrundpositionen erzeugen sichtbare Nähte.** WebMidgar sollte Hintergrundpositionen quantisieren.*

---

## 5. WELTKARTE

- **Kugelkrümmung**: `calcSphericalWorldPos` (`world/renderer.cpp:113-149`) bildet flache Weltkoordinaten auf eine gekrümmte Oberfläche ab, mit Krümmungsradius **`rp = −250000`**, über eine exponentielle Abbildung in View-Space (Höhe/Distanz-Ebene → Kreis). Das erklärt den „Planetenhorizont" der FF7-Weltkarte. *Formel ist beschrieben, nicht kopiert.*
- Drei Weltkarten-Varianten mit eigenen Draw-Pfaden: **wm0 (Oberwelt), wm2 (Unterwasser), wm3 (Schneesturm)** (`world/renderer.h:34-38`). Unterwasser aktiviert **Nebel** (`renderer.cpp:68-71`).
- Die Oberwelt zeichnet zusätzlich **Wolken** und **Meteor** als eigene Pässe (`renderer.h:35-36`); `is_meteor_flag_on_E2AAE4` schaltet den Meteor.
- **UI-Zeichenabschnitte**: der Minimap-Quad markiert den Start des ersten UI-Blocks, die „world effects 1" das Ende, die Minimap-Punkte den zweiten UI-Block (`renderer.cpp:81-95`). ⇒ Reihenfolge im Frame: Welt-Mesh → UI-Block 1 → 2D-Effekte → UI-Block 2.
- **2D-Effekte** (`world_draw_effects`, `renderer.cpp:141ff`): verkettete Liste `world_effect_2d_list_node`; Sichtbarkeits-Clipping bei **±30000** Einheiten in X und Z relativ zur Kamera.
- Kamerarotation: Front-Rotation um Y wird negiert, X-Rotation negiert, in eine `transform_matrix` überführt (`:151-160`). `get_camera_rotation_z` liefert konstant 0 ⇒ **keine Roll-Achse auf der Weltkarte**.
- **`world_event_data`** (`src/ff7.h:2421-2452`): `position`/`prev_position` als `vector4<int>`, `facing` (short), `offset_y`, `curr_script_position`, **`walkmap_type` (WORD)**, `direction`, `model_id`, `animation_is_loop_mask`, `animation_frame_idx`, `movement_speed`, `wait_frames`, `animation_speed`, `animation_id`, `vertical_speed`, `vertical_speed_2`.
- **Bewegungsformel** (`world/world.cpp:105-110`): Schrittweite `z = movement_speed << (4 · ((animation_is_loop_mask & 0x40) ≠ 0))` — Bit 6 der Maske ist also ein **„Rennen"-Flag mit Faktor 16**. Danach Rotation um `direction`; `offset_y -= vertical_speed`, `position.y += vertical_speed_2`.
- Weltkarten-Skript-Opcode **0x306** = Warten mit Bewegung (`world.cpp:91`); `wait_frames` wird dekrementiert, die Skriptposition zurückgesetzt.
- Spielermodelle: 0 Cloud, 1 Tifa, 2 Cid, 3 **Highwind**, 4 (Fahrzeug), 19 **Chocobo** (`world/world.cpp:47-58`). Die alte Highwind existiert, solange `insertedCD <= 2` (`:41-44`).
- **Snake (Midgar-Zolom)** hat eine eigene Grafik-/Animationsstruktur `world_snake_graphics_data` (`src/ff7.h:2797`) und eigene Positionsberechnung.

---

## 6. KAMPF

### 6.1 Animations-Skript — vollständige Opcode-Stelligkeitstabelle

`src/ff7/battle/animations.h:32-142` listet für die Opcodes **0x8E … 0xFF** die Argumentanzahl. Auszug der semantisch annotierten:

| Opcode | Args | Bedeutung (FFNx-Annotation) |
| --- | --- | --- |
| 0x90 | 3 | |
| 0x96 | 2 | effect60 (Barret-MG) |
| 0x97 | 2 | Gegner-Todesanimationen |
| 0x98 | 1 | Aktionstext anzeigen |
| 0x9D | 1 | Tifa-Limits |
| 0xA4/0xA5/0xE0/0xE6 | 0 | Zauber-Aura |
| 0xA8 | 2 | Actor zur Ruheposition bewegen |
| 0xAE/0xAF/0xB0/0xB1/0xE4/0xED | 0/1 | Ruhepositions-Logik |
| 0xB4 | 0 | Y-Rotation |
| 0xB9 | 1 | Kameradaten für Animation setzen |
| 0xBA | 2 | Ruhe-Y-Rotation |
| 0xBC | 1 | Idle-Kameraindex |
| 0xBD | 4 | Zum Ziel drehen |
| 0xC2 | 1 | Schaden anzeigen |
| 0xC4 | 3 | Ruhe-Y-Rotation (invertiert) |
| 0xC5/0xC6 | 0/1 | Wartebilder setzen |
| 0xCF/0xD0/0xD1/0xD4/0xD5/0xE9 | 8/3/5/3/8/3 | Bewegungseffekte |
| 0xE1/0xE2 | 0 | Modell erscheinen / verschwinden |
| 0xE3 | 0 | Actor positionieren |
| 0xF0 | 0 | Staubeffekt am Fuß |
| 0xF5 | 1 | Gegner initialisieren |
| 0xF6 | 0 | normale Gegner-Todesanimation |
| 0xF7 | 1 | Schadensanzeige verzögern |
| 0xF9 | 0 | Ausrichtung zurücksetzen |
| 0xFC | 0 | Ausrichtung für „alle Ziele" |
| 0xFD | 6 | Ruheposition setzen |
| 0xB2/0xC9/0xF2 | 0 | nop |
| 0x9E, 0xB3, 0xC1, 0xCA, 0xEB, 0xEC, 0xEE, 0xF3, 0xF4, 0xFE, 0xFF | 0xFF | variable/Sonderbehandlung |

**Skript-terminierende Opcodes** (`animations.h:144`): `0xA2, 0xA7, 0xA9, 0xB6, 0xF1`.

### 6.2 Kamera-Skripte

`src/ff7/battle/camera.cpp:39-40` — **zwei getrennte Skriptströme** je Kamera: *Position* und *Fokuspunkt*, mit **unterschiedlichen** Stelligkeitstabellen (`numArgsPositionOpCode` vs. `numArgsOpCode`) für 0xD5…0xFF.
- Terminierende Fokus-Opcodes: `0xF0, 0xF8, 0xF9, 0xFF`; terminierende Positions-Opcodes: `0xEF, 0xF0, 0xF7, 0xFF`.
- Skriptauswahl (`getCameraScriptPointer`, `:46-63`): Index **−1** = globale Standardskripte, **−2** = Skripte pro Formations-Kameraindex, **−3** = Sonderfall, sonst `(3·index + variationIndex)` in eine Offsettabelle ⇒ **drei Variationen pro Kameraskript**.
- Ablaufsteuerung (`simulateCameraScript`, `:65-120`): `0xF4` = Warten (dekrementiert `framesToWait`), `0xF5 n` = `framesToWait = n` (`0xF5 0xFF` ⇒ −1 = unendlich), `0xFE` gefolgt von **192** = Skript-Neustart (`currentPosition = 0`).
- FFNx-Kamerabegrenzungen für die freie Kamera: Zoom 5000…30000, Vertikalwinkel 5°…85° (`battle/camera.h:43-46`) — plausible Größenordnung des Kampfraums.
- `formation_camera { vector3<short> position; vector3<short> focal_point; }` (`src/ff7.h:809-812`) und `bcamera_position { point, current_position, frames_to_wait, … }` (`:814-821`).

### 6.3 Kampf-Strukturen

- **`battle_actor_vars`** (`src/ff7.h:700-756`) mit dokumentierten Offsets: `statusMask` (0x00), `stateFlags` (0x04), `index`, `level`, `elementDamageMask`, `characterID`, `physAtk`, `magAtk`, `pEvade`, `idleAnimScript` (0x10), `damageAnimID`, **`backDamageMult`** (0x12), **`sizeScale`** (0x13), `dexterity`, `luck`, `idleAnimHolder`, `lastCovered`, `lastTargets`, `prevAttackerMask`, `prevPhysAttackerMask`, `prevMagAttackerMask`, `defense` (0x20), `mDefense`, `formationID`, `absorbedElementsMask`, `currentMP`, `maxMP`, `currentHP`, `maxHP`, `initalStatusMasks`, `mEvade`, **`actorRow`**, **`cameraData`**, `gilStolen`, `itemStolen`, `missAnimScript`, `APValue`, `gilValue`, `expValue`.
- **`battle_ai_context`** (`:758-795`): Maskenregister für die KI-Skriptsprache — `activeActorMask, scriptOwnerMask, actionTargetMask, actorAlliesMask, activeAlliesMask, actorEnemiesMask, activeEnemiesMask, actorPartyMask, enemyActorsMask, allActorsMask, endBattleFlags, lastActionElements, battleFormationIdx, specialAttackFlags, partyGil` + `battle_actor_vars actor_vars[10]` ⇒ **max. 10 Akteure** (bis zu 6 Gegner + 3 Party + 1).
- **`battle_model_state`** (`:838-910`, ~0x1AEC Bytes) mit den Original-Adressen als Kommentar (`BE1178` ff.): `characterID`, `animScriptIndex`, `actionFlags`, `AnimationData`, `animScriptPtr`, `runningAnimIdx`, **`totalBones`**, **`height`**, `initialX/Y/ZRotation`, `animationEffect` (0x22), `commandID` (0x23), `isScriptExecuting` (0x3B), `currentScriptPosition` (0x3C), **`waitFrames` (0x3D)**, `modelEffectFlags` (0x3E), `modelRotation` (0x15E, `vector3<uint16_t>`), `modelPosition` (0x166, `vector3<short>`), `playedAnimFrames`, `currentPlayingFrame`, `tableRelativeModelAnimIdx`, `modelDataPtr`, `setForLimitBreaks` (0x1AC4).
- **`battle_anim_event`** (`:797-807`): `attackerID, activeAllies, spellEffectID, commandIndex, actionFlags, animationScriptID, actionIndex, cameraData, damageEventQueueIdx` — die Ereigniswarteschlange, die Animation, Kamera und Schadensanzeige koppelt.
- **`cmd_id`** (`:116-144`): vollständige Kommando-IDs, u. a. `0x01 ATTACK, 0x02 MAGIC, 0x03 SUMMON, 0x04 ITEM, 0x05 STEAL, 0x06 SENSE, 0x07 COIN, 0x08 THROW, 0x09 MORPH, 0x0A DEATHBLOW, 0x0B MANIPULATE, 0x0C MIME, 0x0D ENEMY_SKILL, 0x11 MUG, 0x12 CHANGE, 0x13 DEFEND, 0x14 LIMIT, 0x15 W_MAGIC, 0x16 W_SUMMON, 0x17 W_ITEM, 0x18 SLASH_ALL, 0x19 DOUBLE_CUT, 0x1A FLASH, 0x1B QUAD_CUT, 0x20 ENEMY_ACTION, 0x23 POISONTICK`.
- **`battle_text_data`** (`:1151-1157`): `buffer_idx, wait_frames, n_frames` — Kampftext ist framegetaktet.
- Effekt-Deskriptoren `effect100_data`/`effect60_data`/`effect10_data` (`:989-1039`) tragen alle ein `n_frames`-Feld an Offset 4.
- **Tiefenpuffer-Löschung mitten im Kampfframe** (`ff7::battle::battle_depth_clear`, `gl/deferred.cpp:654-658`) ⇒ Kampfszene und Modelle/Effekte liegen in getrennten Tiefenbereichen.

---

## 7. AUDIO

### 7.1 Musik (AKAO-Aufrufe)

`sound_operation(type, p1..p5)` ist die zentrale AKAO-Schnittstelle (`src/music.cpp:655-677`). Beobachtete Typen:

| Typ | Bedeutung |
| --- | --- |
| 0x10 | Musik abspielen |
| 0x14 | Musik abspielen (Kanal 2) |
| 0x18 | Musik mit Fade abspielen |
| 0x19 | Musik mit Fade abspielen (Kanal 2) |
| 0xDA | (in Highwind-Cid-Szene) faktisch „Musik stoppen" — FFNx leitet auf 0xF0 um (`:661-663`) |
| 0xF0 | Musik stoppen |

**Der Typ-Parameter wird vom Spiel nicht immer als 32-Bit-Wert gesetzt** — nur das niederwertigste Byte ist gültig (`:659`). *Konkreter Original-Bug, den `audio`/`interpreter` beachten müssen.*

- Musik-IDs: gültiger Bereich **1 … 0x62 (98)** (`:668`).
- **ID 13 = Main Theme**, wird immer fortgesetzt statt neu gestartet (`:328`).
- **ID 58 = OVER2 = Game-Over** (`:98`).
- **ID 7 = Kampfmusik auf der Weltkarte** (`:709`).
- **Nicht loopende Tracks (11 Stück)**: IDs **5 (FANFARE), 14 (TB), 22 (WALZ), 48 (CANNON), 57 (YADO), 89 (RO), 90 (JYRO), 92 (RIKU), 93 (SI), 94 (MOGU), 98 (ROLL)** (`src/music.cpp:106-118`). *Sehr konkret verwertbar für `audio`.*
- **Lautstärke-Übergang** (`ff7_volume_trans`, `:626-637`): Lautstärke 0…127; die Schrittzahl `steps & 0xFF` ergibt die Dauer als **`steps / 64` Sekunden**.
- **Tempo** (`set_midi_tempo`, `:639-653`): vorzeichenbehaftetes Byte, Geschwindigkeit = `tempo/128 + 1`, also 0.008× … 1.99×. `-128` würde 0 ergeben (Division/Absturz) — vom Original nie erzeugt, aber ein Grenzfall.
- Der vollständige **Track-Name → Titel**-Katalog steht in `docs/mods/audio_engine.md:27ff` (aseri, aseri2, ayasi, barret, bat, bee, …).

### 7.2 SFX (`src/sfx.cpp`)

| Parameter | Wertebereich / Umrechnung | Zitat |
| --- | --- | --- |
| Lautstärke | 0…127, linear (`v/127`) | `:111` |
| Panning | 0…127, **64 = Mitte**, sonst `p·2/127 − 1` | `:141` |
| Frequenz/Speed | vorzeichenbehaftetes Byte, `speed/128 + 1` | `:174` |
| Übergangszeit | Parameter `time` in **1/60 s** | `:129, 161, 185` |
| Master-Lautstärke | 0…100 | `:101` |

`ff7_field_sfx_state` (`src/ff7.h:2075-2097`) hält pro Kanal: `volume1/volume2`, `pan1/pan2`, `frequency`, `sound_id`, zwei DirectSound-Puffer, `is_looped`. **Zwei Werte je Lautstärke/Panning** ⇒ das Original führt Ist- und Zielwert für Übergänge.
Feld-SFX-Namensschema in FFNx: `<feldname>_<dreieck-id>_<sfx-id>` (`:198`) ⇒ **Umgebungs-SFX hängen am Walkmesh-Dreieck**.

### 7.3 Filme

- Original-FMVs laufen mit **15 fps** (`src/movies.cpp:79-86`: „Required by > 15 FPS movies", `movie_fps_ratio` skaliert Startframes).
- `movie_obj` (`src/ff7.h:1710ff`): `loop`, `is_playing`, `movie_end`, `global_movie_flag`, `field_1F8`.
- Das Spiel zeichnet **3D-Modelle über laufenden Filmen** (Feld-BGMOVIE): dann darf der native Movie-FPS-Limiter nicht greifen (`movies.cpp:108-109`, Flag `field_limit_fps`). `MOVIE_frame` im globalen Modul-Objekt (`src/ff7.h:2208`) ist der Skript-sichtbare Filmframe-Zähler.
- Farbraum: intern **YUV420P10**, Standardmatrix **BT601** (`src/video/movies.cpp:71-74`). Filme werden **vor** dem Überzeichnen in denselben Farbraum wie 2D/3D-Assets konvertiert, weil die Engine auf Filme zeichnet (`docs/color_modes.md:70`).

### 7.4 Farbe / Gamma (`docs/color_modes.md`)

Für eine Browser-Reimplementierung relevant:
- Die Original-Assets wurden auf **japanischen Trinitron-CRTs (NTSC-J)** abgestimmt: anderes Weißpunkt-/Primärfarben-Gamut und CRT-Gamma (BT.1886 Appendix 1), **nicht** sRGB (`color_modes.md:27-45`).
- FFNx' NTSC-J-Modus nutzt `crtBlackLevel = 0.0018`, `crtWhiteLevel = 1.5` (in 100 cd/m²) (`:52`).
- Wer sRGB direkt anzeigt, bekommt zu dunkle Schatten und **Banding im Sternenhimmel des Intros** (`:56`).
→ *Für WebMidgar: eine optionale NTSC-J→sRGB-Farbtransformation ist ein legitimes Feature; die Standardanzeige „roh als sRGB" weicht bewusst vom Original ab. Das sollte dokumentiert, nicht stillschweigend gemacht werden.*

---

## 8. DATEIEN / SPEICHERSTAND

- **LGP**: `lgp_toc_entry { char name[16]; uint32_t offset; WORD unknown1; WORD conflict; }` (`src/ff7.h:1299-1305`), plus `lookup_table_entry`, `conflict_entry`, `conflict_list`, `lgp_folders` (`:1307-1328`) — LGP hat also einen **Lookup-Table- und Konflikt-Mechanismus** für gleichnamige Dateien in verschiedenen „Ordnern".
- **`flevel.siz`**: enthält die unkomprimierten Größen aller Feldkarten; das Original liest genau **787** Einträge (Anzahl Feldkarten) (`field/field.cpp:131`). FFNx hebt auf 1200 an und addiert 4 MB Sicherheitsmarge. Der Schrittabstand in `field_map_infos` ist `0x34` DWords ab Offset `0xBC` (`:135, 142`).
- **`savemap`** (`src/ff7.h:1403-1463`, 0x10F4 Bytes): `checksum`; Vorschaublock (`preview_level`, `preview_portraits[3]`, `preview_char_name[16]`, HP/MaxHP/MP/MaxMP, `preview_gil`, `preview_seconds`, `preview_location[32]`); **vier Fensterecken-Farben** (ul/ur/ll/lr je RGB); `savemap_char chars[9]`; `party_members[3]`; `items[320]` (WORD); `materia[200]` (DWORD); `stolen_materia[48]`; `gil`; `seconds`; `countdown_timer`; `current_mode`; `current_location`; `x`, `y`, **`z_walkmeshtri`** (WORD, Feldposition + Walkmesh-Dreieck); `yuffie_reg_mask` (0xD73); `chocobo_slots_first[4]`; `vincent_reg_mask` (0xEF4); `chocobo_slots_last[2]`; `phs_lock`, `phs_visi`; `battle_speed`, `battle_msg_speed`, `config_bitmap_1/2`, `controller_mapping[16]`, `message_speed`.
- **`weapon_data`** (`:1465`), **`armor_data`** (`:1494`), **`party_member_data`** (`:1515`) sind ebenfalls ausmodelliert — relevant für `formats-kernel`.

---

## 9. DOKUMENTIERTE ORIGINAL-ENGINE-BUGS (Auswahl)

| Bug im Original | Beleg | Relevanz für WebMidgar |
| --- | --- | --- |
| Blend-Modi 2 und 3 sind über keine Textur-Page erreichbar | `field/field.cpp:107-112` | **Hoch** — WebMidgar kann von Anfang an alle 5 Modi anbieten; muss aber wissen, dass Original-Daten Modi 2/3 nur in Pages 15–20 nutzen |
| Feld `fr_e` (ID 347) rendert mit falschem Blend-Modus | `field/field.cpp:96`, `Changelog.md:78` | Hoch |
| Hintergrundanimation läuft im Menü weiter ⇒ `woa_*` desynchronisiert | `background.cpp:938-943`, `Changelog.md:79, 125` | **Hoch** (S39) |
| `FADE`-Opcode mit `type=2` färbt falsch | `Changelog.md:126` | Mittel (interpreter) |
| Direktfarb-Layer: Schwarz wird transparent statt opak | `ff7_opengl.cpp:321` | **Hoch** (S39) |
| Roter XIII: falsche Blinzel-Textur | `ff7_opengl.cpp:295-296` | Mittel |
| NPCs benutzen fälschlich Cloud-Augen (Index 9) | `field/model.cpp:414-416` | Niedrig |
| Augen-Texturindex hart bei 33 gedeckelt | `field/model.cpp:318` | Niedrig |
| Fehlende Polygone an Feld-3D-Modellen | `Changelog.md:91` | Mittel |
| Engine bricht bei > 16 hochauflösenden Feldmodellen (Texturglitches) | `Changelog.md:89` | Niedrig (nur Mods) |
| AKAO-`type`-Parameter nicht immer 32-Bit-sauber gesetzt | `music.cpp:659` | Mittel |
| Credits laufen zu schnell (39-fps-Sonderfall) | `misc.cpp:714-716`, `Changelog.md:127` | Niedrig |
| Scrolling stoppt einen Pixel zu früh am Kamerabereichsrand | `background.cpp:430-432` | Niedrig |
| Softlock in Feld 748 (Cloud klettert) durch überlappende Skripte | `field/model.cpp:107-115` | Mittel (interpreter-Race-Condition-Hinweis) |
| LGP-Dateien mit fehlerhaften Headern | `Changelog.md:199` | Mittel (`formats-lgp` sollte tolerant sein) |
| `scene.bin`-Chunk-Ladelogik nutzt falsche Chunk-ID | `Changelog.md:128` | Mittel (`formats-battle`) |
| Feld-Chunk-Größenberechnung für Chunk 9 falsch | `Changelog.md:191` | **Hoch** (`formats-field`) |

---

## 10. Top-Erkenntnisse für WebMidgar (gerankt, Paketen zugeordnet)

1. **Blend-Modus-Kodierung über Textur-Page-Index (0–14 opak, 15–23 additiv, 24–28 avg; Modi 2/3 fehlen im Original)** — `render-field`, `formats-field`. `field/field.cpp:78-116`, `background.cpp:116-119`. *Direkt umsetzbar; erklärt viele „falsch aussehende" Feld-Layer.*
2. **PSX-Blend-Modi 0–4 → exakte GPU-Gleichungen** (AVG / ADD / REV-SUB / 25%-ADD / opak) — `render-field`, `render-battle`, `render-world`. `renderer.cpp:1404-1423`.
3. **Hintergrundanimation = `background_sprite_layer[anim_group] & tile.anim_bitmask`, 64 Gruppen, gesetzt von BGON/BGOFF und `field_trigger`; muss am Skript-Tick hängen** — `render-field`, `field-runtime`, `interpreter`. `background.cpp:107-109`, `src/ff7.h:2218, 2356`. **Kern von S39.**
4. **Parallax-Formel Layer 3/4** inkl. Fixkomma-Skalen (Pos ÷16, Speed ÷256) und Wrapping gegen `bg{3,4}_width/height` — `render-field`. `background.cpp:885-896`, `src/ff7.h:2385-2396`. **Kern von S39.**
5. **Kameramatrix aus CAMDAT**: eye/target/up sind Basisvektoren in 1/4096-Fixkomma, `position` ist Translation — `render-field`, `formats-field`. `graphics.cpp:975-1023`, `src/ff7.h:2099-2118`.
6. **PSX-Projektion ohne Matrix**: `screen = v.xy · scale / v.z + delta`, Tiefenschlüssel `v.z · 0.25`, `delta` = Viewport-Offset — `render-field`, `walkmesh`. `field/utils.h:70-108`.
7. **Z-Konventionen der vier Ebenen** (L1 = 0.9997, L2 = pro Tile, L3/L4 = projizierte Skripttiefe, Fallback 0.9998) und **Tile-Sortierung nach Palette** — `render-field`. `background.cpp:70-201`.
8. **Original-Frameraten je Modus**: Feld/Welt 30, Kampf 15, Menü 60, Credits 39 — **alle Skript-Wartewerte sind Ticks dieser Rate** — `field-runtime`, `battle-runtime`, `world-runtime`, `interpreter`. `misc.cpp:672-758`.
9. **Sinus-Ease-in-out-Kurve** `a + (b−a)·(0.5 + sin(−π/2 + π·t)/2)` für „smooth" Rotation/Offset, plus linear — `field-runtime`. `field/utils.h:59-68`.
10. **`field_event_data`-Layout**: Position 1/4096-Fixkomma, getrennte `collision_radius`/`talk_radius`, `rotation_steps_type` 0–3, Offset-Bewegung mit `n_steps`/`step_idx` — `field-runtime`, `render-actor`. `src/ff7.h:2261-2321`. **Kern von S38.**
11. **Paletten-Alpha-Idiom 0xFE ⇒ `reference_alpha`; `color_key` 1 (PSX-Maskenbit) vs. 3 (Wert 0); `invert_alpha` außer 0x8000** — `formats-field`, `render-field`, `convert`. `common.cpp:1762-1864`, `ff7_opengl.cpp:321`.
12. **`field_trigger_header`-Layout** (Kamerabereich, Kamera-Bewegungstyp, Parallax-Parameter, 12 Gateways, 12 Trigger mit BG-Gruppe/Frame/Sound, 12 Pfeile) — `formats-field`, `field-runtime`. `src/ff7.h:2378-2402`.
13. **Kamerabereichs-Clipping ±160/±120 plus zwei Diagonal-Bewegungsmodi (`field_14[0]` = 0/1/2)** — `render-field`, `field-runtime`. `background.cpp:417-516`.
14. **Deferred Back-to-Front-Sortierung über diskrete Screen-Space-Z-Ebenen** (identisches Z = eine Ebene); Ausnahmen bei Blend ≠ NONE/AVG und Texturen ohne Alpha — `render-field`, `render-battle`. `gl/deferred.cpp:444-609, 783-846`.
15. **Kampf-Animations-Opcodes 0x8E–0xFF mit Stelligkeit + Terminierungsmenge** — `formats-battle`, `battle-runtime`, `render-battle`. `battle/animations.h:32-144`.
16. **Kampf-Kamera: zwei parallele Skriptströme (Position/Fokus) mit eigenen Stelligkeitstabellen, 3 Variationen je Skript, `0xF5 n` = warten, `0xFE 192` = Neustart** — `render-battle`, `battle-runtime`. `battle/camera.cpp:39-120`.
17. **`.a`-Animationsformat**: Version 1, `rotation_order[4]`, Frame = Root-Rotation + Root-Translation + `num_bones` × Euler-vec3f; kein Per-Bone-Translate; FPS steckt im Modellobjekt — `formats-model`, `render-actor`. `loaders.cpp:29-89`, `src/ff7.h:1189-1223, 1272-1296`.
18. **`model_modes`-Flags**: Root-Rotation/Translation pro Achse einzeln aktivierbar und negierbar — `render-actor`. `src/ff7.h:102-114`.
19. **Feldmodell-Beleuchtung: 1 Ambient + 3 gerichtete Lichter mit RGB und Richtung, gespeichert pro `field_object`; KAWAI-LIGHT (0x6) deaktiviert die globale Beleuchtung** — `render-actor`, `interpreter`. `src/ff7.h:631-652`, `field/field.cpp:245-248`.
20. **KAWAI-Subcodes 0x0 EYETX / 0x1 TRNSP / 0x2 AMBNT / 0x6 LIGHT / 0x7 / 0x8-0x9 / 0xD SHINE, Zustand persistent pro Modell** — `interpreter`, `render-actor`. `src/field.cpp:79-199`, `field/model.cpp:272-300`. **S38.**
21. **Weltkarten-Kugelkrümmung mit `rp = −250000`; keine Roll-Achse; ±30000 Clipping für 2D-Effekte; Nebel nur unter Wasser** — `render-world`, `world-runtime`. `world/renderer.cpp:75-160`.
22. **Weltkarten-Bewegung: `speed << 4` bei gesetztem Bit 6 von `animation_is_loop_mask`; `walkmap_type` im `world_event_data`** — `world-runtime`, `walkmesh`. `world/world.cpp:105-110`, `src/ff7.h:2421-2452`.
23. **Musik: IDs 1–98, 11 nicht loopende Tracks (Liste), ID 13 = Main Theme (fortsetzen), 58 = Game Over, 7 = Weltkarten-Kampf; Volume-Trans-Dauer = `steps/64` s; Tempo = `t/128 + 1`** — `audio`. `music.cpp:106-118, 328, 626-653, 709`.
24. **SFX-Konventionen: Volume/Pan 0–127 (Pan 64 = Mitte), Speed `s/128 + 1`, Übergangszeiten in 1/60 s, Feld-SFX an Walkmesh-Dreieck gekoppelt** — `audio`, `field-runtime`. `sfx.cpp:111-198`.
25. **Filme: 15 fps, Engine zeichnet 3D über laufenden Filmen, `MOVIE_frame` skriptsichtbar** — `render-field`, `interpreter`. `movies.cpp:79-121`, `src/ff7.h:2208`.
26. **Feld-Skript-Header: `0x0502`-Magic, `scale` als 9-Bit-Fixkomma für Bewegungs-/Sprechradien** — `formats-field`, `field-runtime`. `src/ff7.h:2223-2233`.
27. **Savemap-Layout** inkl. `z_walkmeshtri`, 4 Fensterecken-Farben, `materia[200]`, `stolen_materia[48]`, Yuffie-/Vincent-Register — `formats-save`. `src/ff7.h:1403-1463`.
28. **Tile-Quantisierung: Hintergrundpositionen auf 1/10 Pixel runden, sonst Nähte** — `render-field`. `background.cpp:39, 898-906`.
29. **Sichtbares Hintergrundfenster ist 352 × 256 (nicht 320 × 224); Modell-Culling-Fenster `[−40, +400] × [−120, +460]`** — `render-field`. `background.cpp:128-139`, `field/model.cpp:40-43`.
30. **LGP hat Lookup-Table + Konfliktauflösung für gleichnamige Dateien** — `formats-lgp`. `src/ff7.h:1299-1328`.

---

## 11. Offene Fragen

1. **`field_tile.field_38[4096]`** — 4 KB pro Tile ist enorm. Vermutlich ein Vertex-/Index-Cache oder eine Kopie der Tile-Pixel. Unbestätigt.
2. **`field_layer_sub_623C0F(rot_matrix, depth, 0, 0)`** — die genaue Abbildung von `field_AE`/`field_B0` auf einen Z-Wert im Bereich ~0.99 ist nicht offengelegt. Muss aus echten Daten rekonstruiert werden.
3. **`field_special_y_offset`** (`background.cpp:65-66, 99-100`) greift nur, wenn `bg_position.y <= 6` (Layer 1) bzw. `<= 8` (Layer 2) — Zweck unklar; sieht nach Sonderfall für bestimmte Felder aus.
4. **Layer-Typ 1 vs. Typ 2** (`field/field.cpp:90-102`): Typ 1 = palettiert, Typ 2 = Direktfarbe — aber die Page-Indexgrenzen unterscheiden sich (15/24 vs. 33/40). Warum Typ-2-Pages bis ≥ 40 gehen, obwohl die Schleife nur bis 28 läuft, ist unklar (evtl. nachträglich durch `field_convert_type2_layers` erzeugt).
5. **`palette_extra`** (`src/ff7.h:1051-1064`) mit `x_offset, y_offset, z_offset, z_offset_2, scroll_v, v_offset` wird im Kampf-Effektkontext benutzt — ob das auch **Palettenanimation** im Feld steuert, ist offen. `material_anim_ctx { materialRSD, negateColumnFlags, transparency, paletteIdx }` (`:1041-1049`) deutet auf **animierte Materialpaletten** hin.
6. **`texture_spt` / `page_spt` / `tex_page_list`** (`:1066-1102`) — SPT-Grafiken (Kampfeffekte?) mit `uScale`/`vScale` und bis zu 4 `game_drawable`. Format nicht weiter dokumentiert.
7. **`ff7_game_engine_data.do_not_transpose`** und `primary_color`/`secondary_color` (`:1143-1145`) — Zweck unklar.
8. **`field_object.anim_filenames[8880]`** — Slotgröße unbekannt (8880 / `num_animations`?). Prüfen an echten Daten.
9. **Battle-Encounter/ATB-Raten** sind in FFNx nicht explizit ausmodelliert (nur `battle_frame_multiplier`). Für `battle-runtime` bleibt die ATB-Formel offen.
10. **Walkmesh-Höheninterpolation** auf Feld und Weltkarte wird nirgends beschrieben; `world_get_player_walkmap_type` existiert, die Kollisionserkennung wurde von FFNx explizit **nicht gefunden** (`world/world.cpp:64` TODO).
11. **`field_trigger.behavior`** — die Bedeutung der Werte ist nicht dokumentiert.
12. **`control_direction`** im Trigger-Header: die genaue Umrechnung von Steuerkreuz-Richtung in Weltrichtung (Winkelquantisierung) fehlt.

---

## 12. Nächste Schritte für WebMidgar

- **S39**: Punkte 1–4, 7, 11, 28, 29 aus der Rangliste sind sofort in `render-field` prüfbar. Empfehlung: mit `tools/realdata-scan` verifizieren, ob `anim_group`/`anim_bitmask` in den Feld-Tile-Daten die vermutete Semantik haben, und ob Blend-Modi 2/3 tatsächlich nur in Pages 15–20 auftreten.
- **S38**: Punkte 10, 18, 19, 20 — `field_event_data`-Layout und KAWAI-Semantik gegen echte Skripte prüfen.
- **Dokumentieren**: dass WebMidgar bewusst **von FFNx' Fixes abweicht oder sie nachbaut** (z. B. Direktfarb-Schwarz, `woa_*`-Sync), gehört in ein ADR — inklusive des Hinweises, dass die *Existenz* des Bugs aus FFNx bekannt wurde, die *Lösung* aber eigenständig ist.
