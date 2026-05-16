# MVave SMC Mixer - Current Mapping Notes

## Current behavior (implemented)

This preset currently targets a centered 2-deck workflow and intentionally repurposes controls:

- Deck 1 EQ lives on **column 4**
- Deck 2 EQ lives on **column 5**
- **Column 3 is disabled** (bricked) to avoid accidental duplicate control/LED behavior

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

### Column 3 mostly disabled

These controls are intentionally routed to a no-op input handler (`deadColumn3Input`) so they do nothing:

- Buttons: `0x02 / 0x0A / 0x12`
- Knob: `0x12`

Exception:

- **Top M button in column 3 (`0x12`) is now Deck 1 Sync (`[Channel1] sync_enabled`)**
- **Top M button in column 6 (`0x15`) is now Deck 2 Sync (`[Channel2] sync_enabled`)**

## LED behavior notes

- EQ LED output for Deck 1/2 is explicitly aligned to the repurposed column addresses in script logic.
- Utility LED controls that would collide with Deck EQ LEDs are offset away from the repurposed area in 2-deck mode.
- Startup lighting now lights columns **4 and 5** (not 3 and 4), matching the Deck 1/2 EQ layout.

## Important implementation details

- The no-op handler is created as `SMCMixer.controller.deadColumn3Input` in `MVave-SMC-Mixer-scripts.js`.
- EQ MIDI addresses are explicitly set by index arrays in `EqRack` to prevent implicit sequential collisions.
- In 2-deck mode, first utility-column LED controls are shifted with an offset to keep Deck EQ LED feedback stable.
