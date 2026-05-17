# MVave SMC Mixer - Current Mapping Notes

## Current behavior (implemented and stable)

This preset currently targets a centered two-deck workflow and intentionally repurposes controls:

- Deck 1 EQ lives on **column 4**
- Deck 2 EQ lives on **column 5**
- **Column 3 is disabled** (bricked) to avoid accidental duplicate control/LED behavior
- Sync utility is now active on the **M row** in columns 3 and 6
- Loop controls are now active on the **R, S, Square rows** in columns 3 and 6

The active mapping pair is:

- `MVave-SMC-Mixer.midi.xml`
- `MVave-SMC-Mixer-scripts.js`

## Deck EQ routing summary

### Deck 1 (column 4)

- Buttons: `0x03 / 0x0B / 0x13 / 0x1B`
- Knob: `0x13`
- Group target: `eqButtons[1]` / Channel 1 EQ group

### Deck 2 (column 5)

- Buttons: `0x04 / 0x0C / 0x14 / 0x1C`
- Knob: `0x14`
- Group target: `eqButtons[2]` / Channel 2 EQ group

### Column 3 — Deck 1 utility

| Row | MIDI | Control |
|-----|------|---------|
| M (top) | `0x12` | Deck 1 Sync — LED lit when synced |
| R | `0x02` | Deck 1 beatloop toggle — LED lit when loop active |
| S | `0x0A` | Deck 1 loop double |
| Square | `0x1A` | Deck 1 loop halve |

### Column 6 — Deck 2 utility

| Row | MIDI | Control |
|-----|------|---------|
| M (top) | `0x15` | Deck 2 Sync — LED lit when synced |
| R | `0x05` | Deck 2 beatloop toggle — LED lit when loop active |
| S | `0x0D` | Deck 2 loop double |
| Square | `0x1D` | Deck 2 loop halve |

## Progress update

Completed:

- Sync mapped: columns 3 & 6, M row
- Loop controls mapped: columns 3 & 6, R/S/Square rows
  - R → `reloop_toggle` (LED tracks `loop_enabled`)
  - S → `loop_double`
  - Square → `loop_halve`

Remaining next steps:

- Map **Hotcue** — all button rows in columns 3 and 6 are currently used, so hotcues will need a shift/layer approach.

## LED behavior notes

- EQ LED output for Deck 1/2 is explicitly aligned to the repurposed column addresses in script logic.
- Utility LED controls that would collide with Deck EQ LEDs are offset away from the repurposed area in 2-deck mode.
- Startup lighting now lights columns **4 and 5** (not 3 and 4), matching the Deck 1/2 EQ layout.

## Important implementation details

- The no-op handler is created as `SMCMixer.controller.deadColumn3Input` in `MVave-SMC-Mixer-scripts.js`.
- EQ MIDI addresses are explicitly set by index arrays in `EqRack` to prevent implicit sequential collisions.
- `loopButtons` are registered as deck LED components and track `loop_enabled` for real-time LED feedback.
- `loopDoubleButtons` and `loopHalveButtons` have `skipDeckStateRefresh = true` (no meaningful LED state).
- `keylockButtons[1]`, `quantizeButtons[1]`, and `pflButtons[1]` are still initialized, but their MIDI bindings (`0x05`, `0x0D`, `0x1D`) are reassigned to Deck 2 loop controls.
