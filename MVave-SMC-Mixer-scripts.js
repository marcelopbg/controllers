"use strict";

// eslint-disable-next-line no-var
var SMCMixer;
(function (SMCMixer) {
    const DEFAULT_DECK_MODE = "two"; // "two", "four", or "auto"

    const mapIndexToChannel = function (index) {
        switch (Math.abs(index) % 4) {
            case 0: return 3;
            case 1: return 1;
            case 2: return 2;
            case 3: return 4;
        }
    };

    class Deck extends components.Deck {
        constructor() {
            super([1, 2, 3, 4]);
            // Transport buttons
            this.playButton = new components.PlayButton({
                group: "[Channel1]",
                midi: [0x90, 0x5E], // Play transport
                type: components.Button.prototype.types.toggle,
            });
            this.cueButton = new components.CueButton({
                group: "[Channel1]",
                midi: [0x90, 0x5D], // Pause transport
                type: components.Button.prototype.types.push,
            });
            this.backButton = new components.Button({
                group: "[Channel1]",
                midi: [0x90, 0x5B],
                input: function(channel, control, value, status, _group) {
                    if (this.isPress(channel, control, value, status)) {
                        engine.setValue(this.group, "beatjump_backward", 1);
                        engine.setValue(this.group, "beatjump_backward", 0);
                    }
                },
            });
            this.forwardButton = new components.Button({
                group: "[Channel1]",
                midi: [0x90, 0x5C],
                input: function(channel, control, value, status, _group) {
                    if (this.isPress(channel, control, value, status)) {
                        engine.setValue(this.group, "beatjump_forward", 1);
                        engine.setValue(this.group, "beatjump_forward", 0);
                    }
                },
            });
        }
    }

    class Encoder extends components.Encoder {
        constructor(params) {
            super(params);
        }
        inValueScale(value) {
            if (value === 0x41) {
                return this.inGetParameter() - 0.01;
            } else {
                return this.inGetParameter() + 0.01;
            }
        }
    }

    // LongPressButton is like a normal button of type powerWindow, except that
    // it doesn't trigger the short press and the long press.
    // Instead it triggers on release and leaves it to the user of the class to
    // check if this was a long press or a short press.
    class LongPressButton extends components.Button {
        constructor(params) {
            super(params);
        }

        input(channel, control, value, status, _group) {
            if (this.isPress(channel, control, value, status)) {
                this.isLongPressed = false;
                this.longPressTimer = engine.beginTimer(this.longPressTimeout, () => {
                    this.isLongPressed = true;
                    this.longPressTimer = 0;
                }, true);
            } else {
                this.inToggle();
                if (!this.isLongPressed && this.triggerOnRelease) {
                    this.trigger();
                }
                if (this.longPressTimer !== 0) {
                    engine.stopTimer(this.longPressTimer);
                    this.longPressTimer = 0;
                }
                this.isLongPressed = false;
            }
        }
    }

    // Pot is the same as components.Pot except that it keeps track of the value
    // set by moving one of the hardware faders, and if that value ever doesn't
    // match the value of the fader in software it blinks the LED above the
    // physical fader to indicate that soft takeover is enabled.
    // Right now the LED always blinks when you attempt to turn it on, but
    // M-Vave has indicated that in a future firmware update they will make it
    // possible to set the LED to be lit steadily.
    class Pot extends components.Pot {
        constructor(params) {
            super(params);
            // If the hardware control does not match the software control by
            // anything less than the tolerance window, we consider them the
            // same. This way we're not constantly blinking the soft takeover
            // indicator because we didn't get the control matched up exactly.
            this.toleranceWindow = 0.03;
        }
        input(_channel, _control, value, _status, _group) {
            const receivingFirstValue = this.hardwarePos === undefined;
            this.hardwarePos = this.inValueScale(value);
            engine.setParameter(this.group, this.inKey, this.hardwarePos);
            if (receivingFirstValue) {
                this.firstValueReceived = true;
                this.connect();
            }
        }
        connect() {
            if (this.firstValueReceived && !this.relative && this.softTakeover) {
                engine.softTakeover(this.group, this.inKey, true);
            }
            if (undefined !== this.group &&
                undefined !== this.outKey &&
                undefined !== this.output &&
                typeof this.output === "function") {
                this.connections[0] = engine.makeConnection(this.group, this.outKey, this.output.bind(this));
            }
        }
        output(value) {
            if (this.hardwarePos === undefined) {
                return;
            }
            const parameterValue = engine.getParameter(this.group, this.outKey);
            const delta = parameterValue - this.hardwarePos;
            if (delta > this.toleranceWindow) {
                midi.sendShortMsg(this.midi[0], this.hardwarePos, this.inValueScale(value));
            }
        }
    }

    class EqRack extends components.ComponentContainer {
        constructor(index) {
            super({});
            const channel = mapIndexToChannel(index);
            const knobMidiByIndex = [0x10, 0x13, 0x14, 0x54];
            const lowMidiByIndex = [0x00, 0x03, 0x04, 0x44];
            const midMidiByIndex = [0x08, 0x0B, 0x0C, 0x4C];
            const highMidiByIndex = [0x10, 0x13, 0x14, 0x54];
            const quickMidiByIndex = [0x18, 0x1B, 0x1C, 0x5C];
            this.knob = new Encoder({
                group: `[Channel${channel}]`,
                midi: [0xB0, knobMidiByIndex[index]],
                inKey: "pregain",
            });

            const eqRack = this;
            const knob = eqRack.knob;
            const origGroup = knob.group;
            const origInKey = knob.inKey;

            const ledOn = (button, value) => {
                const controller = SMCMixer.controller;
                if (controller && typeof controller.isDeckComponentEnabled === "function" &&
                    !controller.isDeckComponentEnabled(button)) {
                    midi.sendShortMsg(button.midi[0], button.midi[1], 0x00);
                    return;
                }
                midi.sendShortMsg(button.midi[0], button.midi[1], value);
            };

            const restoreButtonLed = (button) => {
                button.output(button.inGetParameter());
            };

            const stopBlink = (button) => {
                if (!button) {
                    return;
                }
                if (button.blinkTimer && button.blinkTimer !== 0) {
                    engine.stopTimer(button.blinkTimer);
                    button.blinkTimer = 0;
                }
                button.blinkState = false;
            };

            const startBlink = (button) => {
                stopBlink(button);
                button.blinkState = false;
                ledOn(button, 0x00);
                button.blinkTimer = engine.beginTimer(300, () => {
                    button.blinkState = !button.blinkState;
                    ledOn(button, button.blinkState ? 0x7F : 0x00);
                });
            };

            const stopAllFreqBlinking = () => {
                const modeButtons = [
                    eqRack.lowKillButton,
                    eqRack.midKillButton,
                    eqRack.highKillButton,
                    eqRack.quickEffectButton,
                ];
                for (const button of modeButtons) {
                    if (!button) {
                        continue;
                    }
                    const wasBlinking = button.blinkTimer && button.blinkTimer !== 0;
                    stopBlink(button);
                    if (wasBlinking) {
                        restoreButtonLed(button);
                    }
                }
            };

            const btnInToggle = () => {
                return function () {
                    const button = this;
                    if (button.isLongPressed) {
                        let newKey = "";
                        if (button.key === "enabled") {
                            newKey = "super1";
                        } else {
                            newKey = button.inKey.replace("button_", "");
                        }

                        const sameModeActive = knob.group === button.group && knob.inKey === newKey;
                        if (sameModeActive) {
                            knob.group = origGroup;
                            knob.inKey = origInKey;
                            stopBlink(button);
                            restoreButtonLed(button);
                            return;
                        }

                        stopAllFreqBlinking();

                        knob.group = button.group;
                        knob.inKey = newKey;
                        startBlink(button);
                    } else {
                        const val = button.inGetParameter();
                        if (val > 0) {
                            button.inSetValue(0);
                        } else {
                            button.inSetValue(0x1F);
                        }
                    }
                };
            };
            this.highKillButton = new LongPressButton({
                type: components.Button.prototype.types.powerWindow,
                group: `[EqualizerRack1_[Channel${channel}]_Effect1]`,
                midi: [0x90, highMidiByIndex[index]],
                key: "button_parameter3",
                output: function (value) {
                    if (this.blinkTimer && this.blinkTimer !== 0) {
                        return;
                    }
                    ledOn(this, value > 0 ? 0x00 : 0x7F);
                },
                inToggle: btnInToggle(),
            });
            this.midKillButton = new LongPressButton({
                type: components.Button.prototype.types.toggle,
                group: `[EqualizerRack1_[Channel${channel}]_Effect1]`,
                midi: [0x90, midMidiByIndex[index]],
                key: "button_parameter2",
                output: function (value) {
                    if (this.blinkTimer && this.blinkTimer !== 0) {
                        return;
                    }
                    ledOn(this, value > 0 ? 0x00 : 0x7F);
                },
                inToggle: btnInToggle(),
            });
            this.lowKillButton = new LongPressButton({
                type: components.Button.prototype.types.toggle,
                group: `[EqualizerRack1_[Channel${channel}]_Effect1]`,
                midi: [0x90, lowMidiByIndex[index]],
                key: "button_parameter1",
                output: function (value) {
                    if (this.blinkTimer && this.blinkTimer !== 0) {
                        return;
                    }
                    ledOn(this, value > 0 ? 0x00 : 0x7F);
                },
                inToggle: btnInToggle(),
            });
            this.quickEffectButton = new LongPressButton({
                type: components.Button.prototype.types.toggle,
                group: `[QuickEffectRack1_[Channel${channel}]]`,
                midi: [0x90, quickMidiByIndex[index]],
                key: "enabled",
                inToggle: btnInToggle(),
            });
            const modeButtons = [
                this.lowKillButton,
                this.midKillButton,
                this.highKillButton,
                this.quickEffectButton,
            ];
            for (const button of modeButtons) {
                button.blinkTimer = 0;
                button.blinkState = false;
            }
        }
    }
    class Controller extends components.ComponentContainer {
        constructor() {
            super({});
            this.activeDeck = new Deck();
            this.deckMode = DEFAULT_DECK_MODE;
            this.deckLedComponents = [];
            this.deckLedProbeEnabled = true;
            this.deckLedProbeControls = this.createControlRange(0x00, 0x7F);
            this.deckLedProbeCases = this.createDeckLedProbeCases([
                0x90, 0x91, 0x92, 0x93,
                0xB0, 0xB1, 0xB2, 0xB3,
                0xA0, 0xA1, 0xA2, 0xA3,
                0xD0, 0xD1, 0xD2, 0xD3,
                0xE0, 0xE1, 0xE2, 0xE3,
                0xE4, 0xE5, 0xE6, 0xE7,
            ]);
            this.deckLedProbeIndex = 0;
            this.deckLedProbeLastCaseIndex = -1;
            this.bootLedTestEnabled = true;
            this.bootLedTestTimer = 0;
            this.bootLedTestIntervalMs = 120;
            this.eqButtons = new Array(4);
            this.slipButtons = new Array(4);
            this.quantizeButtons = new Array(4);
            this.keylockButtons = new Array(4);
            this.pflButtons = new Array(4);
            this.syncButtons = new Array(2);
            this.loopButtons = new Array(2);
            this.loopDoubleButtons = new Array(2);
            this.loopHalveButtons = new Array(2);
            this.hotcueButtons = [new Array(2), new Array(2)];
            this.fxButtons = [new Array(2), new Array(2)];
            this.effectKnobs = [new Array(2), new Array(2)];
            this.faders = new Array(8);
            for (let i = 0; i < 4; i++) {
                const channel = mapIndexToChannel(i);
                const group = `[Channel${channel}]`;
                const repurposedColumnOffset = ((i === 0 || i === 1) && !this.isFourDeckMode()) ? 0x40 : 0;
                this.eqButtons[i] = new EqRack(i);
                this.registerDeckLedComponent(this.eqButtons[i].lowKillButton);
                this.registerDeckLedComponent(this.eqButtons[i].midKillButton);
                this.registerDeckLedComponent(this.eqButtons[i].highKillButton);
                this.registerDeckLedComponent(this.eqButtons[i].quickEffectButton);
                this.slipButtons[i] = new components.Button({
                    type: components.Button.prototype.types.toggle,
                    group: group,
                    midi: [0x90, i + 0x14 + repurposedColumnOffset],
                    key: "slip_enabled",
                });
                this.slipButtons[i].skipDeckStateRefresh = true;
                this.registerDeckLedComponent(this.slipButtons[i]);
                this.quantizeButtons[i] = new components.Button({
                    type: components.Button.prototype.types.toggle,
                    group: group,
                    midi: [0x90, 0x0C + i + repurposedColumnOffset],
                    key: "quantize",
                });
                this.quantizeButtons[i].skipDeckStateRefresh = true;
                this.registerDeckLedComponent(this.quantizeButtons[i]);
                this.keylockButtons[i] = new components.Button({
                    type: components.Button.prototype.types.toggle,
                    group: group,
                    midi: [0x90, 0x04 + i + repurposedColumnOffset],
                    key: "keylock",
                });
                this.keylockButtons[i].skipDeckStateRefresh = true;
                this.registerDeckLedComponent(this.keylockButtons[i]);
                this.pflButtons[i] = new components.Button({
                    type: components.Button.prototype.types.toggle,
                    group: group,
                    midi: [0x90, 0x1C + i + repurposedColumnOffset],
                    key: "pfl",
                });
                this.pflButtons[i].skipDeckStateRefresh = true;
                this.registerDeckLedComponent(this.pflButtons[i]);
                this.faders[i] = new Pot({
                    group: group,
                    midi: [0xE0 + i],
                    key: "volume",
                    softTakeover: true,
                });
                this.faders[i + 4] = new Pot({
                    group: group,
                    midi: [0xE4 + i],
                    key: "rate",
                    softTakeover: true,
                });
            }

            this.syncButtons[0] = new components.Button({
                type: components.Button.prototype.types.toggle,
                group: "[Channel1]",
                midi: [0x90, 0x12],
                key: "sync_enabled",
            });
            this.registerDeckLedComponent(this.syncButtons[0]);
            this.syncButtons[1] = new components.Button({
                type: components.Button.prototype.types.toggle,
                group: "[Channel2]",
                midi: [0x90, 0x15],
                key: "sync_enabled",
            });
            this.registerDeckLedComponent(this.syncButtons[1]);

            // Loop controls — columns 3 (Deck 1) and 6 (Deck 2)
            const loopGroups = ["[Channel1]", "[Channel2]"];
            const loopMidi   = [0x02, 0x05];
            const doublesMidi = [0x0A, 0x0D];
            const halveMidi  = [0x1A, 0x1D];
            for (let i = 0; i < 2; i++) {
                const loopActiveOutput = function (value) {
                    if (value > 0) {
                        if (!this.blinkTimer || this.blinkTimer === 0) {
                            this.blinkState = false;
                            midi.sendShortMsg(this.midi[0], this.midi[1], 0x00);
                            this.blinkTimer = engine.beginTimer(300, () => {
                                this.blinkState = !this.blinkState;
                                midi.sendShortMsg(this.midi[0], this.midi[1], this.blinkState ? 0x7F : 0x00);
                            });
                        }
                        return;
                    }
                    if (this.blinkTimer && this.blinkTimer !== 0) {
                        engine.stopTimer(this.blinkTimer);
                        this.blinkTimer = 0;
                    }
                    this.blinkState = false;
                    midi.sendShortMsg(this.midi[0], this.midi[1], 0x00);
                };

                this.loopButtons[i] = new components.Button({
                    type: components.Button.prototype.types.push,
                    group: loopGroups[i],
                    midi: [0x90, loopMidi[i]],
                    key: "loop_halve",
                    output: loopActiveOutput,
                });
                this.loopButtons[i].outKey = "loop_enabled";
                if (typeof this.loopButtons[i].disconnect === "function") {
                    this.loopButtons[i].disconnect();
                }
                if (typeof this.loopButtons[i].connect === "function") {
                    this.loopButtons[i].connect();
                }
                this.loopButtons[i].blinkTimer = 0;
                this.loopButtons[i].blinkState = false;
                this.registerDeckLedComponent(this.loopButtons[i]);

                this.loopDoubleButtons[i] = new components.Button({
                    type: components.Button.prototype.types.push,
                    group: loopGroups[i],
                    midi: [0x90, doublesMidi[i]],
                    key: "loop_double",
                });
                this.loopDoubleButtons[i].skipDeckStateRefresh = true;
                this.registerDeckLedComponent(this.loopDoubleButtons[i]);

                this.loopHalveButtons[i] = new components.Button({
                    type: components.Button.prototype.types.push,
                    group: loopGroups[i],
                    midi: [0x90, halveMidi[i]],
                    key: "beatloop_activate",
                    output: loopActiveOutput,
                });
                this.loopHalveButtons[i].outKey = "loop_enabled";
                if (typeof this.loopHalveButtons[i].disconnect === "function") {
                    this.loopHalveButtons[i].disconnect();
                }
                if (typeof this.loopHalveButtons[i].connect === "function") {
                    this.loopHalveButtons[i].connect();
                }
                this.loopHalveButtons[i].blinkTimer = 0;
                this.loopHalveButtons[i].blinkState = false;
                this.registerDeckLedComponent(this.loopHalveButtons[i]);
            }

            const deckColumns = [
                {
                    deckGroup: "[Channel1]",
                    effectUnitGroup: "[EffectRack1_EffectUnit1]",
                    effect1Group: "[EffectRack1_EffectUnit1_Effect1]",
                    effect2Group: "[EffectRack1_EffectUnit1_Effect2]",
                    deckEnableKey: "group_[Channel1]_enable",
                    hotcueMidi: [0x11, 0x09],
                    fxMidi: [0x18, 0x19],
                    knobMidi: [0x10, 0x11],
                },
                {
                    deckGroup: "[Channel2]",
                    effectUnitGroup: "[EffectRack1_EffectUnit2]",
                    effect1Group: "[EffectRack1_EffectUnit2_Effect1]",
                    effect2Group: "[EffectRack1_EffectUnit2_Effect2]",
                    deckEnableKey: "group_[Channel2]_enable",
                    hotcueMidi: [0x16, 0x0E],
                    fxMidi: [0x1E, 0x1F],
                    knobMidi: [0x16, 0x17],
                },
            ];

            for (let deckIndex = 0; deckIndex < deckColumns.length; deckIndex++) {
                const config = deckColumns[deckIndex];
                for (let hotcueIndex = 0; hotcueIndex < 2; hotcueIndex++) {
                    const hotcueNumber = hotcueIndex + 1;
                    const activateKey = `hotcue_${hotcueNumber}_activate`;
                    const setKey = `hotcue_${hotcueNumber}_set`;
                    const clearKey = `hotcue_${hotcueNumber}_clear`;
                    const enabledKey = `hotcue_${hotcueNumber}_enabled`;
                    const positionKey = `hotcue_${hotcueNumber}_position`;
                    this.hotcueButtons[deckIndex][hotcueIndex] = new LongPressButton({
                        type: components.Button.prototype.types.powerWindow,
                        group: config.deckGroup,
                        midi: [0x90, config.hotcueMidi[hotcueIndex]],
                        key: activateKey,
                        outKey: enabledKey,
                        hotcuePositionKey: positionKey,
                        hotcueActivateKey: activateKey,
                        hotcueSetKey: setKey,
                        hotcueClearKey: clearKey,
                        isHotcueSet: function () {
                            const enabled = engine.getValue(this.group, this.outKey) > 0;
                            const position = engine.getValue(this.group, this.hotcuePositionKey);
                            const hasPosition = typeof position === "number" && isFinite(position) && position >= 0;
                            return enabled || hasPosition;
                        },
                        inToggle: function () {
                            const isSet = this.isHotcueSet();
                            if (this.isLongPressed) {
                                if (!isSet) {
                                    return;
                                }
                                engine.setValue(this.group, this.hotcueClearKey, 1);
                                engine.setValue(this.group, this.hotcueClearKey, 0);
                                return;
                            }
                            const targetKey = isSet ? this.hotcueActivateKey : this.hotcueSetKey;
                            engine.setValue(this.group, targetKey, 1);
                            engine.setValue(this.group, targetKey, 0);
                        },
                    });
                    this.registerDeckLedComponent(this.hotcueButtons[deckIndex][hotcueIndex]);
                }

                engine.setValue(config.effectUnitGroup, config.deckEnableKey, 1);
                this.fxButtons[deckIndex][0] = new components.Button({
                    type: components.Button.prototype.types.toggle,
                    group: config.effect1Group,
                    midi: [0x90, config.fxMidi[0]],
                    key: "enabled",
                });
                this.registerDeckLedComponent(this.fxButtons[deckIndex][0]);

                this.fxButtons[deckIndex][1] = new components.Button({
                    type: components.Button.prototype.types.toggle,
                    group: config.effect2Group,
                    midi: [0x90, config.fxMidi[1]],
                    key: "enabled",
                });
                this.registerDeckLedComponent(this.fxButtons[deckIndex][1]);

                this.effectKnobs[deckIndex][0] = new Encoder({
                    group: config.effect1Group,
                    midi: [0xB0, config.knobMidi[0]],
                    inKey: "meta",
                });
                this.effectKnobs[deckIndex][1] = new Encoder({
                    group: config.effect2Group,
                    midi: [0xB0, config.knobMidi[1]],
                    inKey: "meta",
                });
            }

            this.registerDeckLedComponent(this.activeDeck.playButton);
            this.registerDeckLedComponent(this.activeDeck.cueButton);
            this.registerDeckLedComponent(this.activeDeck.backButton);
            this.registerDeckLedComponent(this.activeDeck.forwardButton);

            this.gainKnob = new Encoder({
                group: "[Master]",
                midi: [0xB0, 0x14],
                key: "gain",
            });
            this.balanceKnob = new Encoder({
                group: "[Master]",
                midi: [0xB0, 0x15],
                key: "balance",
            });
            this.headGainKnob = new Encoder({
                group: "[Master]",
                midi: [0xB0, 0x16],
                key: "headGain",
            });
            this.headMixKnob = new Encoder({
                group: "[Master]",
                midi: [0xB0, 0x17],
                key: "headMix",
            });

            // Navigation buttons
            this.downButton = new components.Button({
                group: "[Library]",
                midi: [0x90, 0x61],
                key: "MoveDown",
            });
            this.upButton = new components.Button({
                group: "[Library]",
                midi: [0x90, 0x60],
                key: "MoveUp",
            });

            // For the left and right arrow buttons the controller appears to
            // handle the LED itself, so we use inKey so as not to be sending
            // output that will never be used.
            this.leftButton = new components.Button({
                group: "[Library]",
                midi: [0x90, 0x62],
                inKey: "focused_widget",
                input: function (_channel, _control, value, _status, _group) {
                    const selected = this.inGetParameter();
                    switch (selected) {
                        case 2: {
                            // Tree View
                            engine.setParameter(this.group, "GoToItem", value);
                            break;
                        }
                        case 3: {
                            // Tracks, goto Tree View
                            this.inSetParameter(2);
                            break;
                        }
                    }
                },
            });
            this.rightButton = new components.Button({
                group: "[Library]",
                midi: [0x90, 0x63],
                inKey: "focused_widget",
                input: function (_channel, _control, value, _status, _group) {
                    const selected = this.inGetParameter();
                    switch (selected) {
                        case 2: {
                            // Tree View, goto Library
                            this.inSetParameter(3);
                            break;
                        }
                        case 3: {
                            // Tracks
                            engine.setParameter(this.group, "GoToItem", value);
                            break;
                        }
                    }
                },
            });
            this.recordButton = new components.Button({
                group: "[Recording]",
                midi: [0x90, 0x5F],
                inKey: "toggle_recording",
                outKey: "status",
            });
            this.deadColumn3Input = new components.Button({
                group: "[Channel1]",
                input: function () {},
            });
            this.deckLeftButton = new components.Button({
                type: components.Button.prototype.types.powerWindow,
                group: "[Channel1]",
                midi: [0x90, 0x2E], // << Channel Left Button
                inToggle: function () {
                    if (this.isLongPressed && SMCMixer.controller.isFourDeckMode()) {
                        SMCMixer.controller.setActiveDeck("[Channel3]", this);
                    } else {
                        SMCMixer.controller.setActiveDeck("[Channel1]", this);
                    }
                },
            });
            this.deckRightButton = new components.Button({
                type: components.Button.prototype.types.powerWindow,
                group: "[Channel2]",
                midi: [0x90, 0x2F], // >> Channel Right button
                inToggle: function () {
                    if (this.isLongPressed && SMCMixer.controller.isFourDeckMode()) {
                        SMCMixer.controller.setActiveDeck("[Channel4]", this);
                    } else {
                        SMCMixer.controller.setActiveDeck("[Channel2]", this);
                    }
                },
            });
            this.updateDeckLedVisibility();
            this.updateDeckSelectIndicatorLeds();
            this.lightAllColumnsOnLoad();
            // this.startBootLedTest();
        }

        getDeckMode() {
            if (this.deckMode === "four") {
                return 4;
            }
            if (this.deckMode === "two") {
                return 2;
            }
            const numDecks = engine.getValue("[App]", "num_decks");
            return numDecks >= 4 ? 4 : 2;
        }

        isFourDeckMode() {
            return this.getDeckMode() === 4;
        }

        setActiveDeck(group, pressedButton) {
            if (!this.isFourDeckMode()) {
                if (group === "[Channel3]") {
                    group = "[Channel1]";
                } else if (group === "[Channel4]") {
                    group = "[Channel2]";
                }
            }
            this.activeDeck.setCurrentDeck(group);
            this.updateDeckLedVisibility();
            this.updateDeckSelectIndicatorLeds();
        }

        setButtonLedFromMidi(button, value) {
            if (!button || !button.midi) {
                return;
            }
            midi.sendShortMsg(button.midi[0], button.midi[1], value);
        }

        updateDeckSelectIndicatorLeds() {
            if (this.isFourDeckMode()) {
                this.setButtonLedFromMidi(this.activeDeck.backButton, 0x00);
                this.setButtonLedFromMidi(this.activeDeck.forwardButton, 0x00);
                return;
            }
            const isDeck2 = this.activeDeck.currentDeck === "[Channel2]";
            this.setButtonLedFromMidi(this.activeDeck.backButton, isDeck2 ? 0x00 : 0x7F);
            this.setButtonLedFromMidi(this.activeDeck.forwardButton, isDeck2 ? 0x7F : 0x00);
        }

        lightAllColumnsOnLoad() {
            for (let control = 0x00; control <= 0x1F; control++) {
                midi.sendShortMsg(0x90, control, 0x00);
            }
            // In two-deck mode, Deck 1/2 EQ uses the 4th and 5th columns.
            for (let blockBase = 0x00; blockBase <= 0x18; blockBase += 0x08) {
                midi.sendShortMsg(0x90, blockBase + 0x03, 0x7F);
                midi.sendShortMsg(0x90, blockBase + 0x04, 0x7F);
            }
        }

        createDeckLedProbeCases(statusBytes) {
            const cases = [];
            for (const status of statusBytes) {
                for (const control of this.deckLedProbeControls) {
                    cases.push({status: status, control: control});
                }
            }
            return cases;
        }

        createControlRange(start, end) {
            const controls = [];
            for (let control = start; control <= end; control++) {
                controls.push(control);
            }
            return controls;
        }

        runDeckSwitchLedProbe(button) {
            if (!this.deckLedProbeEnabled) {
                return;
            }
            const caseCount = this.deckLedProbeCases.length;
            if (!caseCount) {
                return;
            }
            if (this.deckLedProbeLastCaseIndex >= 0) {
                const lastCase = this.deckLedProbeCases[this.deckLedProbeLastCaseIndex];
                if (lastCase) {
                    midi.sendShortMsg(lastCase.status, lastCase.control, 0x00);
                }
            }

            const caseIndex = ((this.deckLedProbeIndex % caseCount) + caseCount) % caseCount;
            const probeCase = this.deckLedProbeCases[caseIndex];
            if (!probeCase) {
                return;
            }
            midi.sendShortMsg(probeCase.status, probeCase.control, 0x7F);
            this.deckLedProbeLastCaseIndex = caseIndex;
            this.deckLedProbeIndex = (caseIndex + 1) % caseCount;

            const source = button === this.deckLeftButton ? "left" : "right";
            print(`[MVAVE LED PROBE] from=${source} status=0x${probeCase.status.toString(16)} control=0x${probeCase.control.toString(16)}`);
        }

        startBootLedTest() {
            if (!this.bootLedTestEnabled || !this.deckLedProbeCases.length) {
                return;
            }
            this.stopBootLedTest();
            this.deckLedProbeIndex = 0;
            this.deckLedProbeLastCaseIndex = -1;
            this.bootLedTestTimer = engine.beginTimer(this.bootLedTestIntervalMs, () => {
                if (this.deckLedProbeLastCaseIndex >= 0) {
                    const lastCase = this.deckLedProbeCases[this.deckLedProbeLastCaseIndex];
                    midi.sendShortMsg(lastCase.status, lastCase.control, 0x00);
                }

                if (this.deckLedProbeIndex >= this.deckLedProbeCases.length) {
                    this.stopBootLedTest();
                    this.updateDeckLedVisibility();
                    this.updateDeckSelectIndicatorLeds();
                    print("[MVAVE LED BOOT TEST] finished");
                    return;
                }

                const probeCase = this.deckLedProbeCases[this.deckLedProbeIndex];
                midi.sendShortMsg(probeCase.status, probeCase.control, 0x7F);
                this.deckLedProbeLastCaseIndex = this.deckLedProbeIndex;
                this.deckLedProbeIndex++;
                print(`[MVAVE LED BOOT TEST] status=0x${probeCase.status.toString(16)} control=0x${probeCase.control.toString(16)}`);
            });
        }

        stopBootLedTest() {
            if (this.bootLedTestTimer !== 0) {
                engine.stopTimer(this.bootLedTestTimer);
                this.bootLedTestTimer = 0;
            }
        }

        getChannelFromGroup(group) {
            if (typeof group !== "string") {
                return "";
            }
            const match = group.match(/\[Channel[1-4]\]/);
            if (!match) {
                return "";
            }
            return match[0];
        }

        isDeckComponentEnabled(component) {
            const componentDeck = this.getChannelFromGroup(component.group);
            if (!componentDeck) {
                return true;
            }
            if (this.isFourDeckMode()) {
                return true;
            }
            return componentDeck === "[Channel1]" || componentDeck === "[Channel2]";
        }

        registerDeckLedComponent(component) {
            if (!component || typeof component.output !== "function" || !component.midi) {
                return;
            }
            const controller = this;
            const originalOutput = component.output;
            component.output = function () {
                if (!controller.isDeckComponentEnabled(this)) {
                    midi.sendShortMsg(this.midi[0], this.midi[1], 0x00);
                    return;
                }
                return originalOutput.apply(this, arguments);
            };
            this.deckLedComponents.push(component);
        }

        updateDeckLedVisibility() {
            for (const component of this.deckLedComponents) {
                if (component.skipDeckStateRefresh) {
                    midi.sendShortMsg(component.midi[0], component.midi[1], 0x00);
                    continue;
                }
                if (!this.isDeckComponentEnabled(component)) {
                    midi.sendShortMsg(component.midi[0], component.midi[1], 0x00);
                    continue;
                }
                if (component.blinkTimer && component.blinkTimer !== 0) {
                    continue;
                }
                const outputKey = component.outKey || component.inKey || component.key;
                if (!outputKey) {
                    continue;
                }
                component.output(engine.getValue(component.group, outputKey));
            }
        }

        shutdown() {
            this.stopBootLedTest();
            this.setButtonLedFromMidi(this.activeDeck.backButton, 0x00);
            this.setButtonLedFromMidi(this.activeDeck.forwardButton, 0x00);
            if (this.deckLedProbeLastCaseIndex >= 0 && this.deckLedProbeCases.length) {
                const lastCase = this.deckLedProbeCases[this.deckLedProbeLastCaseIndex];
                midi.sendShortMsg(lastCase.status, lastCase.control, 0x00);
            }
            if (typeof super.shutdown === "function") {
                super.shutdown();
            }
        }
    }

    SMCMixer.init = function () {
        SMCMixer.controller = new Controller();
    };
    SMCMixer.setDeckLedProbeEnabled = function (enabled) {
        SMCMixer.controller.deckLedProbeEnabled = !!enabled;
    };
    SMCMixer.setDeckLedProbeStatus = function (status) {
        const statusByte = status & 0xFF;
        SMCMixer.controller.deckLedProbeCases = SMCMixer.controller.createDeckLedProbeCases([statusByte]);
        SMCMixer.controller.deckLedProbeIndex = 0;
        SMCMixer.controller.deckLedProbeLastCaseIndex = -1;
    };
    SMCMixer.shutdown = function () {
        SMCMixer.controller.shutdown();
    };
})(SMCMixer || (SMCMixer = {}));
