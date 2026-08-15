# ff7tk — Reverse-Engineering Research Notes (for WebMidgar)

Source: <https://github.com/sithlord48/ff7tk>, shallow clone at
`…/scratchpad/repos/ff7tk`, HEAD `0118f5e` ("Complete Chinese translation …"), ~20 MB.
Author: Chris Rizzitello (`sithlord48`), plus substantial code from
Arzel Jérôme (`myst6re`, of Makou Reactor / Deling) in `src/formats` and `src/utils`.

---

## 0. LICENSE — CLEAN-ROOM WARNING (read first)

The repository is **REUSE-compliant** with per-file SPDX headers (`REUSE.toml`):

| Area | License |
|---|---|
| All C++ sources (`src/**`, `unittests/**`) | **LGPL-3.0-or-later** (`COPYING.TXT`, per-file `SPDX-License-Identifier`) |
| `.github/**` | MIT |
| `translations/**.ts` | CC0-1.0 |
| Icon sets (`src/icons/**`) | CC-BY-4.0 or LGPL-3.0-or-later, various third-party authors (Team Avalanche, Tangoish, Aavock) |
| `src/data/crypto/aes.c` | tiny-AES-c, separate upstream (check its own header) |

**Consequences for WebMidgar:**

1. **Do not copy any source code.** LGPL-3.0 is copyleft; even "just this one function"
   pulls obligations into our MIT/Apache-style tree. Everything below is a *description*
   of a data layout or an algorithm, with a citation so a developer can re-derive it.
2. **Do not copy the large data tables verbatim.** They are ff7tk's *expression* of
   game data. Flagged individually in §9. Almost all of them are transcriptions of data
   that ships inside the game's own files (`KERNEL.BIN`, field scripts, `WINDOW.BIN`),
   which WebMidgar already parses at runtime — that is the correct route, both legally
   and because it stays correct for modded installs.
3. Struct layouts / byte offsets / bitfield meanings are **facts about a file format**,
   not creative expression. Recording and re-implementing them is fine. The *doc comments*
   describing them are copyrightable, so paraphrase.
4. ff7tk itself **never parses KERNEL.BIN** — the only reference is a filename string in
   an ISO listing (`src/formats/IsoArchiveFF7.cpp:451`). All game data is hand-transcribed
   into headers. So ff7tk is a *cross-check oracle*, not a parsing reference.

---

## 1. Repository map

```
src/data/      Save-game model + all hardcoded game data tables   → formats-save, formats-kernel, menu
src/formats/   LGP, TEX, TIM, window.bin, .tbl, PSX ISO, Akao     → formats-lgp, render-field, audio, convert
src/utils/     LZS, GZIP, GZIP-PS, PsColor, PSF                   → convert, pipeline, render-*
src/widgets/   Qt Widgets editors (UI only)
src/ff7tkQuick/ QML front-end (UI only)
unittests/     Qt Test; FF7Save_test.h holds large binary fixtures
demos/, docs/  Widget/QML galleries, doxygen mainpage, build notes
```

Nothing here is a *runtime*: ff7tk is a save-editor library (it powers "Black Chocobo").
Its value to WebMidgar is concentrated in **save-file container formats + the 0x10F4
slot layout** and in a handful of asset-format parsers.

---

## 2. FF7 save slot — the core 0x10F4 structure

Citation for everything in this section: `src/data/FF7Save_Types.h:65-268` (struct `FF7SLOT`).
Slot size constant `0x10F4` = 4340 bytes, also exposed as `FF7SaveInfo::slotSize()`
(`src/data/FF7SaveInfo.h:266`). All multi-byte fields are **little-endian**.

### 2.1 Checksum

`FF7SLOT::generateChecksum` (`FF7Save_Types.h:87-109`), duplicated as
`FF7Save::ff7Checksum` (`src/data/FF7Save.cpp:596-613`):

- **CRC-16/CCITT-FALSE variant**: poly `0x1021`, init `0xFFFF`, MSB-first, final XOR `0xFFFF`, no reflection.
- Computed over slot bytes **`0x0004 .. 0x10F3`** (i.e. `slotData.mid(4)`, length `0x10F0`) —
  the checksum word itself and the 2 unknown bytes at `0x0002` are **excluded**.
- Result stored little-endian at slot offset `0x0000`.
- **Empty-slot sentinel: checksum == `0x4D1D`** (`FF7Save_Types.h:68`). That is the CRC of
  0x10F0 zero bytes; a slot is treated as empty if the checksum equals it *or* the whole
  slot is zeros (`:72`).
- Caveat: the implementation reads bytes into a signed `int` (`data.at(i)` returns `char`),
  so on platforms with signed `char` the `r ^= t << 8` step sign-extends. Reimplement with
  unsigned bytes and verify against a real save; ff7tk's own unit tests pass, which suggests
  the sign extension cancels out inside the 16-bit mask, but verify.

### 2.2 Slot field map (selected — the useful half)

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0x0000 | 2 | `checksum` | see §2.1 |
| 0x0002 | 2 | unknown | |
| 0x0004 | 0x44 | `FF7DESC desc` | preview block, see §2.3 |
| 0x0048 | 4×3 | `colors[4][3]` | window gradient corners, RGB bytes (UL, UR, LL, LR) |
| 0x0054 | 9×132 | `FF7CHAR chars[9]` | order Cloud, Barret, Tifa, Aeris, Red, Yuffie, CaitSith, Vincent, Cid |
| 0x04F8 | 3 | `party[3]` | party member ids (menu/PHS party) |
| 0x04FB | 1 | pad, always 0xFF | |
| 0x04FC | 320×2 | `items[320]` | packed item words, see §4 |
| 0x077C | 200×4 | `materias[200]` | party materia list |
| 0x0A9C | 48×4 | `stolen[48]` | materia stolen by Yuffie |
| 0x0B5C | 32 | unknown (usually 0xFF) | |
| 0x0B7C | 4 | `gil` | |
| 0x0B80 | 4 | `time` | total seconds played |
| 0x0B84 | 3 | `timer[3]` | countdown timer H, M, S |
| 0x0B94 | 2 | `mapid` | |
| 0x0B96 | 2 | `locationid` | |
| 0x0B9A | 7 | `FF7XYT coord` | `i16 x, i16 y, u16 t, u8 d` — field coords + triangle id + direction |
| 0x0BA4 | 2 | `mprogress` | main story progress variable |
| 0x0BA7 | 4 | `love` | i8 aeris, tifa, yuffie, barret |
| 0x0BBC | 2 | `battles` | battle counter |
| 0x0BBE | 2 | `runs` | escape counter |
| 0x0BC0 | 2 | `menu_visible` | bitfield, see §2.5 |
| 0x0BC2 | 2 | `menu_locked` | bitfield, see §2.5 |
| 0x0BD4 | 1 | `itemsmask_1` | field item pickup bits |
| 0x0BD5 | 1 | `materiacaves` | bit0 Mime, bit1 HP↔MP, bit2 Quadra Magic, bit3 KotR (`FF7Save.cpp:1499-1545`) |
| 0x0BE4 | 8 | `keyitems[8]` | 52 key items, bit `n` = byte `n/8`, mask `1<<(n%8)` (`FF7Save.cpp:3047-3067`) |
| 0x0BF4 | 4 | `b_love` | battle love points, same layout as `love` |
| 0x0BF9 | 4 | `pennedchocos[4]` | chocobos in the fenced area, by rating |
| 0x0BFF | 3 | `u_weapon_hp[3]` | Ultimate Weapon remaining HP (24-bit) |
| 0x0C02 | 1 | `seenpandora` | bit0 = seen Pandora's Box |
| 0x0C1E | 1 | `tut_sub` | 0x04 sub tutorial seen, 0x40 battle-target labels |
| 0x0C1F | 1 | `ruby_emerald` | 0x05 both alive, 0x0D Emerald only, 0x1D neither |
| 0x0C22 | 1 | `world_map_chocobos` | visible chocobos bitfield |
| 0x0C23 | 1 | `world_map_vehicles` | 0x01 buggy, 0x04 Tiny Bronco, 0x10 Highwind (combinable) |
| 0x0C4A/0x0C4B | 1+1 | `condorlosses` / `condorwins` | |
| 0x0C58 | 2 | `condorfunds` | |
| 0x0C85/0x0C86 | 1+1 | `bm_progress1` / `bm_progress2` | bombing-mission flags |
| 0x0CAD | 3 | `f_party[3]` | party members present on the **field** (distinct from `party`) |
| 0x0CB4 | 1 | `aeris_church` | |
| 0x0CE6 | 1 | `bm_progress3` | |
| 0x0CEE | 2 | `gp` | Gold Saucer GP, 0..10000 |
| 0x0CF4 | 2 | `battlepoints` | Battle Square BP |
| 0x0CFC..0x0D00 | 5 | `stables`, `stablesoccupied`, pad, `chocobomask`, `chocomated` | |
| 0x0D29 | 1 | `yuffieforest` | bit1 → Yuffie encounter possible |
| 0x0D46 | 1 | `donprogress` | 0..3 |
| 0x0D66 | 1 | `turtleflyers` | Turtle's Paradise flyer bits |
| 0x0D73 | 1 | `reg_yuffie` | 0x6F = Yuffie in party roster, 0x6E = not |
| 0x0D83 | 1 | `midgartrainflags` | |
| 0x0DC4 | 4×16 | `chocobos[4]` | see §5 |
| 0x0E11 | 2 | `BikeHighScore` | |
| 0x0E14/0x0E16/0x0E1C | 4 each | Snowboard best times | ms, 3 bytes used, byte[0] unused (offsets in the header look inconsistent — see Open Questions) |
| 0x0E20..0x0E22 | 3 | Snowboard high scores (Beg/Exp/Crazy) | |
| 0x0E24/0x0E26/0x0E39 | 2 each | Chocobo-race ("coster") 2nd, 3rd, 1st best | |
| 0x0E3C | 1 | `battleArenaSpecialWins` | |
| 0x0E3E | 6 | `stablechocorating[6]` | Choco Billy's ratings |
| 0x0E5C..0x0E62 | 8 | crater portable save point: map id, X, Y, Z (i16 each) | |
| 0x0EA4 | 1 | `disc` | current CD |
| 0x0EA6 | 1 | `intbombing` | 0x14 at start of bombing mission, 0x56 at first save |
| 0x0EAA | 2 | `steps` | Great Glacier step counter (pass out at 544) |
| 0x0EC2 | 1 | `field_help` | field hand cursor on/off |
| 0x0EC4 | 6×6 | `chocobonames[6][6]` | FF7-encoded, 6 bytes each |
| 0x0EE8 | 6×2 | `chocostaminas[6]` | |
| 0x0EF4 | 1 | `reg_vinny` | 0xFF = Vincent recruited, 0xFB = not |
| 0x0F0C | 24 | `location[24]` | location name string, FF7 encoding |
| 0x0F29 | 1 | `tut_save` | 0x3A seen, 0x32 not |
| 0x0F38 | 1 | `wonsubgame` | ==1 → sub minigame won (`FF7Save.cpp:5548`) |
| 0x0F5C | 2×4 | `l_world`, `l_world2` | party leader world-map coords, see §2.4 |
| 0x0F64 | 2×4 | `wc_world*` | caught wild chocobo |
| 0x0F6C | 2×4 | `tc_world*` | Tiny Bronco / chocobo |
| 0x0F74 | 2×4 | `bh_world*` | Buggy / Highwind |
| 0x0F7C | 2×4 | `sub_world*` | submarine |
| 0x0F84 | 2×4 | `durw_world*` | Diamond / Ultimate / Ruby Weapon |
| 0x0F8C..0x0F96 | 12 | snow poles 1..3, X/Y u16 each | |
| 0x1084 | 2×16 | `choco56[2]` | chocobo slots 5 and 6 (not contiguous with the first four!) |
| 0x10A4 | 2 | `phsallowed` | bit `n` = character `n` may be swapped in |
| 0x10A6 | 2 | `phsvisible` | bit `n` = character `n` shown in PHS |
| 0x10D8 | 1 | `battlespeed` | 0..255 |
| 0x10D9 | 1 | `battlemspeed` | battle message speed |
| 0x10DA | 2 | `options` | bitfield, see §2.5 |
| 0x10DC | 16 | `controller_map[16]` | PSX only; index = action, value = button |
| 0x10EC | 1 | `fieldmspeed` | field message speed |

Roughly 1/6 of the slot is still marked `UNKNOWN` in ff7tk (`z_1` … `z_48`); the
`unknown(s, z)` / `setUnknown(s, z, …)` API (`FF7Save.cpp:3078`, `:3138`) exposes those
gaps by index, which is a convenient way to enumerate what is *not* yet mapped.

### 2.3 `FF7DESC` — 68-byte preview block (`FF7Save_Types.h:36-48`)

| Offset (rel.) | Size | Field |
|---|---|---|
| 0x00 | 1 | lead character level |
| 0x01 | 3 | party ids |
| 0x04 | 16 | lead character name (FF7 encoding) |
| 0x14 | 2 | cur HP |
| 0x16 | 2 | max HP |
| 0x18 | 2 | cur MP |
| 0x1A | 2 | max MP |
| 0x1C | 4 | gil |
| 0x20 | 4 | seconds played |
| 0x24 | 32 | save location string (FF7 encoding) |

Note the name field here is **16 bytes**, while `FF7CHAR.name` is **12 bytes**.

### 2.4 World-map coordinate packing (`FF7Save.cpp:4655-4688`)

Each vehicle/actor gets two `u32` words:

- word 1: `X = bits 0..18` (19 bits, mask `0x7FFFF`), `mapID = bits 19..23` (mask `0x1F`), `angle = bits 24..31`
- word 2: `Y = bits 0..17` (18 bits, mask `0x3FFFF`), `Z = bits 18..31`

Identical packing for leader, wild chocobo, Tiny Bronco, Buggy/Highwind, submarine and the
Weapons (the setter families at `:4707`, `:4828`, `:4949`, `:5070`, `:5193`, `:5316`).
X is clamped to 295000 in the setter — a plausible world-map extent hint.

### 2.5 Bitfields

**`options` (u16 @0x10DA)** — `FF7Save.cpp:3583-3760`:

| Bit(s) | Meaning |
|---|---|
| 0 | sound: 0 mono / 1 stereo |
| 2 | controller: 0 normal / 1 custom |
| 4 | cursor: 0 initial / 1 memory |
| 6, 7 | ATB: 00 Active, 01(bit6) Recommended, 10(bit7) Wait |
| 8 | camera: 0 auto / 1 fixed |
| 10, 11, 12 | magic order, 6 permutations R/A/I (see enum `MAGICORDER`) |
| 14 | battle help on/off |

Magic-order decode is order-sensitive (`:3716-3729`): bits {10,11}→3, {10,12}→5,
{10}→1, {11}→2, {12}→4, none→0.

**`menu_visible` / `menu_locked` (u16 @0x0BC0 / @0x0BC2)** — bit index = `MENUITEMS` enum
order: Item, Magic, Materia, Equipment, Status, Form(ation), Limit, Config, PHS, Save
(`FF7Save.h` enum `MENUITEMS`; accessors `FF7Save.cpp:3975-4038`).

**`phsallowed` / `phsvisible` (u16 @0x10A4 / @0x10A6)** — bit `n` = character index 0..8
(`FF7Save.cpp:3898-3963`).

**`keyitems[8]` @0x0BE4** — 52 key items, ids 0..51, `byte = id/8`, `mask = 1<<(id%8)`.
The `KEYITEMS` enum in `FF7Save.h` gives the full id→name mapping (dresses/wigs/tiaras
first, then pharmacy coupons, huge materia, letters, keycards, PHS, Black Materia, Mythril,
Snowboard = 50).

**Field/progress flags in general** — see §7.

### 2.6 `FF7CHAR` — 132 bytes (`src/data/Type_FF7CHAR.h:16-56`)

| Off | Size | Field | Off | Size | Field |
|---|---|---|---|---|---|
| 0x00 | 1 | id (0xFF = empty) | 0x21 | 1 | tnlFlag (TNL bar 0..255) |
| 0x01 | 1 | level | 0x22 | 2 | `limits` (learned limit bitfield) |
| 0x02..0x07 | 6 | str, vit, mag, spi, dex, luck | 0x24 | 2 | kills |
| 0x08..0x0D | 6 | same six *bonus* values (sources) | 0x26/0x28/0x2A | 2 each | times used limit 1-1 / 2-1 / 3-1 |
| 0x0E | 1 | limitlevel (1..4) | 0x2C | 2 | curHP |
| 0x0F | 1 | limitbar (0xFF = limit ready) | 0x2E | 2 | baseHP |
| 0x10 | 12 | name (FF7 encoding) | 0x30 | 2 | curMP |
| 0x1C | 1 | weapon | 0x32 | 2 | baseMP |
| 0x1D | 1 | armor | 0x34 | 4 | unknown |
| 0x1E | 1 | accessory | 0x38 | 2 | maxHP (base + equip + materia) |
| 0x1F | 1 | statusFlag: 0x00 normal, 0x10 Sadness, 0x20 Fury | 0x3A | 2 | maxMP |
| 0x20 | 1 | rowFlag (front/back) | 0x3C | 4 | exp |
| | | | 0x40 | 64 | `materia[16]` — slots 0..7 weapon, 8..15 armor |
| | | | 0x80 | 4 | expNext |

`rowFlag` is documented inconsistently: `Type_FF7CHAR.h:39` says 0x00 back / 0x01 front,
while `FF7Char.h` enum `CharacterRow` says 0xFE back / 0xFF front. Verify against a real save.

`limits` bit layout is **sparse**: the 7 limit list rows map to bits `{0,1,3,4,6,7,9}`
(`FF7Char.cpp:121-125`, table `_limitbitarray` at `FF7Char.h:453`). That encodes
"2 limits per level for levels 1–3, 1 for level 4", with Cait Sith and Vincent using only
the even rows.

### 2.7 `materia` — 4 bytes (`src/data/Type_materia.h:24-28`)

`u8 id; u8 ap[3];` — AP is a **24-bit little-endian** value:
`ap = ap[0] | ap[1]<<8 | ap[2]<<16` (`FF7Materia.h:327`).
Empty materia = `id 0xFF`, `ap = FF FF FF` (`FF7Materia.h:295-315`).
`MaxMateriaAp = 0xFFFFFF` and mastered materia is stored with that value (`FF7Materia.h:37`).

---

## 3. Save file *containers* (the genuinely reusable part)

All constants from `src/data/FF7SaveInfo.h:266-381`; dispatch logic in `FF7SaveInfo.cpp:25-200`.

| Format | Enum | File size | File header | Slot hdr | Slot ftr | Slots | Magic / id |
|---|---|---|---|---|---|---|---|
| PC | `PC` | 0xFE55 | 0x09 | 0 | 0 | 15 | `71 73 27 06`, name `save0[0-9].ff7` |
| Switch | `SWITCH` | 0xFE55 | 0x09 | 0 | 0 | 15 | same magic, name `ff7slot0[0-9]` |
| PSX single save | `PSX` | 0x2000 | 0 | 0x0200 | 0x0D0C | 1 | `53 43 11 01 …` ("SC" + Shift-JIS "ＦＦ７/ＳＡ") |
| PSV (PS3) | `PS3` | 0x2084 | 0x0084 | 0x0200 | 0x0D0C | 1 | `00 56 53 50` ("\0VSP") |
| VMC (raw memcard) | `VMC` | 0x20000 | 0x2000 | 0x0200 | 0x0D0C | 15 | `4D 43` ("MC") @0x0000 |
| PSP/PSVita VMP | `PSP` | 0x20080 | 0x2080 | 0x0200 | 0x0D0C | 15 | `00 50 4D 56 80`, MC header @0x0080 |
| VGS | `VGS` | 0x20040 | 0x2040 | 0x0200 | 0x0D0C | 15 | `56 67 73 4D` ("VgsM"), MC header @0x0040 |
| DEX Drive `.gme` | `DEX` | 0x20F40 | 0x2F40 | 0x0200 | 0x0D0C | 15 | `"123-456-STD\0…"`, MC header @0x0F40 |
| PSXGameEdit `.mcs`/`.ps1` | `PGE` | 0x2080 | 0x0080 | 0x0200 | 0x0D0C | 1 | name @0x000A |
| GS/Caetla/Dantel `.mcb/.mcx/.psx/.pda` | `PDA` | 0x2036 | 0x0036 | 0x0200 | 0x0D0C | 1 | name @0x0000 |

`0x0200 + 0x10F4 + 0x0D0C = 0x2000` — a PSX block is header + FF7 slot + zero padding.
The PC file is `0x09 + 15 × 0x10F4 = 0xFE55` exactly: **no per-slot header/footer at all.**

### 3.1 Format detection (`FF7Save.cpp:35-77`)

Size + magic, then disambiguation:
PC vs Switch is decided **by filename** (`*.ff7` vs `ff7slot*`) since both have identical
size and magic. PSV additionally checks a type byte at `0x0038`: `0x14` = PS1 save,
`0x2C` = PS2 (rejected). Fall-through: `size % 0x2000 == 0` → raw PSX; `(size - 0x80) %
0x2000 == 0` → PGE; `(size - 0x36) % 0x2000 == 0` → PDA.

### 3.2 PC file header (9 bytes) (`FF7Save.cpp:664-688`)

- `0x00..0x03`: magic `71 73 27 06`
- `0x04`: currently selected slot — encoded oddly: slot0→0x00, slot1→0x01,
  slot s≥2 → `16*(s-2) + 2` (so slot2→0x02, slot3→0x12, … slot14→0xC2)
- `0x05`: bitmask, bit `i` set if slot `i` (0..7) contains an FF7 save
- `0x06`: bitmask, bit `i-8` set for slots 8..14
- `0x07..0x08`: zero

### 3.3 PSX memory-card directory (VMC/PSP/VGS/DEX)

Directory frame for block `s` lives at `vmcHeaderOffset + 128 + 128*s`
(`FF7Save.cpp:908-1021`). Within the frame:

| Rel. off | Meaning |
|---|---|
| 0x00 | block type (`PSXBLOCKTYPE`: 0xA0 empty, 0x51 in-use, 0xA1 deleted, 0x52 mid-link, 0xA2 deleted mid-link, 0x53 end-link, 0xA3 deleted end-link) |
| 0x04..0x06 | save size in bytes, 24-bit LE (block count = size / 0x2000) |
| 0x08 | next-block index for linked saves |
| 0x0A | save name / product code, 20 chars ASCII (loaded at `128*i + 138` in `loadFile`, i.e. rel. 0x0A) |
| 0x7F | XOR checksum of bytes 0x00..0x7E of the frame |

The card header frame at offset 0 gets the same XOR byte at 0x7F, with `"MC"` at 0x00
(`FF7Save.cpp:790-836`). DEX additionally mirrors block types at file offset 0x16+i and
next-links at 0x26+i (`:827-832`).

### 3.4 PSX slot header (0x200 bytes)

- `0x00..0x01`: `"SC"`
- `0x02`: icon descriptor — `0x11` = 1 frame, `0x12` = 2, `0x13` = 3 (`FF7Save.cpp:1262-1279`)
- `0x04..0x43`: 64-byte **Shift-JIS** description string, e.g. `ＦＦ７／ＳＡＶＥ１５／９９：２８`
  (`FF7Save.cpp:1023-1044`; test expectation at `unittests/data/FF7Save_test.cpp:105`)
- `0x1B/0x1D`: hours played digits, `0x21/0x23`: minutes digits — stored as
  Shift-JIS fullwidth digits, computed as `digit + 0x4F`; hours > 99 are written as `0x58`
  (fullwidth "Ｘ") (`FF7Save.cpp:690-704`)
- `0x60` (96), 160 bytes: icon frame 1 — 16-colour palette (16 × `u16` PS colour) followed by
  4bpp pixel data; frames 2 and 3 at 0x100 (128 B) and 0x180 (128 B), pixels only
  (`FF7Save.cpp:1262-1279`, decode in `src/data/SaveIcon.cpp:70+`)

### 3.5 Region / edition detection

There is **no region byte in the save data**. The region is carried entirely by the
PSX save *name* (`FF7Save.cpp:858-888`, `1067-1101`):

| Region | Product code | Save name pattern |
|---|---|---|
| NTSC-U (USA) | BASCUS-94163 | `BASCUS-94163FF7-Snn` |
| PAL-E (UK) | BESCES-00867 | |
| PAL-FR | BESCES-00868 | |
| PAL-DE | BESCES-00869 | |
| PAL-ES | BESCES-00900 | |
| NTSC-J | BISLPS-00700 | |
| NTSC-J International | BISLPS-01057 | |

`nn` = save number 01..15. `isJPN()` = code 00700 or 01057 and switches the **text codec
to the Japanese tables**. PC/Switch saves have no name, so ff7tk synthesises
`BASCUS-94163FF7-Snn` (`FF7Save.cpp:102-108`).

**Region-specific behaviour worth carrying over:** on `SLPS-00700` (JP original), an item
quantity > 99 corrupts all items in battle; ff7tk clamps to 99 on write
(`FF7Save.cpp:615-662`). Region also decides the default character names
(`FF7Save.cpp:1151-1168`).

### 3.6 PSV / VMP signing (`FF7Save.cpp:2750-2799`)

PSV (PS3) and VMP (PSP) carry an HMAC-like signature. Constants
(`FF7SaveInfo.h:317-349`): PS3 seed @0x0008, signature @0x001C; PSP seed @0x000C,
signature @0x0020; signature size 0x14 (SHA-1); AES-128 key and IV are 16-byte literals.

Algorithm (described, not copied):
1. Read the 0x14-byte key seed from the header.
2. `AES-ECB-decrypt` the first 16 bytes of the seed with the fixed key → first half of a
   0x40-byte work buffer; `AES-ECB-encrypt` the same 16 bytes → second half.
3. XOR the 0x20-byte buffer with the fixed IV.
4. Build a 0x14 scratch filled with 0xFF whose first 4 bytes are seed bytes 0x10..0x13;
   XOR the buffer's second half with it.
5. Truncate the buffer to 0x14, zero-pad back to 0x40 → this is the "key".
6. Inner: XOR key with 0x36 over 0x40 bytes, `SHA1(key ⊕ 0x36 ‖ fileData)`.
7. Outer: XOR key with 0x6A (note: **0x6A, not the usual HMAC 0x5C** — because it is
   applied to the already-0x36-XORed buffer, `0x36 ^ 0x5C = 0x6A`), `SHA1(that ‖ innerHash)`.
   → classic HMAC-SHA1 with a derived key.
The data fed in has the signature field zeroed first (`:761`, `:780`).
Test vectors exist at `unittests/data/FF7Save_test.cpp:42` and `:56` — useful for a
WebMidgar implementation to self-check without shipping ff7tk code.

---

## 4. Item encoding (`src/data/FF7Item.cpp:137-160`)

A save item slot is a **little-endian u16**:

- `id   = word & 0x01FF`  (9 bits)
- `qty  = (word & 0xFE00) >> 9`  (7 bits, so 0..127)
- Empty slot: id `0x1FF` (`FF7Item::EmptyItem`); a fully empty word is `0xFFFF`.

Item id space (`FF7Item.h` enum `ItemId`): consumables 0x00–0x7F, weapons 0x80–0x1FF-ish
grouped per character (Cloud 0x80.., Tifa 0x90.., Barret 0xA0.., Aerith 0xB0/0xBE..,
Cid 0xC9.., Yuffie 0xD7.., Cait Sith 0xE5.., Vincent 0xF2..), armor 0x100–0x11F,
accessories 0x120–0x13F.

Item metadata struct `ITEM` (`FF7Item.h:595-660`) is essentially a decoded **kernel.bin
item/weapon/armor record**: name, description, type, materia growth rate, materia slot
count, link count, ±HP/MP/STR/VIT/DEX/LCK/MAG/SPI, 14 elemental affinity fields and
24 status fields. Encoding conventions:

- elements: `-3` absorb, `-2` nullify, `-1` halve, `0` none, `+1` damage
- statuses: `-2` protect, `-1` remove, `0` none, `+1` inflict, `+2` self-cast on battle start
- element order: Restoration, Fire, Cold, Lightning, Earth, Wind, Water, Gravity, Holy,
  Poison, Cut, Shoot, Punch, Hit
- status order: Death, Slow-Numb, D.Sentence, Paralysis, Petrify, Silence, Sleep, Confusion,
  Berserk, Frog, Mini, Poison, Fury, Sadness, Darkness, Haste, Slow, Stop, Barrier,
  M.Barrier, Reflect, Shield, Regen, Resist

**This is exactly the kernel.bin item record semantics** — a good cross-check for
`formats-kernel`, but the table itself must come from kernel.bin at runtime.

Weapon ranges per character are also encoded in `FF7Char.h` as
`(starting_weapon_id, num_weapons, weapon_offset)` triples, e.g. Cloud `(128, 16, 0)`,
Barret `(160, 16, 32)`, Tifa `(144, 16, 16)`, Aerith `(190, 11, 62)`, Red `(176, 14, 48)`,
Cid `(201, 14, 73)`, Yuffie `(215, 14, 87)`, Cait Sith `(229, 13, 101)`,
Vincent `(242, 13, 114)`, Sephiroth `(255, 1, 127)`. The `weapon_offset` is an index into
a flattened weapon list — useful for mapping kernel weapon records to characters.

---

## 5. Materia and chocobo

### 5.1 Materia (`src/data/FF7Materia.h`)

- `TotalMateria = 90` distinct materia (`:32`); id range 0x00–0x5A plus `EmptyId = 0xFF`.
- Types (`:42-50`): 0 unknown/all, 1 Magic, 2 Summon, 3 Independent, 4 Support, 5 Command.
- Id groupings (enum `MateriaName`, `:55-69`): 0x00–0x0F stat/independent (MP+, HP+,
  Speed+, Magic+, Luck+, EXP+, Gil+, Enemy Away…), 0x10–0x2F support/command
  (Cover 0x10, Underwater 0x11, HP↔MP 0x12, W-Magic 0x13, W-Summon 0x14, W-Item 0x15,
  All 0x17, Counter 0x18, Final Attack 0x20, Added Cut 0x21, Steal-as-well 0x22,
  Quadra Magic 0x23, Steal 0x24, Sense 0x25, Throw 0x27, Morph 0x28…),
  0x30–0x49 magic (Master Command 0x30, Fire 0x31 … Master Magic 0x49),
  0x4A–0x5A summons (… Leviathan 0x50, Bahamut 0x51, Kujata 0x52, Alexander 0x53,
  Phoenix 0x54, Neo Bahamut 0x55, Hades 0x56, Typhoon 0x57 …).
- Per-materia record `MATERIA` (`:421-448`): name, skill list, stat string, icon paths,
  id, ±hp/mp/str/vit/dex/lck/mag/spi, **`QList<qint32> ap` = cumulative AP needed per star**,
  type, `levels` (star count), elemental string, status list.
- Level from AP (`:195-212`): count how many entries of the AP list the current AP
  reaches — i.e. `level = Σ_{i<levels} [ap ≥ apForLevel(i)]`. **Enemy Skill is special:
  its "level" is the raw AP value** (`:200`), because AP there is a learned-skill bitfield.
- AP to master = last AP entry (`:221`); mastered materia stores `0xFFFFFF`.

### 5.2 Chocobo (`src/data/Type_FF7CHOCOBO.h`, 16 bytes)

| Off | Size | Field |
|---|---|---|
| 0x00 | 2 | sprint speed |
| 0x02 | 2 | max sprint speed |
| 0x04 | 2 | speed |
| 0x06 | 2 | max speed |
| 0x08 | 1 | acceleration |
| 0x09 | 1 | cooperation |
| 0x0A | 1 | intelligence |
| 0x0B | 1 | personality (range unknown) |
| 0x0C | 1 | "pcount" (unknown) |
| 0x0D | 1 | races won |
| 0x0E | 1 | sex (0 male, 1 female) |
| 0x0F | 1 | type (Yellow, Green, Blue, Black, Gold) |

Note the doc-comment swap in the header: fields 0 and 2 are labelled "Speed"/"Sprint speed"
in the comments but named `sprintspd`/`speed`. Trust the names/accessors
(`FF7Save.cpp:2239-2298`), not the comments — or better, verify empirically.

Chocobos 1–4 live at 0x0DC4, chocobos 5–6 at **0x1084** (non-contiguous).
Stable bookkeeping: `stables` (owned), `stablesoccupied`, `chocobomask` (occupancy bits),
`chocomated` (which stalls cannot mate) at 0x0CFC..0x0D00; ratings at 0x0E3E (stalls) and
0x0BF9 (penned).

---

## 6. FF7 text encoding (`src/data/FF7Text.cpp`, tables in `FF7Text.h:60-222`)

Seven code tables: `eng` (256), `jap` (256), and five JP extension tables
`jap_fa/fb/fc/fd/fe`.

Decoding rules (`toPC`, `FF7Text.cpp:42-115`):

- `0xFF` = **end of string** (terminator).
- `0xFE` = escape prefix:
  - `FE DD nn` → `{PAUSEnnn}`, `nn` frames
  - `FE E2 aa bb cc 00` → memory/variable reference; `bb` selects a bank pair
    (0→bank 1/2, 1→3/4, 2→11/12, 3→13/14, 4→7/15), `aa` = address, `cc` = size in bytes
  - otherwise → extension table 6 (only for byte ≥ 0xD2 in the western encoding)
- In Japanese mode, `0xFA`–`0xFD` are prefixes selecting extension tables 2–5.
- Western table: index 0x00–0x5F maps to **ASCII 0x20–0x7F** (`char = index + 0x20`),
  0x60–0xCF is a Mac-Roman-like accented/symbol block, 0xD0+ are control/special tokens:
  `{CHOICE}`, TAB, `", "`, `.\"`, `…\"`, newline, `{NEW PAGE}`, `{NEW PAGE 2}`, then the
  character-name tokens `{CLOUD} {BARRET} {TIFA} {AERITH} {RED XIII} {YUFFIE} {CAIT SITH}
  {VINCENT} {CID} {MEMBER 1} {MEMBER 2} {MEMBER 3}`, then button glyphs
  `{CIRCLE} {TRIANGLE} {SQUARE} {CROSS}`.

The western table is a small, mechanically derivable mapping — but it is still 256 entries
of ff7tk's transcription. The *authoritative* source is the game's own `WINDOW.BIN` font
plus the community FF7 charset; prefer regenerating from those.

---

## 7. Field/progress flags — the `FF7FieldItemList` scheme

`src/data/FF7FieldItemList.h` encodes **377 field pickups** as records
(`struct FieldItem`, `:16-21`):

```
Offset : list<u16>   // byte offsets into the 0x10F4 slot
Bit    : list<u8>    // bit index, paired positionally with Offset
Maps   : list<QString>  // field map filenames where the item appears
Text   : QString     // item description
```

Examples (`:79-87`): `{0x0BC8, bit 0, map "mds7st1", "Hi-Potion"}`,
`{0x0BC8, bit 1, "mds7st1", "Echo Screen"}`, `{0x0BC8, bit 2, "mds7st2", "Potion"}`.

Some entries carry **multiple offset/bit pairs** — one logical pickup that must set several
save flags at once (typically the same event flagged from different map variants).

**88 distinct byte offsets** are used, spread across the "unknown" regions of the slot:
0x0BC8–0x0BEA (early Midgar block, overlapping `itemsmask_1`/`keyitems`), 0x0C24–0x0C8C,
0x0CBD–0x0CF3, 0x0D44–0x0D93, 0x0E2E–0x0EA5, 0x0F05, 0x0FA4–0x0FC5, and beyond.

This is the single most valuable *derived* knowledge in ff7tk that WebMidgar cannot get
from a format spec: it maps **field script save-map bits to concrete game events**. But it
is also a large hand-curated table (see §9) — the right move is to derive our own from the
field scripts (`flevel.lgp` → `SETBYTE`/`BITON` opcodes writing the savemap) and use ff7tk
only to *spot-check* a handful of entries.

---

## 8. Asset formats (`src/formats`, `src/utils`) — mostly myst6re code

| Class | Format | Notes |
|---|---|---|
| `Lgp` | LGP archive | header: 12-byte company name, `i32` file count, then `count × 27`-byte TOC entries: `char name[20]`, `u32 filePos` @+20, `u8` unknown @+24, `u16 conflict` @+25. Product name = **last 14 bytes of the file** ("FINAL FANTASY7"). If any conflict != 0, a lookup table of `30×30 × 4` bytes follows the TOC (entries: `u16 tocOffset, u16 fileCount`), then `u16 conflictCount` and per-conflict `u16 entryCount` + `entryCount × 130`-byte records. Cites: `Lgp.cpp:295-500`, `Lgp_p.h:17-54`. |
| `LgpToc::lookupValue` | LGP hash | `v = f(c0) * 30 + (c1 == '.' ? 0 : f(c1) + 1)` where `f` maps `'0'-'9'`→0..9, `'_'`→10, `'-'`→11, else `c - 'a'` (valid 0..29 for `a`..`~`); filename is lowercased, path taken after the last `/`. `Lgp_p.cpp:388-429`. |
| `LZS` | FF7 LZSS | Okumura LZSS: 4096-byte ring buffer initialised to 0, **initial write position 4078 (0xFEE)**, 8-flag control byte (LSB first, 1 = literal), match encoded as 2 bytes → 12-bit offset + 4-bit (length-3) → max match 18. `LZS.cpp:21-100`. Matches the standard FF7 field/world compression. |
| `GZIP` / `GZIPPS` | zlib gzip; PS variant | `GZIPPS`: 4-byte **decompressed size** LE, then a 4-byte sub-header, then a gzip stream. `GZIPPS.cpp`. |
| `TimFile` | PSX TIM | textures/icons |
| `TexFile` | FF7/FF8 `.tex` | ~0xEC-byte fixed header of `u32` fields (`TexFile.h:10-74`); `version` 1 = FF7, 2 = FF8 (FF7 header is `sizeof(struct) - 4`). Layout: header, palette section (`paletteSize * 4` bytes, BGRA per entry), image section (`w*h*bytesPerPixel`), optional colour-key array (`nbPalettes` bytes). Non-paletted 2 bpp uses PSX 15-bit colour. `TexFile.cpp:20-100`. |
| `PsColor` | PSX 15-bit colour | `r = c & 31, g = (c>>5) & 31, b = (c>>10) & 31`, bit 15 = alpha/STP; 5→8-bit expansion is `(v<<3) + (v>>2)`; `color == 0` is treated as fully transparent. `PsColor.cpp`. |
| `WindowBinFile` | `window.bin` (menu font + icons) | sequence of sections, each `u16 compressedSize, u16 uncompressedSize, u16 type`, then a gzip stream. 3 sections = western, 4 = Japanese. Section 0 = icons (TIM), 1 = font (TIM, must have 16 colour tables), (2 = second JP font), last = **char-width table of exactly 1302 bytes**. Glyph atlas is **21 glyphs per row**; table id < 4 → `glyphIndex = (tableId % 2) * 231 + charId`. `WindowBinFile.cpp:33-190`. |
| `TblFile` | world-map `.tbl` | records of 24 bytes = 2 × `WorldToField {i16 x, i16 y, i16 z, u16 fieldId, u8 dir, u8 pad(×3 on write)}` — entry[0] default, entry[1] alternate. Index = world map id. `TblFile.h`, `TblFile.cpp:10-45`. |
| `IsoArchive`/`IsoArchiveFF7` | PSX CD ISO (Mode 2 Form 1) | full ISO9660 read/write with sector patching; knows FF7's disc layout: `INIT/WINDOW.BIN`, `INIT/KERNEL.BIN`, `FIELD/FIELD.BIN`, `WORLD/WORLD.BIN`, `INIT/YAMADA.BIN`, `BATTLE/{TITLE.BIN,BATTLE.X,BATINI.X,SCENE.BIN,BATRES.X,CO.BIN}`. `IsoArchiveFF7.cpp:91-455`. |
| `Akao`/`AkaoIO` | FF7 sequenced music | **stubs only** (~170 bytes of code). No value. |
| `PsfFile` | PSF audio container | tags + compressed program |

---

## 9. Verbatim-data risk register

| Table | Location | Size | Risk | Better source |
|---|---|---|---|---|
| Per-character EXP curves `_charlvls` + TNL `_chartnls` | `FF7Char.h:300…378` | 12 × 99 × 2 u32 ≈ 2376 numbers | **HIGH** | kernel.bin initial/growth data |
| Stat growth `_stat_base`, `_stat_gradent` | `FF7Char.h:383-447` | 2 × 30 × 8 | **HIGH** | kernel.bin growth curves |
| Per-character HP/MP/luck base+gradient | `FF7Char.h:302…379` | 12 × 45 | **HIGH** | kernel.bin |
| Item table (`_items`) | `FF7Item.h` (133 KB) | ~320 records × ~50 fields | **HIGH** | kernel.bin item/weapon/armor/accessory sections |
| Materia table (`_materiaList`) | `FF7Materia.h:579+` (67 KB) | 91 records incl. per-star AP lists | **HIGH** | kernel.bin materia section |
| Location table (`_locations`) | `FF7Location.h:205+` (166 KB) | ~750 entries (filename, name, mapId, locId, x, y, t, d) | **HIGH** | field files + `mapnames`; ids derivable from flevel |
| Field item flag list | `FF7FieldItemList.h:79+` (45 KB) | 377 entries, 88 distinct offsets | **HIGH** (and hand-curated, not mechanically derivable) | derive from flevel.lgp scripts; use ff7tk to spot-check |
| FF7 text tables (`eng`, `jap`, `jap_fa…fe`) | `FF7Text.h:60-222` | 7 × 256 | **MEDIUM** | community charset / WINDOW.BIN |
| Key item / menu / achievement name lists | `FF7Save.h`, `FF7Achievements.h:59-96` | 52 / 10 / 36 strings | **MEDIUM** — this is *game text* (Square Enix), not ff7tk expression | game files |
| PSX slot header templates, default save blob | `FF7SaveInfo.h:294-308, 383+` | 15 × 0x200 + 0x10F4 | **MEDIUM** — mostly mechanical, but the default save is literally game data | generate programmatically / from a real save |
| AES signing key + IV for PSV/VMP | `FF7SaveInfo.h:326-327` | 2 × 16 bytes | **LOW** (facts/constants) but note they are Sony platform keys — consider whether we want them in the tree at all |

Struct layouts, offset tables, bit meanings, checksum polynomial, container sizes and
magic numbers (§2, §3, §4 encoding, §5 layouts, §7 scheme, §8 headers) are **facts** and
safe to re-implement from these notes.

---

## 10. Bugs / caveats found in ff7tk (do not replicate)

1. `FF7Char.h:395` — `_stat_base` row 11 has only **7** values while every other row has 8;
   a character with stat grade 11 reads out of bounds at level bracket 7 (levels 82–99).
2. `FF7Char.cpp:242` — luck baseline omits the `next_lvl` multiplier present in every other
   stat, so the gradient term is always 0 (integer division of a value < 100).
3. Doc comment `FF7Char.h:139` claims "20000000 xp for level 99"; the actual table value for
   Cloud is 2,452,783.
4. `rowFlag` documented two different ways (§2.6).
5. `FF7CHOCOBO` speed field comments are swapped relative to the field names (§5.2).
6. `FF7SLOT` snowboard best-time offsets in the header comments are internally inconsistent
   (`SnowBegFastTime` @0x0E14 is a u32 but `SnowExpFastTime` is annotated @0x0E16, only 2
   bytes later, while the struct packs them 4 apart → the annotations after 0x0E14 drift).
   Trust the packed struct order, or re-derive.
7. `ff7Checksum` reads bytes as signed `char` (§2.1).
8. `FF7Char::totalCharacters()` returns 11 but `validID` accepts 0..11 (12 entries).

These are useful *because* they tell us where ff7tk's numbers should not be trusted as
ground truth — a second independent source is needed for growth curves in particular.

---

## Top findings most useful for WebMidgar (ranked)

1. **Complete save-slot layout (0x10F4) with checksum algorithm** — §2, §2.1.
   → `formats-save`. This is the single biggest win: a full field map including the
   CRC-16/CCITT variant, the `0x4D1D` empty-slot sentinel, and the exact checksum range
   (bytes 4..0x10F3). Enough to read *and* write valid saves.
2. **Container format matrix for 10 save file types** — §3, §3.1–§3.4.
   → `formats-save`. PC `.ff7` (0xFE55 = 9-byte header + 15 × slot, no per-slot padding),
   Switch `ff7slot*`, raw PSX blocks, VMC/VMP/VGS/DEX memory cards with their
   128-byte directory frames, PSV/PGE/PDA single saves. Includes the PC header's odd
   selected-slot encoding and the per-frame XOR checksum.
3. **`FF7CHAR` (132 B) + `materia` (4 B) + `FF7CHOCOBO` (16 B) sub-structs** — §2.6, §2.7, §5.2.
   → `formats-save`, `menu`. Including the sparse `limits` bit mapping `{0,1,3,4,6,7,9}`
   and the 24-bit little-endian materia AP with `0xFFFFFF` = mastered.
4. **Item word encoding: 9-bit id + 7-bit quantity, `0x1FF` empty** — §4.
   → `formats-save`, `menu`. Trivially small, immediately actionable.
5. **Options/menu/PHS/key-item bitfields** — §2.5.
   → `menu`. Gives us the exact semantics behind the config screen (ATB mode across two
   bits, six magic orders across three bits, cursor/camera/sound/control) and the
   menu-visible/menu-locked masks needed for a faithful main menu.
6. **kernel.bin record *semantics*** — §4 (`ITEM` struct), §5.1 (`MATERIA` struct).
   → `formats-kernel`. The field lists and the ±3..+2 element/status encodings are a
   ready-made validation checklist for our kernel parser: 14 elements in a known order,
   24 statuses in a known order, materia growth rate / slot count / link count on
   weapons and armor.
7. **World-map coordinate bit packing (19/5/8 and 18/14)** — §2.4.
   → `world-runtime`, `formats-save`. Needed to restore/persist world-map position for
   the leader and each vehicle.
8. **Field-progress flag scheme (offset + bit + map name)** — §7.
   → `field-runtime`, `interpreter`. Confirms that field pickups are plain savemap bits
   and gives 88 concrete offsets to cross-check our own flevel-derived flag extraction.
9. **LGP TOC layout and the 30×30 lookup hash** — §8.
   → `formats-lgp`. The `lookupValue` character mapping and the conflict-table layout are
   the parts most often gotten wrong; worth diffing against our implementation.
10. **`window.bin` structure and the 1302-byte char-width table** — §8.
    → `menu`, `dialog`, `render-field`. Section framing (`u16 comp, u16 uncomp, u16 type`
    + gzip) plus the 21-glyphs-per-row atlas and the `(tableId % 2) * 231 + charId`
    index rule give us proportional text metrics.
11. **`.tbl` world→field transition records (2 × 12 bytes)** — §8.
    → `formats-world`, `world-runtime`. Small, precise, directly usable.
12. **PSV/VMP HMAC-SHA1 signing with a derived key + test vectors** — §3.6.
    → `formats-save`, only if we ever want to export console-compatible saves. Low priority.
13. **Region/edition model: region lives in the PSX save *name*, not in the data** — §3.5.
    → `formats-save`. Plus the JP `SLPS-00700` item-quantity ≤ 99 hazard.
14. **`achievements.dat`: 8 bytes, bits 28–63, MSB-first within each byte** — from
    `FF7Achievements.h`/`.cpp`. → `menu`/`modding`, only relevant for the 2012/Steam re-release.
15. **TEX header field list and PSX 15-bit colour conversion** — §8.
    → `render-field`, `convert`. Mostly confirmatory if we already parse `.tex`.

---

## Open questions

1. **Checksum sign-extension** (§2.1): does ff7tk's signed-`char` read actually produce the
   same CRC as an unsigned implementation for all inputs? Needs a differential test against
   real saves before we lock in our implementation.
2. **`rowFlag` encoding** (§2.6): 0x00/0x01 or 0xFE/0xFF? Two contradictory statements in
   the same repo. Decide empirically from a save with a known back-row character.
3. **Chocobo speed field order** (§5.2): are `sprintspd`/`speed` really in the order the
   field names claim, or in the order the comments claim?
4. **Snowboard time offsets** (§2.5 table, caveat 6): the annotated offsets drift after
   0x0E14. Re-derive by packing the struct.
5. **`personality` and `pcount` chocobo bytes**: ranges and meaning unknown even to ff7tk.
6. **~1/6 of the slot is still `UNKNOWN`** (`z_1`…`z_48`). Our field-script analysis
   (`interpreter` savemap writes) could actually *close* some of these gaps — this is an
   area where WebMidgar can go beyond ff7tk rather than follow it.
7. **`mapid` vs `locationid` vs `FF7Location` entries**: how exactly do the two u16 fields
   at 0x0B94/0x0B96 index into the location table? ff7tk stores them as *strings* in the
   location records, which suggests a loose mapping. Needs its own investigation.
8. **Growth curves**: given bugs (1) and (2) in §10, ff7tk's `statGain` is an approximation.
   Which kernel.bin section actually holds the 30-rank × 8-bracket growth tables, and do the
   level brackets (≤11, 12–21, 22–31, 32–41, 42–51, 52–61, **62–81**, 82–99 — note the
   20-wide sixth bracket) come from the data or are they hardcoded in the engine?
9. **`FF7FieldItemList` provenance**: were those 377 offset/bit pairs derived from field
   scripts or found by save diffing? If the former, we can regenerate them; if the latter,
   we need our own diffing effort and can only spot-check against ff7tk.
10. **Default save blob** (`FF7SaveInfo.h:383+`): is this the actual new-game savemap the
    retail game writes, or a reconstruction? Affects whether we can use it as a new-game
    fixture at all.
11. **Akao**: the classes are empty stubs — no help for our `audio` package.
12. **Are the PSV/VMP AES key + IV something we want in the repository at all?** They are
    published Sony-platform constants, but the legal posture differs from format facts.
