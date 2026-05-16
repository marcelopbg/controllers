# MVave SMC Mixer - Handoff Context and Plan

## Why this handoff exists

This mapping work became unstable because multiple concerns were changed at once (deck routing, LED behavior, control swaps, and probe/debug code).  
The file has been reverted to a stable baseline so the next iteration can proceed safely.

The core lesson: **test-first and incremental changes only**.

## Current known context

- Working file baseline: `MVave-SMC-Mixer-scripts.js` (reverted by user).
- Desired target UX is a 2-deck centered layout:
  - Deck 1 on column 4
  - Deck 2 on column 5
  - Column 1 = crossfader
  - Column 3 utility for Deck 1: speed slider + Sync/Loop/Keylock/Hotcue1 buttons
  - Column 6 utility for Deck 2: speed slider + Sync/Loop/Keylock/Hotcue1 buttons
  - Columns 2, 7, 8 intentionally empty
- LED discovery findings:
  - Some LEDs respond (EQ block and beatjump left/right were confirmed during probing).
  - Soft-takeover/deck-select LEDs did not respond reliably with broad generic MIDI sweeps.
- Additional repo context:
  - `MVave-SMC-Mixer.midi.xml` points to `MVave-SMC-Mixer-scripts.js`.
  - A copied custom JS file is not loaded unless explicitly referenced by XML.
  - VID/PID overlap exists with another preset in repo (`MVave-SMK-25-II`), so keep mapping selection in mind when testing.

---

## MANDATORY FIRST TASK (before any new feature work)

**Add tests first. Do not implement new mapping changes before tests exist.**

### Required testing goal

Build well-structured unit tests that lock down **current baseline behavior** of `MVave-SMC-Mixer-scripts.js` so refactors/remaps can be done safely.

### Minimum behavior coverage expected

1. Long-press modal behavior for EQ/Effect buttons:
   - mode activation/deactivation
   - blink start/stop lifecycle
   - single active modal blink at a time
2. Short-press behavior for those buttons remains intact.
3. Deck switching behavior (current baseline, including 2-deck constraints if present).
4. LED output helper behavior:
   - sends expected MIDI messages
   - does not leave stale timers/state
5. Any existing custom logic for beatjump/deck-select indicator interactions.

### Test quality bar

- Tests must assert both control-side effects (`engine.setValue` / parameter changes) and MIDI output side effects (`midi.sendShortMsg`).
- Timer behavior must be deterministic in tests (fake timer hooks or mocked timer scheduler).
- Each test should validate one behavior clearly; avoid broad “integration blob” tests.

---

## Implementation plan after tests are in place

1. Freeze baseline and remove temporary/debug-only probe behavior unless explicitly needed.
2. Implement centered 2-deck remap in slices:
   - Slice A: faders only
   - Slice B: utility buttons only
   - Slice C: knob alignment only
3. After each slice, update/extend tests and verify no baseline regressions.
4. Only then handle deck-indicator LED strategy using known-addressable LEDs.

## Safety rules for next agent

- One isolated change block per commit.
- No mixed refactor + feature + debug additions in one change.
- Keep rollback easy.
- If behavior is uncertain, instrument with temporary logging only under an explicit debug flag and remove before finalizing.
