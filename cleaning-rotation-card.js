/*
 * Cleaning Rotation Card for Home Assistant
 * Version 1.2.1
 *
 * A dependency-free repeating cleaning timetable stored entirely in the card configuration.
 */

const CARD_VERSION = "1.2.1";
const DAY_MS = 86_400_000;

const DEFAULTS = Object.freeze({
  title: "Cleaning timetable",
  start_date: "",
  people: [],
  show_cycle_summary: true,
  show_duration: true,
});

const SAMPLE_PEOPLE = Object.freeze([
  { id: "person-1", name: "Person 1", icon: "mdi:broom", color: "#ffeb3b", icon_color: "#111111", name_color: "#111111", countdown_color: "#111111", duration: 7 },
  { id: "person-2", name: "Person 2", icon: "mdi:vacuum", color: "#a9a9a9", icon_color: "#111111", name_color: "#111111", countdown_color: "#111111", duration: 7 },
  { id: "person-3", name: "Person 3", icon: "mdi:spray-bottle", color: "#f44336", icon_color: "#111111", name_color: "#111111", countdown_color: "#111111", duration: 7 },
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeColor(value, fallback = "#7c4dff") {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function safeIcon(value, fallback = "mdi:broom") {
  const icon = String(value || "").trim();
  return /^mdi:[a-z0-9-]+$/i.test(icon) ? icon : fallback;
}

function durationDays(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : 1;
}

function normalizePeople(people) {
  if (!Array.isArray(people)) return [];
  return people.map((person, index) => ({
    id: String(person?.id || `person-${index + 1}`),
    name: String(person?.name || `Person ${index + 1}`),
    icon: safeIcon(person?.icon),
    color: safeColor(person?.color),
    icon_color: safeColor(person?.icon_color, "#111111"),
    name_color: safeColor(person?.name_color, "#111111"),
    countdown_color: safeColor(person?.countdown_color, "#111111"),
    duration: durationDays(person?.duration),
  }));
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayNumberFromDate(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function dayNumberFromString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(stamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return Math.floor(stamp / DAY_MS);
}

class CleaningRotationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._midnightTimer = null;
  }

  static async getConfigElement() {
    return document.createElement("cleaning-rotation-card-editor");
  }

  static getStubConfig() {
    return {
      ...DEFAULTS,
      start_date: localDateString(),
      people: SAMPLE_PEOPLE.map((person) => ({ ...person })),
    };
  }

  setConfig(config) {
    this._config = {
      ...DEFAULTS,
      ...config,
      people: normalizePeople(config?.people),
    };
    this._render();
  }

  set hass(hass) {
    const firstUpdate = !this._hass;
    this._hass = hass;
    if (firstUpdate) this._render();
  }

  connectedCallback() {
    this._scheduleMidnightRefresh();
  }

  disconnectedCallback() {
    if (this._midnightTimer) globalThis.clearTimeout(this._midnightTimer);
    this._midnightTimer = null;
  }

  getCardSize() {
    return Math.max(2, Math.ceil(((this._config?.people?.length || 1) + 1) / 2));
  }

  getGridOptions() {
    return { columns: 12, min_columns: 5, rows: Math.max(3, this._config?.people?.length || 3) };
  }

  _scheduleMidnightRefresh() {
    if (this._midnightTimer) globalThis.clearTimeout(this._midnightTimer);
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 1, 0);
    this._midnightTimer = globalThis.setTimeout(() => {
      this._render();
      this._scheduleMidnightRefresh();
    }, Math.max(1_000, next.getTime() - now.getTime()));
  }

  _schedule(now = new Date()) {
    const people = normalizePeople(this._config?.people).filter((person) => person.name.trim());
    if (!people.length) return { entries: [], totalDays: 0, current: null };

    const today = dayNumberFromDate(now);
    const start = dayNumberFromString(this._config?.start_date) ?? today;
    const totalDays = people.reduce((sum, person) => sum + person.duration, 0);
    const offsets = [];
    let offset = 0;
    for (const person of people) {
      offsets.push(offset);
      offset += person.duration;
    }

    if (today < start) {
      const wait = start - today;
      return {
        totalDays,
        current: null,
        entries: people.map((person, index) => ({
          person,
          current: false,
          startsIn: wait + offsets[index],
          endsIn: null,
        })),
      };
    }

    const elapsed = today - start;
    const position = ((elapsed % totalDays) + totalDays) % totalDays;
    let currentIndex = people.length - 1;
    for (let index = 0; index < people.length; index += 1) {
      if (position >= offsets[index] && position < offsets[index] + people[index].duration) {
        currentIndex = index;
        break;
      }
    }

    const entries = [];
    for (let step = 0; step < people.length; step += 1) {
      const index = (currentIndex + step) % people.length;
      const person = people[index];
      if (step === 0) {
        entries.push({
          person,
          current: true,
          startsIn: 0,
          endsIn: offsets[index] + person.duration - position,
        });
      } else {
        let startsIn = offsets[index] - position;
        if (startsIn <= 0) startsIn += totalDays;
        entries.push({ person, current: false, startsIn, endsIn: null });
      }
    }

    return { totalDays, entries, current: entries[0] };
  }

  _relativeStart(days) {
    if (days <= 0) return "starts today";
    if (days === 1) return "starts tomorrow";
    return `starts in ${days} days`;
  }

  _relativeEnd(days) {
    if (days <= 0) return "ends today";
    if (days === 1) return "ends tomorrow";
    return `ends in ${days} days`;
  }

  _render() {
    if (!this.shadowRoot) return;
    if (!this._config) {
      this.shadowRoot.innerHTML = "";
      return;
    }

    const schedule = this._schedule();
    const title = this._config.title || "Cleaning timetable";
    const startDate = this._config.start_date || localDateString();

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="card-content">
          <header>
            <div class="title-icon"><ha-icon icon="mdi:calendar-sync-outline"></ha-icon></div>
            <div class="title-copy">
              <h2>${escapeHtml(title)}</h2>
              ${
                this._config.show_cycle_summary && schedule.totalDays
                  ? `<p>${schedule.entries.length} people · repeats every ${schedule.totalDays} days · from ${escapeHtml(startDate)}</p>`
                  : ""
              }
            </div>
          </header>
          <div class="rotation-list">
            ${schedule.entries
              .map(({ person, current, startsIn, endsIn }) => {
                const color = safeColor(person.color);
                const iconColor = safeColor(person.icon_color, "#111111");
                const nameColor = safeColor(person.name_color, "#111111");
                const countdownColor = safeColor(person.countdown_color, "#111111");
                return `<div class="rotation-row ${current ? "current" : ""}" style="--person-color:${color};--person-text:#111111;--person-icon:${iconColor};--person-name:${nameColor};--person-countdown:${countdownColor}">
                  <div class="person-icon"><ha-icon icon="${safeIcon(person.icon)}"></ha-icon></div>
                  <div class="person-copy">
                    <strong>${escapeHtml(person.name)}</strong>
                    <span>${escapeHtml(current ? this._relativeEnd(endsIn) : this._relativeStart(startsIn))}</span>
                  </div>
                  ${
                    this._config.show_duration
                      ? `<div class="duration">${person.duration} ${person.duration === 1 ? "day" : "days"}</div>`
                      : ""
                  }
                </div>`;
              })
              .join("")}
            ${
              schedule.entries.length
                ? ""
                : `<div class="empty"><ha-icon icon="mdi:account-plus-outline"></ha-icon><strong>Add people in the card editor</strong><span>No calendar is required.</span></div>`
            }
          </div>
        </div>
      </ha-card>
    `;
  }

  _styles() {
    return `
      :host { display: block; --rotation-accent: var(--primary-color, #7c4dff); }
      * { box-sizing: border-box; }
      ha-card { overflow: hidden; background: var(--ha-card-background, var(--card-background-color)); }
      .card-content { padding: 16px; }
      header { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
      .title-icon { flex: 0 0 auto; width: 42px; height: 42px; display: grid; place-items: center; border-radius: 13px; color: var(--rotation-accent); background: color-mix(in srgb, var(--rotation-accent) 18%, transparent); }
      .title-icon ha-icon { --mdc-icon-size: 24px; }
      .title-copy { min-width: 0; }
      h2 { margin: 0; color: var(--primary-text-color); font-size: 20px; line-height: 1.2; }
      .title-copy p { margin: 4px 0 0; color: var(--secondary-text-color); font-size: 11px; }
      .rotation-list { display: grid; gap: 8px; }
      .rotation-row { min-width: 0; min-height: 58px; display: flex; align-items: center; gap: 11px; padding: 9px 12px; border: 2px solid transparent; border-radius: 14px; color: var(--person-text); background: var(--person-color); box-shadow: 0 2px 10px #00000018; font-weight: 700; }
      .rotation-row.current { border-color: color-mix(in srgb, var(--person-text) 78%, transparent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--person-color) 35%, transparent), 0 5px 18px #00000028; }
      .person-icon { flex: 0 0 auto; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; color: var(--person-icon); background: color-mix(in srgb, var(--person-text) 12%, transparent); }
      .person-icon ha-icon { --mdc-icon-size: 21px; }
      .person-copy { min-width: 0; flex: 1; }
      .person-copy strong, .person-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .person-copy strong { color: var(--person-name); font-size: 14px; font-weight: 700; }
      .person-copy span { margin-top: 2px; color: var(--person-countdown); opacity: .82; font-size: 11px; font-weight: 700; }
      .duration { flex: 0 0 auto; padding: 5px 8px; border-radius: 999px; background: color-mix(in srgb, var(--person-text) 12%, transparent); font-size: 10px; font-weight: 700; }
      .empty { min-height: 130px; display: grid; place-items: center; align-content: center; gap: 5px; border: 1px dashed var(--divider-color); border-radius: 14px; color: var(--secondary-text-color); text-align: center; }
      .empty ha-icon { color: var(--rotation-accent); --mdc-icon-size: 30px; }
      .empty strong { color: var(--primary-text-color); font-size: 14px; }
      .empty span { font-size: 11px; }
      @media (max-width: 420px) {
        .card-content { padding: 12px; }
        .rotation-row { padding: 8px 10px; }
        .duration { display: none; }
      }
    `;
  }
}

class CleaningRotationCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULTS, people: [] };
    this._draggedId = null;
    this._renderPending = false;
    this.shadowRoot.addEventListener?.("focusout", () => {
      globalThis.setTimeout(() => {
        if (this._renderPending && !this._isEditing()) this._render(true);
      }, 0);
    });
  }

  _isEditing() {
    const activeElement = this.shadowRoot?.activeElement;
    return Boolean(activeElement?.matches?.("input, textarea, select, ha-selector, ha-icon-picker"));
  }

  set hass(hass) {
    const firstUpdate = !this._hass;
    this._hass = hass;
    if (firstUpdate) this._render();
  }

  setConfig(config) {
    this._config = {
      ...DEFAULTS,
      ...config,
      people: normalizePeople(config?.people),
    };
    this._render();
  }

  _emitConfig() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: { ...this._config, people: this._config.people.map((person) => ({ ...person })) } },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _updateConfigField(name, value) {
    this._config = { ...this._config, [name]: value };
    this._emitConfig();
    this._render();
  }

  _updatePerson(index, field, value) {
    const people = this._config.people.map((person, itemIndex) => {
      if (itemIndex !== index) return person;
      let normalized = value;
      if (field === "duration") normalized = durationDays(value);
      if (field === "color") normalized = safeColor(value);
      if (field === "icon_color" || field === "name_color" || field === "countdown_color") normalized = safeColor(value, "#111111");
      if (field === "icon") normalized = safeIcon(value);
      return { ...person, [field]: normalized };
    });
    this._config = { ...this._config, people };
    this._emitConfig();
    this._render();
  }

  _addPerson() {
    const index = this._config.people.length + 1;
    const palette = ["#ffeb3b", "#a9a9a9", "#f44336", "#2196f3", "#009688", "#9c27b0"];
    const person = {
      id: `person-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `Person ${index}`,
      icon: "mdi:broom",
      color: palette[(index - 1) % palette.length],
      icon_color: "#111111",
      name_color: "#111111",
      countdown_color: "#111111",
      duration: 7,
    };
    this._config = { ...this._config, people: [...this._config.people, person] };
    this._emitConfig();
    this._render();
  }

  _deletePerson(index) {
    this._config = {
      ...this._config,
      people: this._config.people.filter((_, itemIndex) => itemIndex !== index),
    };
    this._emitConfig();
    this._render();
  }

  _movePerson(sourceId, targetId, after = false) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const people = [...this._config.people];
    const sourceIndex = people.findIndex((person) => person.id === sourceId);
    if (sourceIndex < 0) return;
    const [person] = people.splice(sourceIndex, 1);
    const targetIndex = people.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) return;
    people.splice(targetIndex + (after ? 1 : 0), 0, person);
    this._config = { ...this._config, people };
    this._emitConfig();
    this._render();
  }

  _personEditor(person, index) {
    return `<div class="person-editor" data-person-row="${escapeHtml(person.id)}">
      <span class="drag" draggable="true" data-person-drag="${escapeHtml(person.id)}" title="Drag to change rotation order"><ha-icon icon="mdi:drag-vertical"></ha-icon></span>
      <span class="number">${index + 1}</span>
      <label class="field name-field"><span>Name</span><input data-person-index="${index}" data-person-field="name" value="${escapeHtml(person.name)}"></label>
      <div class="field icon-field"><ha-selector data-person-icon-selector="${index}"></ha-selector></div>
      <label class="field duration-field"><span>Duration (days)</span><input type="number" min="1" max="365" step="1" data-person-index="${index}" data-person-field="duration" value="${person.duration}"></label>
      <label class="field color-field"><span>Row colour</span><input type="color" data-person-index="${index}" data-person-field="color" value="${safeColor(person.color)}"></label>
      <label class="field icon-color-field"><span>Icon colour</span><input type="color" data-person-index="${index}" data-person-field="icon_color" value="${safeColor(person.icon_color, "#111111")}"></label>
      <label class="field name-color-field"><span>Name colour</span><input type="color" data-person-index="${index}" data-person-field="name_color" value="${safeColor(person.name_color, "#111111")}"></label>
      <label class="field countdown-color-field"><span>Countdown colour</span><input type="color" data-person-index="${index}" data-person-field="countdown_color" value="${safeColor(person.countdown_color, "#111111")}"></label>
      <button type="button" class="delete" data-delete-person="${index}" title="Delete ${escapeHtml(person.name)}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
    </div>`;
  }

  _render(force = false) {
    if (!this.shadowRoot) return;
    if (!force && this._isEditing()) {
      this._renderPending = true;
      return;
    }
    this._renderPending = false;
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="editor">
        <section>
          <h3>Timetable</h3>
          <label class="field"><span>Card title</span><input data-config-field="title" value="${escapeHtml(this._config.title)}"></label>
          <label class="field"><span>Rotation starts</span><input type="date" data-config-field="start_date" value="${escapeHtml(this._config.start_date || localDateString())}"></label>
          <div class="toggle-grid">
            ${this._toggle("show_cycle_summary", "Show cycle summary")}
            ${this._toggle("show_duration", "Show duration badges")}
          </div>
          <p class="hint">The first person starts on this date. After every person's duration, the rotation repeats automatically forever.</p>
        </section>
        <section>
          <div class="people-heading"><h3>People</h3><span>${this._config.people.length}</span></div>
          <div class="people-list">
            ${this._config.people.map((person, index) => this._personEditor(person, index)).join("")}
            ${this._config.people.length ? "" : `<div class="empty-editor">Add the first person to begin the rotation.</div>`}
          </div>
          <button type="button" class="add" data-add-person><ha-icon icon="mdi:plus"></ha-icon>Add person</button>
        </section>
      </div>
    `;
    this._attachEvents();
  }

  _toggle(name, label) {
    return `<label class="toggle-row"><span>${label}</span><span class="switch"><input type="checkbox" data-boolean-field="${name}" ${this._config[name] ? "checked" : ""}><i></i></span></label>`;
  }

  _attachEvents() {
    this.shadowRoot.querySelectorAll("[data-config-field]").forEach((field) => {
      field.addEventListener("change", () => this._updateConfigField(field.dataset.configField, field.value));
    });
    this.shadowRoot.querySelectorAll("[data-boolean-field]").forEach((field) => {
      field.addEventListener("change", () => this._updateConfigField(field.dataset.booleanField, field.checked));
    });
    this.shadowRoot.querySelectorAll("[data-person-field]").forEach((field) => {
      field.addEventListener("change", () =>
        this._updatePerson(Number(field.dataset.personIndex), field.dataset.personField, field.value),
      );
    });
    this.shadowRoot.querySelectorAll("[data-person-icon-selector]").forEach((picker) => {
      const index = Number(picker.dataset.personIconSelector);
      const currentValue = this._config.people[index]?.icon || "";
      picker.hass = this._hass;
      picker.selector = { icon: { placeholder: "mdi:broom" } };
      picker.value = currentValue;
      picker.label = "MDI icon";
      picker.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        const value = event.detail?.value;
        if (typeof value !== "string" || value === this._config.people[index]?.icon) return;
        this._updatePerson(index, "icon", value);
      });
    });
    this.shadowRoot.querySelector("[data-add-person]")?.addEventListener("click", () => this._addPerson());
    this.shadowRoot.querySelectorAll("[data-delete-person]").forEach((button) => {
      button.addEventListener("click", () => this._deletePerson(Number(button.dataset.deletePerson)));
    });

    const clearDrag = () => {
      this.shadowRoot.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((row) =>
        row.classList.remove("dragging", "drop-before", "drop-after"),
      );
    };
    this.shadowRoot.querySelectorAll("[data-person-drag]").forEach((handle) => {
      handle.addEventListener("dragstart", (event) => {
        this._draggedId = handle.dataset.personDrag;
        handle.closest(".person-editor")?.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", this._draggedId);
        }
      });
      handle.addEventListener("dragend", () => {
        this._draggedId = null;
        clearDrag();
      });
    });
    this.shadowRoot.querySelectorAll("[data-person-row]").forEach((row) => {
      row.addEventListener("dragover", (event) => {
        if (!this._draggedId) return;
        event.preventDefault();
        const bounds = row.getBoundingClientRect();
        const after = event.clientY > bounds.top + bounds.height / 2;
        row.classList.toggle("drop-before", !after);
        row.classList.toggle("drop-after", after);
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
      row.addEventListener("drop", (event) => {
        if (!this._draggedId) return;
        event.preventDefault();
        const bounds = row.getBoundingClientRect();
        const after = event.clientY > bounds.top + bounds.height / 2;
        const sourceId = this._draggedId;
        this._draggedId = null;
        clearDrag();
        this._movePerson(sourceId, row.dataset.personRow, after);
      });
    });
  }

  _styles() {
    return `
      :host { display: block; width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; contain: inline-size; container-type: inline-size; --editor-accent: var(--primary-color, #7c4dff); }
      * { box-sizing: border-box; }
      .editor { width: 100%; min-width: 0; display: grid; gap: 14px; overflow-x: hidden; color: var(--primary-text-color); }
      section { min-width: 0; padding: 14px; overflow: hidden; border: 1px solid var(--divider-color); border-radius: 14px; background: var(--card-background-color); }
      h3 { margin: 0; font-size: 16px; }
      .field { min-width: 0; display: grid; gap: 5px; margin-top: 10px; color: var(--secondary-text-color); font-size: 11px; }
      input { width: 100%; min-width: 0; padding: 9px; border: 1px solid var(--divider-color); border-radius: 9px; color: var(--primary-text-color); background: var(--secondary-background-color); font: inherit; }
      ha-selector { display: block; width: 100%; min-width: 0; }
      .hint { margin: 11px 0 0; color: var(--secondary-text-color); font-size: 10px; line-height: 1.4; }
      .toggle-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; margin-top: 10px; }
      .toggle-row { min-height: 38px; display: flex; align-items: center; gap: 8px; }
      .toggle-row > span:first-child { min-width: 0; flex: 1; color: var(--secondary-text-color); font-size: 11px; }
      .switch { position: relative; flex: 0 0 42px; width: 42px; height: 24px; }
      .switch input { position: absolute; opacity: 0; pointer-events: none; }
      .switch i { display: block; width: 42px; height: 24px; padding: 3px; border: 1px solid var(--divider-color); border-radius: 999px; background: var(--secondary-background-color); cursor: pointer; }
      .switch i::after { content: ""; display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--disabled-text-color); transition: transform .15s ease; }
      .switch input:checked + i { background: color-mix(in srgb, var(--editor-accent) 38%, var(--secondary-background-color)); }
      .switch input:checked + i::after { transform: translateX(17px); background: var(--editor-accent); }
      .people-heading { display: flex; align-items: center; justify-content: space-between; }
      .people-heading > span { min-width: 25px; padding: 4px 7px; border-radius: 999px; color: var(--editor-accent); background: color-mix(in srgb, var(--editor-accent) 16%, transparent); text-align: center; font-size: 10px; font-weight: 700; }
      .people-list { display: grid; gap: 9px; margin-top: 11px; }
      .person-editor { position: relative; min-width: 0; display: grid; grid-template-columns: 27px minmax(120px, 1.25fr) minmax(120px, 1fr) 100px repeat(4, 70px) 38px; gap: 7px; align-items: end; padding: 10px; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--secondary-background-color); }
      .person-editor.dragging { opacity: .42; }
      .person-editor.drop-before { box-shadow: inset 0 2px 0 var(--editor-accent); }
      .person-editor.drop-after { box-shadow: inset 0 -2px 0 var(--editor-accent); }
      .person-editor .field { margin-top: 0; }
      .drag { align-self: center; width: 27px; height: 38px; display: grid; place-items: center; color: var(--secondary-text-color); cursor: grab; user-select: none; }
      .drag:active { cursor: grabbing; }
      .drag ha-icon { pointer-events: none; --mdc-icon-size: 20px; }
      .number { position: absolute; left: 7px; top: 4px; color: var(--secondary-text-color); font-size: 8px; }
      .color-field input, .icon-color-field input, .name-color-field input, .countdown-color-field input { min-height: 38px; padding: 3px; cursor: pointer; }
      .delete { width: 38px; height: 38px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 9px; color: var(--error-color); background: color-mix(in srgb, var(--error-color) 11%, transparent); cursor: pointer; }
      .delete ha-icon { --mdc-icon-size: 19px; }
      .add { margin-top: 10px; padding: 9px 12px; display: flex; align-items: center; gap: 6px; border: 1px dashed var(--editor-accent); border-radius: 9px; color: var(--editor-accent); background: transparent; cursor: pointer; }
      .add ha-icon { --mdc-icon-size: 18px; }
      .empty-editor { padding: 22px; border: 1px dashed var(--divider-color); border-radius: 10px; color: var(--secondary-text-color); text-align: center; font-size: 11px; }
      @container (max-width: 760px) {
        .person-editor { grid-template-columns: 27px repeat(2, minmax(0, 1fr)); }
        .person-editor .name-field { grid-column: 2 / -1; }
        .person-editor .icon-field { grid-column: 2; }
        .person-editor .duration-field { grid-column: 3; }
        .person-editor .color-field { grid-column: 2; }
        .person-editor .icon-color-field { grid-column: 3; }
        .person-editor .name-color-field { grid-column: 2; }
        .person-editor .countdown-color-field { grid-column: 3; }
        .person-editor .delete { grid-column: 3; justify-self: end; }
      }
      @container (max-width: 360px) {
        .toggle-grid { grid-template-columns: 1fr; }
        .person-editor { grid-template-columns: 27px minmax(0, 1fr); }
        .person-editor .name-field, .person-editor .icon-field, .person-editor .duration-field, .person-editor .color-field, .person-editor .icon-color-field, .person-editor .name-color-field, .person-editor .countdown-color-field { grid-column: 2; }
        .person-editor .delete { grid-column: 2; }
      }
    `;
  }
}

if (!customElements.get("cleaning-rotation-card")) {
  customElements.define("cleaning-rotation-card", CleaningRotationCard);
}

if (!customElements.get("cleaning-rotation-card-editor")) {
  customElements.define("cleaning-rotation-card-editor", CleaningRotationCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "cleaning-rotation-card")) {
  window.customCards.push({
    type: "cleaning-rotation-card",
    name: "Cleaning Rotation",
    description: "A self-contained repeating cleaning timetable for people, with no calendar required",
    preview: true,
  });
}

console.info(
  `%c CLEANING-ROTATION-CARD %c v${CARD_VERSION} `,
  "color:white;background:#6c43d9;font-weight:700;padding:2px 5px;border-radius:4px 0 0 4px;",
  "color:#6c43d9;background:#eee8ff;font-weight:700;padding:2px 5px;border-radius:0 4px 4px 0;",
);
