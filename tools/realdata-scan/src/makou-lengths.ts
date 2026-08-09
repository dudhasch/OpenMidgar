/**
 * Referenz-Längentabelle aus Makou Reactor (`src/core/field/Opcode.cpp`,
 * `Opcode::length[257]`) — **Gesamtlänge je Instruktion inklusive
 * Opcode-Byte**, nicht Operandenlänge.
 *
 * ⚠️ **Das ist eine Hypothese, keine Autorität.** Sie wird ausschließlich in
 * der O9-Probe verwendet, um posten für posten gegen die eigenen Realdaten
 * gemessen zu werden. In die Engine wandert nur, was diese Messung besteht —
 * und zwar als eigener Wert in `packages/interpreter/src/opcodes.ts`, nicht
 * als Verweis auf diese Datei. Kein Produktivcode importiert sie.
 *
 * Eintrag 0 bedeutet „in der Referenz nicht belegt".
 *
 * Erzeugt am 2026-08-10. Reine Zahlenangaben über ein Dateiformat.
 */
export const MAKOU_TOTAL_LEN: readonly number[] = [
    1,  3,  3,  3,  3,  3,  3,  2,  2, 15,  6,  6,  1,  1,  2,  2, // 0x00
    2,  3,  2,  3,  6,  7,  8,  9,  8,  9, 10,  3,  6,  1,  1,  1, // 0x10
   11,  2,  5,  3,  3,  9,  2,  2,  3,  1,  2,  2,  5,  7,  2, 10, // 0x20
    4,  4,  4,  2,  2,  4,  5,  8,  6,  6,  6,  4,  1,  1,  1,  1, // 0x30
    3,  5,  6,  2,  1,  5,  1,  5,  7,  4,  2,  2,  1,  5,  1,  5, // 0x40
   10,  6,  4,  2,  2,  3,  7,  7,  5,  5,  5,  7,  8, 10,  8,  1, // 0x50
   10,  2,  5,  6,  6,  1,  9,  1,  9,  2,  7,  9,  1,  4,  3,  6, // 0x60
    4,  2,  3,  4,  4,  8,  0,  0,  0,  0,  0,  0,  0,  0,  2,  3, // 0x70
    4,  5,  4,  4,  4,  4,  5,  4,  5,  4,  5,  4,  5,  4,  5,  4, // 0x80
    5,  4,  5,  4,  5,  3,  3,  3,  3,  3,  4,  5,  6,  7,  7, 11, // 0x90
    2,  2,  3,  3,  2, 11,  9,  9,  6,  6,  2,  4,  1,  6,  3,  0, // 0xa0
    5,  0,  4,  3,  6,  6,  2,  4,  5,  4,  0,  5,  0,  4,  1,  2, // 0xb0
   11,  8, 15, 12,  1,  3,  3,  2,  2,  2,  4,  3,  3,  3,  2,  2, // 0xc0
   13,  2,  2, 16, 10, 10,  4,  4,  3,  1, 15,  2,  4,  1,  1, 11, // 0xd0
    4,  4,  3,  3,  3,  5,  5,  5,  7, 10, 10,  5,  5,  8,  8, 11, // 0xe0
    2,  5, 14,  2,  2,  2,  2,  4,  2,  1,  3,  2,  2,  8,  3,  1, // 0xf0
];

/** Opcode-Namen der Referenz — nur für lesbare Probenausgaben. */
export const MAKOU_NAME: readonly string[] = [
  'RET', 'REQ', 'REQSW', 'REQEW', 'PREQ', 'PRQSW', 'PRQEW', 'RETTO', 'JOIN', 'SPLIT', 'SPTYE', 'GTPYE', '', '', 'DSKCG', 'SPECIAL',
  'JMPF', 'JMPFL', 'JMPB', 'JMPBL', 'IFUB', 'IFUBL', 'IFSW', 'IFSWL', 'IFUW', 'IFUWL', '', '', '', '', '', '',
  'MINIGAME', 'TUTOR', 'BTMD2', 'BTRLD', 'WAIT', 'NFADE', 'BLINK', 'BGMOVIE', 'KAWAI', 'KAWIW', 'PMOVA', 'SLIP', 'BGPDH', 'BGSCR', 'WCLS', 'WSIZW',
  'IFKEY', 'IFKEYON', 'IFKEYOFF', 'UC', 'PDIRA', 'PTURA', 'WSPCL', 'WNUMB', 'STTIM', 'GOLDu', 'GOLDd', 'CHGLD', 'HMPMAX1', 'HMPMAX2', 'MHMMX', 'HMPMAX3',
  'MESSAGE', 'MPARA', 'MPRA2', 'MPNAM', '', 'MPu', '', 'MPd', 'ASK', 'MENU', 'MENU2', 'BTLTB', '', 'HPu', '', 'HPd',
  'WINDOW', 'WMOVE', 'WMODE', 'WREST', 'WCLSE', 'WROW', 'GWCOL', 'SWCOL', 'STITM', 'DLITM', 'CKITM', 'SMTRA', 'DMTRA', 'CMTRA', 'SHAKE', 'NOP',
  'MAPJUMP', 'SCRLO', 'SCRLC', 'SCRLA', 'SCR2D', 'SCRCC', 'SCR2DC', 'SCRLW', 'SCR2DL', 'MPDSP', 'VWOFT', 'FADE', 'FADEW', 'IDLCK', 'LSTMP', 'SCRLP',
  'BATTLE', 'BTLON', 'BTLMD', 'PGTDR', 'GETPC', 'PXYZI', '', '', '', '', '', '', '', '', 'TLKON', 'RDMSD',
  'SETBYTE', 'SETWORD', 'BITON', 'BITOFF', 'BITXOR', 'PLUS', 'PLUS2', 'MINUS', 'MINUS2', 'MUL', 'MUL2', 'DIV', 'DIV2', 'MOD', 'MOD2', 'AND',
  'AND2', 'OR', 'OR2', 'XOR', 'XOR2', 'INC', 'INC2', 'DEC', 'DEC2', 'RANDOM', 'LBYTE', 'HBYTE', '2BYTE', 'SETX', 'GETX', 'SEARCHX',
  'PC', 'CHAR', 'DFANM', 'ANIME1', 'VISI', 'XYZI', 'XYI', 'XYZ', 'MOVE', 'CMOVE', 'MOVA', 'TURA', 'ANIMW', 'FMOVE', 'ANIME2', '',
  'CANIM1', '', 'MSPED', 'DIR', 'TURNGEN', 'TURN', 'DIRA', 'GETDIR', 'GETAXY', 'GETAI', '', 'CANIM2', '', 'ASPED', '', 'CC',
  'JUMP', 'AXYZI', 'LADER', 'OFST', 'OFSTW', 'TALKR', 'SLIDR', 'SOLID', 'PRTYP', 'PRTYM', 'PRTYE', 'IFPRTYQ', 'IFMEMBQ', 'MMBud', 'MMBLK', 'MMBUK',
  'LINE', 'LINON', 'MPJPO', 'SLINE', 'SIN', 'COS', 'TLKR2', 'SLDR2', 'PMJMP', 'PMJMP2', 'AKAO2', 'FCFIX', 'CCANM', 'ANIMB', 'TURNW', 'MPPAL',
  'BGON', 'BGOFF', 'BGROL', 'BGROL2', 'BGCLR', 'STPAL', 'LDPAL', 'CPPAL', 'RTPAL', 'ADPAL', 'MPPAL2', 'STPLS', 'LDPLS', 'CPPAL2', 'RTPAL2', 'ADPAL2',
  'MUSIC', 'SOUND', 'AKAO', 'MUSVT', 'MUSVM', 'MULCK', 'BMUSC', 'CHMPH', 'PMVIE', 'MOVIE', 'MVIEF', 'MVCAM', 'FMUSC', 'CMUSC', 'CHMST', 'GAMEOVER',
];
