# M-Vave SMC-Mixer Current Mapping (Visual Layout)

This document reflects the current mapping in:
- MVave-SMC-Mixer.midi.xml
- MVave-SMC-Mixer-scripts.js

Deck mode is currently set to two-deck by default.

All controls mapped to Channel 3 or Channel 4 are marked as:
- **[REPURPOSE FOR 2-DECK]**

Duplicate controls intentionally called out for repurpose are marked as:
- **[REPURPOSE FOR 2-DECK - DUPLICATE]**

## Visual Strip Layout (Left to Right)

The mixer has 8 vertical strips. Each strip is represented with the same top-to-bottom order as the hardware:
- Top knob
- M button
- S button
- R button
- Square button
- Slider

| Physical row \ Column | Col 1 (leftmost) | Col 2 | Col 3 | Col 4 | Col 5 | Col 6 | Col 7 | Col 8 (rightmost) |
|---|---|---|---|---|---|---|---|---|
| Top knob | Deck 1 FX1 meta (0xB0/0x10) | Deck 1 FX2 meta (0xB0/0x11) | Deck 1 jog (0xB0/0x12) | Channel 1 pregain (0xB0/0x13) | Channel 2 pregain (0xB0/0x14) | Deck 2 jog (0xB0/0x15) | Deck 2 FX1 meta (0xB0/0x16) | Deck 2 FX2 meta (0xB0/0x17) |
| M button | CH3 EQ high kill (0x90/0x10) **[REPURPOSE FOR 2-DECK]** | Deck 1 Hotcue 1 (0x90/0x11) | Deck 1 Sync (0x90/0x12) | CH1 EQ high kill (0x90/0x13) | CH2 EQ high kill (0x90/0x14) | Deck 2 Sync (0x90/0x15) | Deck 2 Hotcue 1 (0x90/0x16) | CH4 Slip (0x90/0x17) **[REPURPOSE FOR 2-DECK]** |
| S button | CH3 EQ mid kill (0x90/0x08) **[REPURPOSE FOR 2-DECK]** | Deck 1 Hotcue 2 (0x90/0x09) | Deck 1 loop double (0x90/0x0A) | CH1 EQ mid kill (0x90/0x0B) | CH2 EQ mid kill (0x90/0x0C) | Deck 2 loop double (0x90/0x0D) | Deck 2 Hotcue 2 (0x90/0x0E) | CH4 Quantize (0x90/0x0F) **[REPURPOSE FOR 2-DECK]** |
| R button | CH3 EQ low kill (0x90/0x00) **[REPURPOSE FOR 2-DECK]** | CH3 QuickEffect enable (0x90/0x01) **[REPURPOSE FOR 2-DECK]** | Deck 1 loop halve (0x90/0x02) | CH1 EQ low kill (0x90/0x03) | CH2 EQ low kill (0x90/0x04) | Deck 2 loop halve (0x90/0x05) | CH2 Keylock (0x90/0x06) | CH4 Keylock (0x90/0x07) **[REPURPOSE FOR 2-DECK]** |
| Square button | Deck 1 FX1 enable (0x90/0x18) | Deck 1 FX2 enable (0x90/0x19) | Deck 1 beatloop activate (0x90/0x1A) | CH1 QuickEffect enable (0x90/0x1B) | CH2 QuickEffect enable (0x90/0x1C) | Deck 2 beatloop activate (0x90/0x1D) | Deck 2 FX1 enable (0x90/0x1E) | Deck 2 FX2 enable (0x90/0x1F) |
| Slider | Master crossfader (0xE0) | CH1 volume (0xE1) **[REPURPOSE FOR 2-DECK - DUPLICATE]** | CH1 rate (0xE2) | CH1 volume (0xE3) | CH2 volume (0xE4) | CH2 rate (0xE5) | CH2 rate (0xE6) **[REPURPOSE FOR 2-DECK - DUPLICATE]** | CH4 rate (0xE7) **[REPURPOSE FOR 2-DECK]** |

## Bottom Row Buttons

| MIDI | Current function | Notes |
|---|---|---|
| 0x90/0x2E | Active deck backButton input | Script behavior: beatjump backward trigger |
| 0x90/0x2F | Active deck forwardButton input | Script behavior: beatjump forward trigger |
| 0x90/0x5B | deckLeftButton | Deck select left (long press goes to Channel 3 only in 4-deck mode) |
| 0x90/0x5C | deckRightButton | Deck select right (long press goes to Channel 4 only in 4-deck mode) |
| 0x90/0x5D | Cue | Active deck cue |
| 0x90/0x5E | Play | Active deck play |
| 0x90/0x5F | Record | Toggle recording |
| 0x90/0x61 | Library Down | MoveDown |
| 0x90/0x60 | Library Up | MoveUp |
| 0x90/0x62 | Library Left | Focus/tree navigation logic |
| 0x90/0x63 | Library Right | Focus/library navigation logic |

## Side Buttons

| Control | Mapping status |
|---|---|
| BT | Not mapped in current XML/script |
| SHIFT | Not mapped in current XML/script |

## Important Notes For 2-Deck Workflow

- Leftmost slider is intentionally mapped to Master crossfader.
- Any control marked **[REPURPOSE FOR 2-DECK]** is currently tied to Channel 3/4 and should be reassigned to useful Deck 1/2 functionality.
- Any control marked **[REPURPOSE FOR 2-DECK - DUPLICATE]** is a duplicate mapping and should be reassigned to a unique 2-deck control.
- Suggested repurpose targets:
  - extra loop functions
  - additional FX toggles or macros
  - key adjust/reset functions
  - sampler or stem controls
  - browser/load shortcuts
