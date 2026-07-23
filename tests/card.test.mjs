import assert from "node:assert/strict";

const registry = new Map();

globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = {
      innerHTML: "",
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    return this.shadowRoot;
  }

  dispatchEvent() {
    return true;
  }
};

globalThis.CustomEvent = class {
  constructor(type, options) {
    this.type = type;
    Object.assign(this, options);
  }
};

globalThis.customElements = {
  define(name, implementation) {
    registry.set(name, implementation);
  },
  get(name) {
    return registry.get(name);
  },
};

globalThis.window = { customCards: [] };
globalThis.document = { createElement: (name) => ({ name }) };

await import("../cleaning-rotation-card.js");

const Card = customElements.get("cleaning-rotation-card");
const Editor = customElements.get("cleaning-rotation-card-editor");
assert.ok(Card, "card custom element is registered");
assert.ok(Editor, "editor custom element is registered");

const config = {
  type: "custom:cleaning-rotation-card",
  title: "House cleaning",
  start_date: "2026-07-01",
  people: [
    { id: "a", name: "A", icon: "mdi:broom", color: "#ffeb3b", icon_color: "#ff00ff", name_color: "#ffffff", countdown_color: "#00ff00", duration: 3 },
    { id: "b", name: "B", icon: "mdi:vacuum", color: "#2196f3", duration: 2 },
    { id: "c", name: "C", icon: "mdi:spray-bottle", color: "#f44336", duration: 5 },
  ],
};

const card = new Card();
card.setConfig(config);

let schedule = card._schedule(new Date(2026, 6, 1, 12));
assert.equal(schedule.totalDays, 10);
assert.equal(schedule.current.person.name, "A");
assert.equal(schedule.current.endsIn, 3);
assert.deepEqual(
  schedule.entries.map((entry) => [entry.person.name, entry.current, entry.startsIn]),
  [
    ["A", true, 0],
    ["B", false, 3],
    ["C", false, 5],
  ],
);

schedule = card._schedule(new Date(2026, 6, 4, 12));
assert.equal(schedule.current.person.name, "B");
assert.equal(schedule.current.endsIn, 2);
assert.deepEqual(schedule.entries.map((entry) => entry.person.name), ["B", "C", "A"]);

schedule = card._schedule(new Date(2026, 6, 11, 12));
assert.equal(schedule.current.person.name, "A", "rotation repeats after the complete cycle");

schedule = card._schedule(new Date(2026, 5, 29, 12));
assert.equal(schedule.current, null);
assert.deepEqual(schedule.entries.map((entry) => entry.startsIn), [2, 5, 7]);

card._render();
assert.match(card.shadowRoot.innerHTML, /House cleaning/);
assert.match(card.shadowRoot.innerHTML, /repeats every 10 days/);
assert.match(card.shadowRoot.innerHTML, /mdi:broom/);
assert.match(card.shadowRoot.innerHTML, /--person-text:#111111/, "every person row uses black text");
assert.match(card.shadowRoot.innerHTML, /--person-icon:#ff00ff/, "icon colour can be set independently");
assert.match(card.shadowRoot.innerHTML, /--person-name:#ffffff;--person-countdown:#00ff00/, "name and countdown colours can be set independently");
assert.match(card.shadowRoot.innerHTML, /\.rotation-row[^}]*font-weight: 700/, "every person row uses bold text");
assert.doesNotMatch(card.shadowRoot.innerHTML, /calendar\./i, "card has no Home Assistant calendar dependency");

const editor = new Editor();
editor.setConfig(config);
assert.match(editor.shadowRoot.innerHTML, /Rotation starts/);
assert.match(editor.shadowRoot.innerHTML, /Duration \(days\)/);
assert.match(editor.shadowRoot.innerHTML, /mdi:drag-vertical/);
assert.match(editor.shadowRoot.innerHTML, /data-person-icon-selector/, "visual editor uses Home Assistant icon suggestions");

const iconPickerListeners = {};
const iconPicker = {
  dataset: { personIconSelector: "0" },
  addEventListener(type, handler) {
    iconPickerListeners[type] = handler;
  },
};
editor.shadowRoot.querySelectorAll = (selector) => (selector === "[data-person-icon-selector]" ? [iconPicker] : []);
editor.shadowRoot.querySelector = () => null;
editor._attachEvents();
assert.deepEqual(iconPicker.selector, { icon: { placeholder: "mdi:broom" } });
assert.equal(iconPicker.value, "mdi:broom");
iconPickerListeners["value-changed"]({ stopPropagation() {}, detail: { value: "mdi:account" } });
assert.equal(editor._config.people[0].icon, "mdi:account", "icon suggestion selection updates the person");

editor._movePerson("c", "a");
assert.deepEqual(editor._config.people.map((person) => person.id), ["c", "a", "b"]);
editor._updatePerson(0, "duration", 0);
assert.equal(editor._config.people[0].duration, 1, "durations are always at least one day");
editor._updatePerson(0, "name_color", "#123456");
editor._updatePerson(0, "countdown_color", "#654321");
editor._updatePerson(0, "icon_color", "#abcdef");
assert.equal(editor._config.people[0].name_color, "#123456");
assert.equal(editor._config.people[0].countdown_color, "#654321");
assert.equal(editor._config.people[0].icon_color, "#abcdef");
editor._addPerson();
assert.equal(editor._config.people.length, 4);
editor._deletePerson(3);
assert.equal(editor._config.people.length, 3);

let hassRenders = 0;
const originalEditorRender = editor._render.bind(editor);
editor._render = () => {
  hassRenders += 1;
};
editor._hass = null;
editor.hass = { states: {} };
editor.hass = { states: { "sensor.unrelated": { state: "changed" } } };
assert.equal(hassRenders, 1, "frequent Home Assistant updates do not rebuild focused editor inputs");
editor._render = originalEditorRender;

const htmlBeforeFocusedUpdate = editor.shadowRoot.innerHTML;
editor.shadowRoot.activeElement = { matches: (selector) => selector.includes("ha-selector") };
editor.setConfig({ ...config, title: "Incoming Home Assistant update" });
assert.equal(
  editor.shadowRoot.innerHTML,
  htmlBeforeFocusedUpdate,
  "setConfig cannot replace an input while the user is typing",
);
assert.equal(editor._renderPending, true, "a safe redraw is queued until editing ends");
editor.shadowRoot.activeElement = null;
editor._render(true);
assert.match(editor.shadowRoot.innerHTML, /Incoming Home Assistant update/);

assert.equal(window.customCards[0].type, "cleaning-rotation-card");
console.log("All Cleaning Rotation Card tests passed.");
