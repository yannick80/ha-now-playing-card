/**
 * Now Playing Card – a compact Home Assistant media player card: cover,
 * title, artist, playback controls and a large, touch-friendly volume slider.
 * https://github.com/yannick80/ha-now-playing-card
 *
 * Plain custom element, no build step and no dependencies.
 */

(function () {
"use strict";

const VERSION = "1.2.0";
const TAG = "now-playing-card";

// media_player supported_features bits
const F = {
  PAUSE: 1,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  STOP: 4096,
  PLAY: 16384,
};

// MDI icon paths (inline, so no ha-icon / icon set is needed)
const ICONS = {
  play: "M8,5.14V19.14L19,12.14L8,5.14Z",
  pause: "M14,19H18V5H14M6,19H10V5H6V19Z",
  stop: "M18,18H6V6H18V18Z",
  prev: "M6,18V6H8V18H6M9.5,12L18,6V18L9.5,12Z",
  next: "M16,18H18V6H16M6,18L14.5,12L6,6V18Z",
  power: "M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13",
  music: "M12,3V13.55C11.41,13.21 10.73,13 10,13A4,4 0 0,0 6,17A4,4 0 0,0 10,21A4,4 0 0,0 14,17V7H18V3H12Z",
  volume_high: "M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z",
  volume_off: "M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z",
};

const STRINGS = {
  en: {
    no_entity: "No media player selected",
    not_found: "Media player not found: {entity}",
    play: "Play",
    pause: "Pause",
    stop: "Stop",
    prev: "Previous track",
    next: "Next track",
    power: "Turn on",
    mute: "Mute",
    unmute: "Unmute",
    volume: "Volume",
    editor: {
      entity: "Media player",
      name: "Name (optional)",
      show_artwork: "Show cover",
      show_progress: "Show progress",
    },
  },
  de: {
    no_entity: "Kein Mediaplayer ausgewählt",
    not_found: "Mediaplayer nicht gefunden: {entity}",
    play: "Wiedergabe",
    pause: "Pause",
    stop: "Stopp",
    prev: "Vorheriger Titel",
    next: "Nächster Titel",
    power: "Einschalten",
    mute: "Stummschalten",
    unmute: "Ton an",
    volume: "Lautstärke",
    editor: {
      entity: "Mediaplayer",
      name: "Name (optional)",
      show_artwork: "Cover anzeigen",
      show_progress: "Fortschritt anzeigen",
    },
  },
};

const VOLUME_STEP = 0.05; // keyboard
const SEND_INTERVAL = 300; // ms between volume_set calls while dragging
const PENDING_TIMEOUT = 3000; // ms to keep the user's value if HA does not confirm it

function strings(hass) {
  const lang = (hass && hass.locale && hass.locale.language) || (hass && hass.language) || "en";
  return lang.toLowerCase().startsWith("de") ? STRINGS.de : STRINGS.en;
}

function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (values[k] !== undefined && values[k] !== null ? values[k] : ""));
}

function supports(stateObj, feature) {
  return ((stateObj.attributes.supported_features || 0) & feature) === feature;
}

function stateLabel(hass, stateObj) {
  try {
    if (hass.formatEntityState) return hass.formatEntityState(stateObj);
  } catch (e) {
    /* fall through */
  }
  return stateObj.state;
}

// Current position in seconds, extrapolated while playing
function mediaPosition(stateObj, now) {
  const a = stateObj.attributes;
  if (typeof a.media_position !== "number") return null;
  let pos = a.media_position;
  if (stateObj.state === "playing" && a.media_position_updated_at) {
    const t = Date.parse(a.media_position_updated_at);
    if (!isNaN(t)) pos += (now - t) / 1000;
  }
  if (typeof a.media_duration === "number" && a.media_duration > 0) pos = Math.min(pos, a.media_duration);
  return Math.max(0, pos);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function svg(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
}

// cover URL -> [r, g, b] of its left edge, shared by all cards
const COLOR_CACHE = {};
const COLOR_CACHE_MAX = 50;

function rememberColor(url, rgb) {
  if (!COLOR_CACHE[url]) {
    const keys = Object.keys(COLOR_CACHE);
    if (keys.length >= COLOR_CACHE_MAX) delete COLOR_CACHE[keys[0]];
  }
  COLOR_CACHE[url] = rgb;
}

// Average colour of the image's left edge, or null if it cannot be read
// (e.g. a cross-origin cover without CORS taints the canvas).
function edgeColor(img) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 2, 16).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
  } catch (e) {
    return null;
  }
}

const STYLE = `
  :host {
    display: block;
  }
  ha-card {
    position: relative;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }
  .bg {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    overflow: hidden;
    /* no transition: .fade's gradient cannot animate, the two must switch together */
    background-color: #333333;
  }
  /* Cover in full height on the right; the rest of the card takes the
     colour of the cover's left edge, and .fade blends the two. */
  .cover {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
  }
  .img {
    display: block;
    height: 100%;
    width: auto;
    max-width: none;
  }
  .fade {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -1px;
    width: 45%;
    background-image: linear-gradient(to right, #333333, rgba(51, 51, 51, 0));
  }
  .bg::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background: linear-gradient(to right, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.25));
  }
  /* Fixed height of 3 grid rows, so the card does not jump when a title
     changes between one and two lines; the volume row stays at the bottom. */
  .root {
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 182px;
    min-height: calc(3 * var(--row-height, 56px) + 2 * var(--row-gap, 8px) - 2 * var(--ha-card-border-width, 1px));
    padding: 12px;
    color: var(--primary-text-color, #212121);
  }
  .root.art {
    color: #ffffff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }
  .head {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
  }
  .info {
    flex: 1 1 auto;
    min-width: 0;
    border-radius: 6px;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }
  .info:focus-visible {
    box-shadow: 0 0 0 2px var(--primary-color);
  }
  .title {
    font-size: 16px;
    font-weight: 500;
    line-height: 22px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    word-break: break-word;
  }
  .artist,
  .meta {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--secondary-text-color, #727272);
  }
  .root.art .artist,
  .root.art .meta,
  .root.art .pct {
    color: rgba(255, 255, 255, 0.8);
  }
  .artist {
    font-size: 14px;
    line-height: 20px;
  }
  .meta {
    font-size: 12px;
    line-height: 18px;
  }
  .controls {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    margin-left: 8px;
  }
  .controls .btn {
    margin-left: 2px;
  }
  .btn {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }
  .btn svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
  }
  .root.art .btn:not(.main) svg {
    -webkit-filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .btn:focus-visible {
    box-shadow: 0 0 0 2px var(--primary-color);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn.main {
    width: 40px;
    height: 40px;
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #ffffff);
  }
  .btn.main svg {
    width: 26px;
    height: 26px;
  }
  @media (hover: hover) {
    .btn:not(.main):not(:disabled):hover {
      background: rgba(127, 127, 127, 0.2);
    }
  }
  .volume {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    margin-top: 10px;
  }
  .volume .btn {
    margin-right: 6px;
  }
  .slider {
    position: relative;
    flex: 1 1 auto;
    height: 40px;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    outline: none;
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    background: rgba(3, 169, 244, 0.2);
    background: color-mix(in srgb, var(--primary-color) 20%, transparent);
  }
  .root.art .slider {
    background: rgba(255, 255, 255, 0.25);
  }
  .slider:focus-visible {
    box-shadow: 0 0 0 2px var(--primary-color);
  }
  .sfill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0;
    background: var(--primary-color, #03a9f4);
    transition: width 0.2s ease-out;
  }
  .sfill::after {
    content: "";
    position: absolute;
    top: 12px;
    bottom: 12px;
    right: 6px;
    width: 4px;
    border-radius: 2px;
    background: var(--text-primary-color, #ffffff);
    opacity: 0.85;
  }
  .slider.dragging .sfill {
    transition: none;
  }
  .slider.muted .sfill {
    opacity: 0.45;
  }
  .slider.disabled {
    opacity: 0.4;
    cursor: default;
  }
  .pct {
    flex: 0 0 auto;
    width: 44px;
    margin-left: 6px;
    text-align: right;
    font-size: 14px;
    color: var(--secondary-text-color, #727272);
    font-variant-numeric: tabular-nums;
  }
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgba(127, 127, 127, 0.25);
    background: color-mix(in srgb, var(--primary-text-color) 15%, transparent);
  }
  .progress.art {
    background: rgba(255, 255, 255, 0.2);
  }
  .pfill {
    height: 100%;
    width: 0;
    background: var(--primary-color, #03a9f4);
  }
  [hidden] {
    display: none !important;
  }
`;

const TEMPLATE = `
<ha-card>
  <div class="bg" hidden><div class="cover"><img class="img" alt=""><div class="fade"></div></div></div>
  <div class="root">
    <div class="head">
      <div class="info" role="button" tabindex="0">
        <div class="title"></div>
        <div class="artist"></div>
        <div class="meta"></div>
      </div>
      <div class="controls">
        <button class="btn power" type="button">${svg(ICONS.power)}</button>
        <button class="btn prev" type="button">${svg(ICONS.prev)}</button>
        <button class="btn main play" type="button"></button>
        <button class="btn next" type="button">${svg(ICONS.next)}</button>
      </div>
    </div>
    <div class="volume">
      <button class="btn mute" type="button"></button>
      <div class="slider" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100"><div class="sfill"></div></div>
      <div class="pct"></div>
    </div>
  </div>
  <div class="progress"><div class="pfill"></div></div>
</ha-card>`;

const PARTS = ["bg", "img", "fade", "root", "info", "title", "artist", "meta", "controls", "power", "prev", "play", "next",
  "volume", "mute", "slider", "sfill", "pct", "progress", "pfill"];

class NowPlayingCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement(`${TAG}-editor`);
  }

  static getStubConfig(hass) {
    try {
      const states = (hass && hass.states) || {};
      const ids = Object.keys(states).filter((id) => id.indexOf("media_player.") === 0);
      const playing = ids.find((id) => states[id].state === "playing");
      return { entity: playing || ids[0] || "" };
    } catch (e) {
      console.error(`${TAG}: getStubConfig failed`, e);
      return { entity: "" };
    }
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._pending = null; // { v, ts } – volume the user set, until HA confirms it
    this._dragging = false;
    this._lastSend = 0;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.entity && String(config.entity).indexOf("media_player.") !== 0) {
      throw new Error("'entity' must be a media_player entity");
    }
    this._config = { ...config };
    this._pending = null;
    this._build();
    if (this._hass) this._safeUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._safeUpdate();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this._tick(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    // Fixed 3 rows: the content (two-line title + volume row) fits, and the
    // height does not change with the track
    return { columns: 12, min_columns: 6, rows: 3, min_rows: 3 };
  }

  _safeUpdate() {
    try {
      this._update();
    } catch (e) {
      console.error(`${TAG}: render failed`, e);
      this._showWarning(`${TAG}: ${(e && e.message) || e}`);
    }
  }

  // ------------------------------------------------------------------ build

  _build() {
    this._warning = false;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    const els = { card: this.shadowRoot.querySelector("ha-card") };
    PARTS.forEach((p) => {
      els[p] = this.shadowRoot.querySelector(`.${p}`);
    });
    this._els = els;

    els.info.addEventListener("click", () => this._moreInfo());
    els.info.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this._moreInfo();
      }
    });
    els.img.addEventListener("error", () => {
      this._imgFailed = els.img.getAttribute("src");
      this._safeUpdate();
    });
    els.img.addEventListener("load", () => this._pickColor(els.img.getAttribute("src")));
    els.power.addEventListener("click", () => this._call("turn_on"));
    els.prev.addEventListener("click", () => this._call("media_previous_track"));
    els.next.addEventListener("click", () => this._call("media_next_track"));
    els.play.addEventListener("click", () => {
      const service = { play: "media_play", pause: "media_pause", stop: "media_stop" }[this._playAction];
      if (service) this._call(service);
    });
    els.mute.addEventListener("click", () => {
      const st = this._stateObj();
      if (st) this._call("volume_mute", { is_volume_muted: !st.attributes.is_volume_muted });
    });
    this._wireSlider(els.slider);
  }

  _wireSlider(el) {
    const start = (x) => {
      if (this._volDisabled) return false;
      this._dragging = true;
      el.classList.add("dragging");
      this._setFromX(x, false); // show only – the page may still turn this into a scroll
      return true;
    };
    const move = (x) => {
      if (this._dragging) this._setFromX(x, true);
    };
    const end = (commit) => {
      if (!this._dragging) return;
      this._dragging = false;
      el.classList.remove("dragging");
      if (commit) {
        this._sendVolume();
      } else {
        this._pending = null;
        this._safeUpdate();
      }
    };

    if (window.PointerEvent) {
      el.addEventListener("pointerdown", (ev) => {
        if (ev.button > 0) return;
        if (start(ev.clientX)) {
          try {
            el.setPointerCapture(ev.pointerId);
          } catch (e) {
            /* ignore */
          }
        }
      });
      el.addEventListener("pointermove", (ev) => move(ev.clientX));
      el.addEventListener("pointerup", (ev) => {
        if (this._dragging) this._setFromX(ev.clientX, false);
        end(true);
      });
      el.addEventListener("pointercancel", () => end(false));
    } else {
      // Old WebViews without Pointer Events
      el.addEventListener("touchstart", (ev) => start(ev.touches[0].clientX), { passive: true });
      el.addEventListener("touchmove", (ev) => move(ev.touches[0].clientX), { passive: true });
      el.addEventListener("touchend", () => end(true));
      el.addEventListener("touchcancel", () => end(false));
      el.addEventListener("mousedown", (ev) => {
        if (!start(ev.clientX)) return;
        const mm = (e2) => move(e2.clientX);
        const mu = () => {
          window.removeEventListener("mousemove", mm);
          window.removeEventListener("mouseup", mu);
          end(true);
        };
        window.addEventListener("mousemove", mm);
        window.addEventListener("mouseup", mu);
      });
    }

    el.addEventListener("keydown", (ev) => {
      if (this._volDisabled) return;
      const cur = this._pending ? this._pending.v : this._volume;
      let v = null;
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") v = cur + VOLUME_STEP;
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") v = cur - VOLUME_STEP;
      else if (ev.key === "Home") v = 0;
      else if (ev.key === "End") v = 1;
      if (v === null) return;
      ev.preventDefault();
      this._pending = { v: Math.round(clamp01(v) * 100) / 100, ts: Date.now() };
      this._showVolume(this._pending.v);
      this._sendVolume();
    });
  }

  _setFromX(x, live) {
    const rect = this._els.slider.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const v = Math.round(clamp01((x - rect.left) / rect.width) * 100) / 100;
    this._pending = { v, ts: Date.now() };
    this._showVolume(v);
    if (live && Date.now() - this._lastSend >= SEND_INTERVAL) this._sendVolume();
  }

  _sendVolume() {
    if (!this._pending) return;
    const now = Date.now();
    this._pending.ts = now;
    if (this._pending.v === this._lastSentV && now - this._lastSend < PENDING_TIMEOUT) return;
    this._lastSend = now;
    this._lastSentV = this._pending.v;
    this._call("volume_set", { volume_level: this._pending.v });
  }

  _call(service, data) {
    if (!this._hass || !this._config || !this._config.entity) return;
    const p = this._hass.callService("media_player", service, { entity_id: this._config.entity, ...(data || {}) });
    if (p && p.catch) p.catch((e) => console.error(`${TAG}: ${service} failed`, e));
  }

  _moreInfo() {
    if (!this._config || !this._config.entity) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId: this._config.entity }, bubbles: true, composed: true,
    }));
  }

  _stateObj() {
    return this._hass && this._config && this._config.entity ? this._hass.states[this._config.entity] : undefined;
  }

  // ----------------------------------------------------------------- update

  _update() {
    if (this._warning) this._build();
    const hass = this._hass;
    const c = this._config;
    const t = strings(hass);
    if (!c.entity) {
      this._showWarning(t.no_entity);
      return;
    }
    const st = hass.states[c.entity];
    if (!st) {
      this._showWarning(fmt(t.not_found, { entity: c.entity }));
      return;
    }

    const e = this._els;
    const a = st.attributes || {};
    const state = st.state;
    const unavailable = state === "unavailable" || state === "unknown";
    const off = unavailable || state === "off";
    const name = c.name || a.friendly_name || c.entity;
    const hasMedia = !off && !!a.media_title;
    const source = a.app_name || a.source || "";

    // Text
    e.title.textContent = hasMedia ? a.media_title : name;
    e.artist.textContent = hasMedia
      ? [a.media_artist || a.media_series_title, a.media_album_name].filter(Boolean).join(" – ")
      : stateLabel(hass, st);
    e.meta.textContent = hasMedia ? [name, source].filter(Boolean).join(" · ") : off ? "" : source;
    e.artist.hidden = !e.artist.textContent;
    e.meta.hidden = !e.meta.textContent;

    // Cover as full-card background
    const pic = off || c.show_artwork === false ? "" : a.entity_picture_local || a.entity_picture || "";
    const url = pic && hass.hassUrl ? hass.hassUrl(pic) : pic;
    const art = !!url && url !== this._imgFailed;
    if (art && e.img.getAttribute("src") !== url) {
      e.img.setAttribute("src", url);
      // Known colour right away; otherwise the old one stays until the new cover has loaded
      if (COLOR_CACHE[url]) this._applyColor(url, COLOR_CACHE[url]);
    }
    e.bg.hidden = !art;
    e.root.classList.toggle("art", art);
    e.progress.classList.toggle("art", art);

    // Progress: thin line along the bottom edge
    const showProgress = c.show_progress !== false && hasMedia &&
      typeof a.media_duration === "number" && a.media_duration > 0 && typeof a.media_position === "number";
    e.progress.hidden = !showProgress;
    if (showProgress) this._renderProgress(st);

    // Controls
    let action = null;
    if (!off) {
      if (state === "playing" || state === "buffering") {
        if (supports(st, F.PAUSE)) action = "pause";
        else if (supports(st, F.STOP)) action = "stop";
      } else if (supports(st, F.PLAY)) {
        action = "play";
      }
    }
    this._playAction = action;
    e.play.hidden = !action;
    if (action) {
      this._icon(e.play, action);
      e.play.setAttribute("aria-label", t[action]);
    }
    e.power.hidden = !(state === "off" && supports(st, F.TURN_ON));
    e.prev.hidden = off || !supports(st, F.PREVIOUS_TRACK);
    e.next.hidden = off || !supports(st, F.NEXT_TRACK);
    e.power.setAttribute("aria-label", t.power);
    e.prev.setAttribute("aria-label", t.prev);
    e.next.setAttribute("aria-label", t.next);
    e.controls.hidden = e.power.hidden && e.prev.hidden && e.play.hidden && e.next.hidden;

    // Volume (hidden while off or unknown – a dead slider is just noise)
    e.volume.hidden = off || !supports(st, F.VOLUME_SET) || typeof a.volume_level !== "number";
    if (!e.volume.hidden) this._renderVolume(st, off, t);
  }

  _renderProgress(st) {
    const e = this._els;
    const dur = st.attributes.media_duration;
    const pos = mediaPosition(st, Date.now()) || 0;
    e.pfill.style.width = `${Math.round((pos / dur) * 1000) / 10}%`;
  }

  _renderVolume(st, off, t) {
    const e = this._els;
    const a = st.attributes;
    const known = typeof a.volume_level === "number";
    this._volume = known ? a.volume_level : 0;
    this._volDisabled = off || !known;

    if (this._pending && !this._dragging) {
      const confirmed = known && Math.abs(a.volume_level - this._pending.v) < 0.011;
      if (confirmed || Date.now() - this._pending.ts > PENDING_TIMEOUT) this._pending = null;
    }
    this._showVolume(this._pending ? this._pending.v : this._volume);

    const muted = !!a.is_volume_muted;
    e.slider.classList.toggle("disabled", this._volDisabled);
    e.slider.classList.toggle("muted", muted);
    e.slider.setAttribute("aria-disabled", String(this._volDisabled));
    e.slider.setAttribute("aria-label", t.volume);
    e.pct.hidden = this._volDisabled;

    e.mute.hidden = !supports(st, F.VOLUME_MUTE);
    e.mute.disabled = off;
    this._icon(e.mute, muted ? "volume_off" : "volume_high");
    e.mute.setAttribute("aria-label", muted ? t.unmute : t.mute);
  }

  _showVolume(v) {
    const pct = Math.round(v * 100);
    this._els.sfill.style.width = `${pct}%`;
    this._els.pct.textContent = `${pct} %`;
    this._els.slider.setAttribute("aria-valuenow", String(pct));
  }

  // Background colour from the cover's left edge, once the cover has loaded
  _pickColor(url) {
    if (!url || !this._els) return;
    const rgb = COLOR_CACHE[url] || edgeColor(this._els.img);
    if (rgb) {
      rememberColor(url, rgb);
      this._applyColor(url, rgb);
      return;
    }
    // Cross-origin cover: read a CORS copy; works only if its server allows it
    const probe = document.createElement("img");
    probe.crossOrigin = "anonymous";
    probe.addEventListener("load", () => {
      const c = edgeColor(probe);
      if (c) rememberColor(url, c);
      this._applyColor(url, c);
    });
    probe.addEventListener("error", () => this._applyColor(url, null));
    probe.setAttribute("src", url);
  }

  // rgb null = neutral fallback from the CSS
  _applyColor(url, rgb) {
    const e = this._els;
    if (!e || e.img.getAttribute("src") !== url) return; // cover changed meanwhile
    if (!rgb) {
      e.bg.style.backgroundColor = "";
      e.fade.style.backgroundImage = "";
      return;
    }
    const c = rgb.join(", ");
    e.bg.style.backgroundColor = `rgb(${c})`;
    e.fade.style.backgroundImage = `linear-gradient(to right, rgb(${c}), rgba(${c}, 0))`;
  }

  _icon(el, name) {
    if (el._icon === name) return;
    el.innerHTML = svg(ICONS[name]);
    el._icon = name;
  }

  _tick() {
    if (!this._hass || !this._config || !this._els || this._warning) return;
    const st = this._stateObj();
    if (!st) return;
    if (!this._els.progress.hidden && st.state === "playing") this._renderProgress(st);
    if (this._pending && !this._dragging && Date.now() - this._pending.ts > PENDING_TIMEOUT) this._safeUpdate();
  }

  _showWarning(text) {
    this._warning = true;
    this.shadowRoot.innerHTML = `<ha-card><div class="warning"></div></ha-card>
      <style>.warning{padding:12px 16px;color:var(--error-color,#db4437);}</style>`;
    this.shadowRoot.querySelector(".warning").textContent = text;
    this._els = null;
  }
}

// -------------------------------------------------------------------- editor

class NowPlayingCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _emit(config) {
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  connectedCallback() {
    this._ensureForm();
  }

  async _ensureForm() {
    if (customElements.get("ha-form")) return;
    // ha-form is loaded lazily by HA; loading the editor of a built-in card pulls it in.
    try {
      const helpers = await window.loadCardHelpers();
      const card = await helpers.createCardElement({ type: "button", entity: "sun.sun" });
      if (card && card.constructor && card.constructor.getConfigElement) {
        await card.constructor.getConfigElement();
      }
    } catch (e) {
      /* ignore – the form will appear once ha-form is defined */
    }
    await customElements.whenDefined("ha-form");
    this._render();
  }

  _schema() {
    return [
      { name: "entity", required: true, selector: { entity: { domain: "media_player" } } },
      { name: "name", selector: { text: {} } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "show_artwork", selector: { boolean: {} } },
          { name: "show_progress", selector: { boolean: {} } },
        ],
      },
    ];
  }

  _render() {
    if (!this._hass || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => strings(this._hass).editor[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { ...ev.detail.value };
        for (const k of Object.keys(config)) {
          if (config[k] === "" || config[k] === undefined) delete config[k];
        }
        this._config = config;
        this._emit(config);
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = { show_artwork: true, show_progress: true, ...this._config };
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, NowPlayingCard);
if (!customElements.get(`${TAG}-editor`)) customElements.define(`${TAG}-editor`, NowPlayingCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === TAG)) {
  window.customCards.push({
    type: TAG,
    name: "Now Playing Card",
    description: "Cover, title, playback controls and a large volume slider for a media player",
    preview: true,
    documentationURL: "https://github.com/yannick80/ha-now-playing-card",
  });
}

console.info(`%c ${TAG} %c ${VERSION} `, "color:#fff;background:#555;font-weight:700", "color:#555;background:#eee");

// Test hook: only active when evaluated with a CommonJS-style `module` (node tests)
if (typeof module !== "undefined" && module && module.exports) {
  module.exports = { NowPlayingCard: NowPlayingCard, NowPlayingCardEditor: NowPlayingCardEditor,
    mediaPosition: mediaPosition };
}
})();
