const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createHarness() {
    const midiMessages = [];
    const prints = [];
    const engineValues = new Map();
    const engineParameters = new Map();
    const timers = new Map();
    const stoppedTimers = [];
    let nextTimerId = 1;

    const keyFor = (group, key) => `${group}|${key}`;

    const engine = {
        beginTimer(interval, callback, oneShot) {
            const id = nextTimerId++;
            timers.set(id, {
                interval: interval,
                callback: callback,
                oneShot: !!oneShot,
            });
            return id;
        },
        stopTimer(timerId) {
            stoppedTimers.push(timerId);
            timers.delete(timerId);
        },
        setValue(group, key, value) {
            engineValues.set(keyFor(group, key), value);
        },
        getValue(group, key) {
            if (engineValues.has(keyFor(group, key))) {
                return engineValues.get(keyFor(group, key));
            }
            if (/^hotcue_\d+_position$/.test(key)) {
                return -1;
            }
            return 0;
        },
        setParameter(group, key, value) {
            engineParameters.set(keyFor(group, key), value);
        },
        getParameter(group, key) {
            return engineParameters.get(keyFor(group, key)) ?? 0;
        },
        softTakeover() {},
        makeConnection() {
            return {disconnect() {}};
        },
    };

    const midi = {
        sendShortMsg(status, control, value) {
            midiMessages.push({status: status, control: control, value: value});
        },
    };

    class ComponentContainer {
        constructor(params = {}) {
            Object.assign(this, params);
            this.connections = [];
        }
        shutdown() {}
    }

    class Button extends ComponentContainer {
        constructor(params = {}) {
            super(params);
            this.triggerOnRelease = params.triggerOnRelease !== undefined ? params.triggerOnRelease : true;
            this.longPressTimeout = params.longPressTimeout !== undefined ? params.longPressTimeout : 300;
            this.longPressTimer = 0;
            this.isLongPressed = false;
            if (!this.inKey && this.key) {
                this.inKey = this.key;
            }
        }

        isPress(_channel, _control, value, _status) {
            return value > 0;
        }

        inGetParameter() {
            const key = this.inKey || this.key || this.outKey;
            return engine.getValue(this.group, key);
        }

        inSetValue(value) {
            const key = this.inKey || this.key;
            engine.setValue(this.group, key, value);
        }

        inSetParameter(value) {
            const key = this.inKey || this.key;
            engine.setParameter(this.group, key, value);
        }

        inToggle() {
            const value = this.inGetParameter();
            this.inSetValue(value > 0 ? 0 : 0x1F);
        }

        trigger() {}

        output(value) {
            if (!this.midi) {
                return;
            }
            midi.sendShortMsg(this.midi[0], this.midi[1], value > 0 ? 0x7F : 0x00);
        }
    }
    Button.prototype.types = {
        toggle: "toggle",
        push: "push",
        powerWindow: "powerWindow",
    };

    class PlayButton extends Button {}
    class CueButton extends Button {}

    class Deck extends ComponentContainer {
        constructor() {
            super();
            this.currentDeck = "[Channel1]";
        }
        setCurrentDeck(group) {
            this.currentDeck = group;
            if (this.playButton) {
                this.playButton.group = group;
            }
            if (this.cueButton) {
                this.cueButton.group = group;
            }
            if (this.backButton) {
                this.backButton.group = group;
            }
            if (this.forwardButton) {
                this.forwardButton.group = group;
            }
        }
    }

    class Encoder extends ComponentContainer {
        constructor(params = {}) {
            super(params);
            if (!this.inKey && this.key) {
                this.inKey = this.key;
            }
        }
        inGetParameter() {
            return engine.getParameter(this.group, this.inKey);
        }
    }

    class Pot extends ComponentContainer {
        constructor(params = {}) {
            super(params);
            if (!this.inKey && this.key) {
                this.inKey = this.key;
            }
            if (!this.outKey) {
                this.outKey = this.inKey;
            }
        }
        inValueScale(value) {
            return value / 127;
        }
    }

    const context = {
        console: console,
        require: require,
        engine: engine,
        midi: midi,
        print(message) {
            prints.push(message);
        },
        components: {
            ComponentContainer: ComponentContainer,
            Deck: Deck,
            Button: Button,
            PlayButton: PlayButton,
            CueButton: CueButton,
            Encoder: Encoder,
            Pot: Pot,
        },
    };

    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, "MVave-SMC-Mixer-scripts.js"), "utf8");
    vm.runInContext(source, context, {filename: "MVave-SMC-Mixer-scripts.js"});
    context.SMCMixer.init();
    const controller = context.SMCMixer.controller;
    controller.stopBootLedTest();
    midiMessages.length = 0;
    prints.length = 0;

    return {
        context: context,
        engine: engine,
        midiMessages: midiMessages,
        prints: prints,
        timers: timers,
        stoppedTimers: stoppedTimers,
        controller: controller,
        runTimer(timerId) {
            const timer = timers.get(timerId);
            assert.ok(timer, `Timer ${timerId} must exist`);
            timer.callback();
            if (timer.oneShot) {
                timers.delete(timerId);
            }
        },
        runAllTimersOnce() {
            for (const timerId of [...timers.keys()]) {
                const timer = timers.get(timerId);
                if (!timer) {
                    continue;
                }
                timer.callback();
                if (timer.oneShot) {
                    timers.delete(timerId);
                }
            }
        },
    };
}

function pressAndRelease(button) {
    button.input(0, 0, 0x7F, button.midi ? button.midi[0] : 0x90, button.group);
    button.input(0, 0, 0x00, button.midi ? button.midi[0] : 0x90, button.group);
}

test("long-press on EQ button activates modal target and starts blinking", () => {
    const h = createHarness();
    const eqRack = h.controller.eqButtons[0];
    const button = eqRack.lowKillButton;

    button.input(0, 0, 0x7F, 0x90, button.group);
    const timerId = button.longPressTimer;
    h.runTimer(timerId);
    button.input(0, 0, 0x00, 0x90, button.group);

    assert.equal(eqRack.knob.group, button.group);
    assert.equal(eqRack.knob.inKey, "parameter1");
    assert.notEqual(button.blinkTimer, 0);
    assert.deepEqual(h.midiMessages[0], {status: button.midi[0], control: button.midi[1], value: 0x00});
});

test("second long-press on same EQ button disables modal mode and restores original target", () => {
    const h = createHarness();
    const eqRack = h.controller.eqButtons[0];
    const button = eqRack.lowKillButton;
    const originalGroup = eqRack.knob.group;
    const originalKey = eqRack.knob.inKey;

    button.input(0, 0, 0x7F, 0x90, button.group);
    h.runTimer(button.longPressTimer);
    button.input(0, 0, 0x00, 0x90, button.group);
    const blinkingTimerId = button.blinkTimer;

    h.engine.setValue(button.group, button.inKey, 0);
    button.input(0, 0, 0x7F, 0x90, button.group);
    h.runTimer(button.longPressTimer);
    button.input(0, 0, 0x00, 0x90, button.group);

    assert.equal(eqRack.knob.group, originalGroup);
    assert.equal(eqRack.knob.inKey, originalKey);
    assert.equal(button.blinkTimer, 0);
    assert.ok(h.stoppedTimers.includes(blinkingTimerId));
    assert.deepEqual(h.midiMessages[h.midiMessages.length - 1], {
        status: button.midi[0],
        control: button.midi[1],
        value: 0x00,
    });
});

test("activating a different modal button stops previous modal blinking", () => {
    const h = createHarness();
    const eqRack = h.controller.eqButtons[0];
    const low = eqRack.lowKillButton;
    const mid = eqRack.midKillButton;

    low.input(0, 0, 0x7F, 0x90, low.group);
    h.runTimer(low.longPressTimer);
    low.input(0, 0, 0x00, 0x90, low.group);
    const lowBlinkTimer = low.blinkTimer;
    assert.notEqual(lowBlinkTimer, 0);

    mid.input(0, 0, 0x7F, 0x90, mid.group);
    h.runTimer(mid.longPressTimer);
    mid.input(0, 0, 0x00, 0x90, mid.group);

    assert.equal(low.blinkTimer, 0);
    assert.ok(h.stoppedTimers.includes(lowBlinkTimer));
    assert.notEqual(mid.blinkTimer, 0);
    assert.equal(eqRack.knob.inKey, "parameter2");
});

test("short press on EQ button toggles parameter and does not start modal blinking", () => {
    const h = createHarness();
    const eqRack = h.controller.eqButtons[0];
    const button = eqRack.highKillButton;

    h.engine.setValue(button.group, button.inKey, 0);
    pressAndRelease(button);
    assert.equal(h.engine.getValue(button.group, button.inKey), 0x1F);
    assert.equal(button.blinkTimer, 0);

    pressAndRelease(button);
    assert.equal(h.engine.getValue(button.group, button.inKey), 0);
    assert.equal(button.blinkTimer, 0);
});

test("long-press quick effect button maps encoder to super1", () => {
    const h = createHarness();
    const eqRack = h.controller.eqButtons[0];
    const button = eqRack.quickEffectButton;

    button.input(0, 0, 0x7F, 0x90, button.group);
    h.runTimer(button.longPressTimer);
    button.input(0, 0, 0x00, 0x90, button.group);

    assert.equal(eqRack.knob.group, button.group);
    assert.equal(eqRack.knob.inKey, "super1");
    assert.notEqual(button.blinkTimer, 0);
});

test("utility columns follow baseline deck groups", () => {
    const h = createHarness();

    assert.equal(h.controller.slipButtons[0].group, "[Channel3]");
    assert.equal(h.controller.quantizeButtons[0].group, "[Channel3]");
    assert.equal(h.controller.keylockButtons[0].group, "[Channel3]");
    assert.equal(h.controller.pflButtons[0].group, "[Channel3]");
    assert.equal(h.controller.faders[4].group, "[Channel3]");

    assert.equal(h.controller.slipButtons[3].group, "[Channel4]");
    assert.equal(h.controller.quantizeButtons[3].group, "[Channel4]");
    assert.equal(h.controller.keylockButtons[3].group, "[Channel4]");
    assert.equal(h.controller.pflButtons[3].group, "[Channel4]");
    assert.equal(h.controller.faders[7].group, "[Channel4]");
});

test("two-deck utility sync buttons map to deck 1 and deck 2", () => {
    const h = createHarness();

    assert.equal(h.controller.syncButtons[0].group, "[Channel1]");
    assert.equal(h.controller.syncButtons[0].inKey, "sync_enabled");
    assert.equal(h.controller.syncButtons[0].midi[0], 0x90);
    assert.equal(h.controller.syncButtons[0].midi[1], 0x12);

    assert.equal(h.controller.syncButtons[1].group, "[Channel2]");
    assert.equal(h.controller.syncButtons[1].inKey, "sync_enabled");
    assert.equal(h.controller.syncButtons[1].midi[0], 0x90);
    assert.equal(h.controller.syncButtons[1].midi[1], 0x15);

    assert.equal(h.controller.keylockButtons[1].midi[1], 0x45);
});

test("two-deck mode remaps channel 3/4 requests back to channel 1/2", () => {
    const h = createHarness();
    h.controller.deckMode = "two";

    h.controller.setActiveDeck("[Channel3]");
    assert.equal(h.controller.activeDeck.currentDeck, "[Channel1]");

    h.controller.setActiveDeck("[Channel4]");
    assert.equal(h.controller.activeDeck.currentDeck, "[Channel2]");
});

test("deck buttons respect long-press only in four-deck mode", () => {
    const h = createHarness();

    h.controller.deckMode = "two";
    h.controller.deckLeftButton.isLongPressed = true;
    h.controller.deckLeftButton.inToggle();
    assert.equal(h.controller.activeDeck.currentDeck, "[Channel1]");

    h.controller.deckMode = "four";
    h.controller.deckLeftButton.isLongPressed = true;
    h.controller.deckLeftButton.inToggle();
    assert.equal(h.controller.activeDeck.currentDeck, "[Channel3]");
});

test("deck select indicator LEDs reflect active deck in two-deck mode", () => {
    const h = createHarness();
    const back = h.controller.activeDeck.backButton;
    const forward = h.controller.activeDeck.forwardButton;

    h.controller.deckMode = "two";
    h.controller.setActiveDeck("[Channel1]");
    assert.deepEqual(h.midiMessages.slice(-2), [
        {status: back.midi[0], control: back.midi[1], value: 0x7F},
        {status: forward.midi[0], control: forward.midi[1], value: 0x00},
    ]);

    h.controller.setActiveDeck("[Channel2]");
    assert.deepEqual(h.midiMessages.slice(-2), [
        {status: back.midi[0], control: back.midi[1], value: 0x00},
        {status: forward.midi[0], control: forward.midi[1], value: 0x7F},
    ]);
});

test("deck select indicator LEDs are turned off in four-deck mode", () => {
    const h = createHarness();
    const back = h.controller.activeDeck.backButton;
    const forward = h.controller.activeDeck.forwardButton;
    h.controller.deckMode = "four";

    h.controller.updateDeckSelectIndicatorLeds();

    assert.deepEqual(h.midiMessages.slice(-2), [
        {status: back.midi[0], control: back.midi[1], value: 0x00},
        {status: forward.midi[0], control: forward.midi[1], value: 0x00},
    ]);
});

test("beatjump back and forward buttons pulse corresponding engine controls", () => {
    const h = createHarness();
    const setCalls = [];
    const originalSetValue = h.engine.setValue;
    h.engine.setValue = (group, key, value) => {
        setCalls.push({group: group, key: key, value: value});
        originalSetValue(group, key, value);
    };

    const back = h.controller.activeDeck.backButton;
    const forward = h.controller.activeDeck.forwardButton;
    back.input(0, 0, 0x7F, 0x90, back.group);
    forward.input(0, 0, 0x7F, 0x90, forward.group);

    assert.deepEqual(setCalls, [
        {group: back.group, key: "beatjump_backward", value: 1},
        {group: back.group, key: "beatjump_backward", value: 0},
        {group: forward.group, key: "beatjump_forward", value: 1},
        {group: forward.group, key: "beatjump_forward", value: 0},
    ]);
});

test("hotcues and bottom-row FX buttons map to columns 1/2/7/8", () => {
    const h = createHarness();

    assert.equal(h.controller.hotcueButtons[0][0].midi[1], 0x11);
    assert.equal(h.controller.hotcueButtons[0][1].midi[1], 0x09);
    assert.equal(h.controller.fxButtons[0][0].midi[1], 0x18);
    assert.equal(h.controller.fxButtons[0][1].midi[1], 0x19);

    assert.equal(h.controller.hotcueButtons[1][0].midi[1], 0x16);
    assert.equal(h.controller.hotcueButtons[1][1].midi[1], 0x0E);
    assert.equal(h.controller.fxButtons[1][0].midi[1], 0x1E);
    assert.equal(h.controller.fxButtons[1][1].midi[1], 0x1F);
});

test("hotcue shortcut sets when empty and activates when already set", () => {
    const h = createHarness();
    const button = h.controller.hotcueButtons[0][0];
    const setCalls = [];
    const originalSetValue = h.engine.setValue;
    h.engine.setValue = (group, key, value) => {
        setCalls.push({group: group, key: key, value: value});
        originalSetValue(group, key, value);
    };

    h.engine.setValue(button.group, button.hotcuePositionKey, -1);
    pressAndRelease(button);
    h.engine.setValue(button.group, button.hotcuePositionKey, 123.45);
    pressAndRelease(button);

    const hotcueCalls = setCalls.filter((entry) => entry.key === "hotcue_1_set" || entry.key === "hotcue_1_activate");
    assert.deepEqual(hotcueCalls, [
        {group: button.group, key: "hotcue_1_set", value: 1},
        {group: button.group, key: "hotcue_1_set", value: 0},
        {group: button.group, key: "hotcue_1_activate", value: 1},
        {group: button.group, key: "hotcue_1_activate", value: 0},
    ]);
});

test("hotcue long press clears when set", () => {
    const h = createHarness();
    const button = h.controller.hotcueButtons[0][0];
    const setCalls = [];
    const originalSetValue = h.engine.setValue;
    h.engine.setValue = (group, key, value) => {
        setCalls.push({group: group, key: key, value: value});
        originalSetValue(group, key, value);
    };
    h.engine.setValue(button.group, button.hotcuePositionKey, 44.1);

    button.input(0, 0, 0x7F, 0x90, button.group);
    h.runTimer(button.longPressTimer);
    button.input(0, 0, 0x00, 0x90, button.group);

    const clearCalls = setCalls.filter((entry) => entry.key === "hotcue_1_clear");
    assert.deepEqual(clearCalls, [
        {group: button.group, key: "hotcue_1_clear", value: 1},
        {group: button.group, key: "hotcue_1_clear", value: 0},
    ]);
});

test("column FX buttons toggle effect unit button states", () => {
    const h = createHarness();
    const button1 = h.controller.fxButtons[1][0];
    const button2 = h.controller.fxButtons[1][1];
    assert.equal(h.engine.getValue("[EffectRack1_EffectUnit1]", "group_[Channel1]_enable"), 1);
    assert.equal(h.engine.getValue("[EffectRack1_EffectUnit2]", "group_[Channel2]_enable"), 1);

    button1.inToggle();
    button2.inToggle();
    assert.equal(h.engine.getValue(button1.group, button1.inKey), 0x1F);
    assert.equal(h.engine.getValue(button2.group, button2.inKey), 0x1F);

    button1.inToggle();
    button2.inToggle();
    assert.equal(h.engine.getValue(button1.group, button1.inKey), 0);
    assert.equal(h.engine.getValue(button2.group, button2.inKey), 0);
});

test("knobs 1/2/7/8 map to deck effect knobs", () => {
    const h = createHarness();
    assert.equal(h.controller.effectKnobs[0][0].midi[1], 0x10);
    assert.equal(h.controller.effectKnobs[0][1].midi[1], 0x11);
    assert.equal(h.controller.effectKnobs[1][0].midi[1], 0x16);
    assert.equal(h.controller.effectKnobs[1][1].midi[1], 0x17);
});

test("beatloop buttons output LED state from loop_enabled", () => {
    const h = createHarness();
    assert.equal(h.controller.loopButtons[0].outKey, "loop_enabled");
    assert.equal(h.controller.loopButtons[1].outKey, "loop_enabled");
    assert.equal(h.controller.loopHalveButtons[0].outKey, "loop_enabled");
    assert.equal(h.controller.loopHalveButtons[1].outKey, "loop_enabled");
});

test("active beatloop blinks LED and stops when loop is disabled", () => {
    const h = createHarness();
    const button = h.controller.loopHalveButtons[0];

    button.output(1);
    assert.notEqual(button.blinkTimer, 0);
    assert.deepEqual(h.midiMessages[h.midiMessages.length - 1], {
        status: button.midi[0],
        control: button.midi[1],
        value: 0x00,
    });

    h.runTimer(button.blinkTimer);
    assert.deepEqual(h.midiMessages[h.midiMessages.length - 1], {
        status: button.midi[0],
        control: button.midi[1],
        value: 0x7F,
    });

    const blinkTimerId = button.blinkTimer;
    button.output(0);
    assert.equal(button.blinkTimer, 0);
    assert.ok(h.stoppedTimers.includes(blinkTimerId));
    assert.deepEqual(h.midiMessages[h.midiMessages.length - 1], {
        status: button.midi[0],
        control: button.midi[1],
        value: 0x00,
    });
});

test("main loop button also blinks on active loop and stops on disable", () => {
    const h = createHarness();
    const button = h.controller.loopButtons[0];

    button.output(1);
    assert.notEqual(button.blinkTimer, 0);

    h.runTimer(button.blinkTimer);
    assert.deepEqual(h.midiMessages[h.midiMessages.length - 1], {
        status: button.midi[0],
        control: button.midi[1],
        value: 0x7F,
    });

    const blinkTimerId = button.blinkTimer;
    button.output(0);
    assert.equal(button.blinkTimer, 0);
    assert.ok(h.stoppedTimers.includes(blinkTimerId));
    assert.deepEqual(h.midiMessages[h.midiMessages.length - 1], {
        status: button.midi[0],
        control: button.midi[1],
        value: 0x00,
    });
});
