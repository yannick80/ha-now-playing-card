// Card tests: `node --test tests/*.mjs` – no npm dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const CARD_DIR = new URL("../dist/", import.meta.url);
const CARD_FILES = readdirSync(CARD_DIR).filter((f) => f.endsWith(".js"));
const SOURCE = readFileSync(new URL("now-playing-card.js", CARD_DIR), "utf8");

const ALL = 1 | 4 | 8 | 16 | 32 | 128 | 256 | 4096 | 16384;

// ------------------------------------------------------------ minimal DOM stub

class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.textContent = "";
    this.innerHTML = "";
    this.hidden = false;
    this.disabled = false;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.style = {};
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !set.has(c) : !!force;
        if (on) set.add(c); else set.delete(c);
        return on;
      },
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  getBoundingClientRect() { return { left: 100, width: 200, top: 0, height: 40 }; }
  setPointerCapture() {}
  fire(type, ev = {}) {
    const e = { preventDefault() {}, button: 0, pointerId: 1, ...ev };
    (this.listeners[type] || []).forEach((fn) => fn(e));
  }
}

class FakeRoot {
  constructor() { this._html = ""; this._els = {}; }
  set innerHTML(html) { this._html = html; this._els = {}; }
  get innerHTML() { return this._html; }
  querySelector(sel) {
    const found = sel.startsWith(".")
      ? new RegExp(`class="([^"]*\\s)?${sel.slice(1)}(\\s[^"]*)?"`).test(this._html)
      : this._html.includes(`<${sel}`);
    if (!found) return null;
    if (!this._els[sel]) this._els[sel] = new FakeEl(sel.replace(/^\./, "div"));
    return this._els[sel];
  }
}

function makeContext(extra = {}) {
  const registry = new Map();
  class HTMLElement {
    constructor() { this.dispatched = []; this.children = []; }
    attachShadow() { this.shadowRoot = new FakeRoot(); return this.shadowRoot; }
    dispatchEvent(ev) { this.dispatched.push(ev); return true; }
    appendChild(c) { this.children.push(c); return c; }
  }
  const ctx = {
    console: { info() {}, error(...a) { ctx.__errors.push(a); }, warn() {} },
    __errors: [],
    HTMLElement,
    PointerEvent: function PointerEvent() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    customElements: {
      get: (t) => registry.get(t),
      define: (t, c) => { if (registry.has(t)) throw new Error(`already defined: ${t}`); registry.set(t, c); },
      whenDefined: () => new Promise(() => {}), // ha-form never arrives in tests
    },
    document: { createElement: (t) => { const C = registry.get(t); return C ? new C() : new FakeEl(t); } },
    setInterval: () => 1,
    clearInterval: () => {},
    Intl, Date, Math, JSON, Number, String, Object, Array, Promise, Error, RegExp, Set, isNaN, parseFloat,
    ...extra,
  };
  ctx.window = ctx;
  return vm.createContext(ctx);
}

function loadCard() {
  const ctx = makeContext({ module: { exports: {} } });
  vm.runInContext(SOURCE, ctx, { filename: "now-playing-card.js" });
  return ctx;
}

// ------------------------------------------------------------ mock hass

function mkHass(entities, lang = "de") {
  const hass = {
    locale: { language: lang }, language: lang,
    states: {},
    calls: [],
    callService(domain, service, data) { hass.calls.push({ domain, service, data }); return Promise.resolve(); },
    formatEntityState: (s) => ({ off: "Aus", idle: "Untätig", unavailable: "Nicht verfügbar" })[s.state] || s.state,
  };
  for (const [id, [state, attributes]] of Object.entries(entities)) {
    hass.states[id] = { entity_id: id, state, attributes: { supported_features: ALL, ...attributes } };
  }
  return hass;
}

const PLAYING = {
  friendly_name: "Büro", volume_level: 0.35, is_volume_muted: false,
  media_title: "Song", media_artist: "Artist", media_album_name: "Album", app_name: "Spotify",
  media_duration: 200, media_position: 50, media_position_updated_at: new Date().toISOString(),
  entity_picture: "/api/media_player_proxy/media_player.buro?token=x",
};

function render(ctx, config, hass) {
  const Card = ctx.customElements.get("now-playing-card");
  const card = new Card();
  card.setConfig({ type: "custom:now-playing-card", ...config });
  card.hass = hass;
  return view(card);
}

function view(card) {
  const q = (s) => card.shadowRoot.querySelector(s);
  return {
    card,
    q,
    warning: q(".warning") && q(".warning").textContent,
    title: q(".title") && q(".title").textContent,
    artist: q(".artist") && q(".artist").textContent,
    meta: q(".meta") && q(".meta").textContent,
    hidden: (s) => q(s).hidden,
    pct: q(".pct") && q(".pct").textContent,
  };
}

// ------------------------------------------------------------ old WebViews

test("all card files evaluate as classic scripts in one shared context, twice", () => {
  const ctx = makeContext();
  for (let i = 0; i < 2; i++) {
    for (const f of CARD_FILES) {
      vm.runInContext(readFileSync(new URL(f, CARD_DIR), "utf8"), ctx, { filename: f });
    }
  }
  assert.ok(ctx.customElements.get("now-playing-card"));
  assert.ok(ctx.customElements.get("now-playing-card-editor"));
  assert.equal(ctx.window.customCards.filter((c) => c.type === "now-playing-card").length, 1);
});

test("source uses no syntax newer than ES2019", () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const forbidden = [
    [/\?\.(?!\d)/, "optional chaining ?."],
    [/\?\?/, "nullish coalescing ??"],
    [/(\|\||&&)=/, "logical assignment"],
    [/\.at\(/, ".at()"],
    [/\.replaceAll\(/, "replaceAll"],
    [/this\.#\w|^\s*(static\s+)?#\w+\s*[=(;]/m, "#private class members"],
  ];
  for (const [re, name] of forbidden) assert.doesNotMatch(code, re, `forbidden syntax: ${name}`);
});

test("whole file is wrapped in its own function scope", () => {
  const code = SOURCE.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "").trim();
  assert.match(code, /^\(function \(\) \{/);
  assert.match(code, /\}\)\(\);$/);
});

test("every color-mix() has a plain fallback declaration directly before it", () => {
  const lines = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").split("\n");
  let count = 0;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*([a-z-]+)\s*:.*color-mix\(/);
    if (!m) return;
    count++;
    const prev = lines.slice(0, i).reverse().find((l) => l.trim() !== "");
    assert.ok(prev && new RegExp(`^\\s*${m[1]}\\s*:`).test(prev) && !prev.includes("color-mix("),
      `no fallback before line ${i + 1}: ${line.trim()}`);
  });
  assert.ok(count > 0);
});

test("the card keeps a minimum height of three grid rows outside the sections grid too", () => {
  const root = SOURCE.match(/\n  \.root \{[^}]*\}/)[0];
  // 3 rows of 56 px + 2 gaps of 8 px = 184 px, minus the card's 1 px border top and bottom
  assert.match(root, /min-height: 182px;\n\s*min-height: calc\(3 \* var\(--row-height, 56px\) \+ 2 \* var\(--row-gap, 8px\) - 2 \* var\(--ha-card-border-width, 1px\)\);/);
});

test("CSS avoids flex/grid gap and inset", () => {
  assert.doesNotMatch(SOURCE, /^\s*(gap|inset)\s*:/m);
});

// ------------------------------------------------------------ config & hints

test("without an entity the card shows a hint; unknown entity too", () => {
  const ctx = loadCard();
  assert.equal(render(ctx, {}, mkHass({})).warning, "Kein Mediaplayer ausgewählt");
  assert.equal(render(ctx, { entity: "media_player.nope" }, mkHass({})).warning,
    "Mediaplayer nicht gefunden: media_player.nope");
  assert.equal(render(ctx, {}, mkHass({}, "en")).warning, "No media player selected");
});

test("non-media_player entities are rejected by setConfig", () => {
  const ctx = loadCard();
  const card = new (ctx.customElements.get("now-playing-card"))();
  assert.throws(() => card.setConfig({ entity: "light.kitchen" }), /media_player/);
});

test("card recovers from a hint once the entity appears", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro" }, mkHass({}));
  assert.ok(r.warning);
  r.card.hass = mkHass({ "media_player.buro": ["playing", PLAYING] });
  assert.equal(view(r.card).title, "Song");
});

// ------------------------------------------------------------ rendering

test("playing: title, artist – album, player · app, progress, controls, volume", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro" }, mkHass({ "media_player.buro": ["playing", PLAYING] }));
  assert.equal(r.title, "Song");
  assert.equal(r.artist, "Artist – Album");
  assert.equal(r.meta, "Büro · Spotify");
  assert.equal(r.hidden(".progress"), false);
  assert.match(r.q(".pfill").style.width, /^25(\.\d)?%$/);
  assert.equal(r.hidden(".prev"), false);
  assert.equal(r.hidden(".next"), false);
  assert.equal(r.hidden(".power"), true);
  assert.equal(r.q(".play").getAttribute("aria-label"), "Pause");
  assert.equal(r.hidden(".volume"), false);
  assert.equal(r.pct, "35 %");
  assert.equal(r.q(".sfill").style.width, "35%");
  assert.equal(r.q(".img").getAttribute("src"), PLAYING.entity_picture);
  assert.equal(r.hidden(".bg"), false);
  assert.ok(r.q(".root").classList.contains("art"), "light text on the cover");
});

test("custom name replaces the friendly name", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro", name: "Arbeitszimmer" },
    mkHass({ "media_player.buro": ["playing", PLAYING] }));
  assert.equal(r.meta, "Arbeitszimmer · Spotify");
});

test("show_artwork and show_progress can be switched off", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro", show_artwork: false, show_progress: false },
    mkHass({ "media_player.buro": ["playing", PLAYING] }));
  assert.equal(r.hidden(".bg"), true);
  assert.equal(r.q(".root").classList.contains("art"), false);
  assert.equal(r.hidden(".progress"), true);
});

test("off: name and state, only the power button, no volume", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro" },
    mkHass({ "media_player.buro": ["off", { ...PLAYING }] }));
  assert.equal(r.title, "Büro");
  assert.equal(r.artist, "Aus");
  assert.equal(r.hidden(".meta"), true);
  assert.equal(r.hidden(".power"), false);
  assert.equal(r.hidden(".play"), true);
  assert.equal(r.hidden(".prev"), true);
  assert.equal(r.hidden(".volume"), true);
  assert.equal(r.hidden(".progress"), true);
  assert.equal(r.hidden(".bg"), true, "no stale cover while off");
});

test("unavailable: no controls at all", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro" },
    mkHass({ "media_player.buro": ["unavailable", { friendly_name: "Büro" }] }));
  assert.equal(r.artist, "Nicht verfügbar");
  assert.equal(r.hidden(".controls"), true);
  assert.equal(r.hidden(".volume"), true);
});

test("idle without volume_level hides the slider but offers play", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro" },
    mkHass({ "media_player.buro": ["idle", { friendly_name: "Büro" }] }));
  assert.equal(r.q(".play").getAttribute("aria-label"), "Wiedergabe");
  assert.equal(r.hidden(".volume"), true);
});

test("buttons follow supported_features", () => {
  const ctx = loadCard();
  // radio: pause/stop/play and volume, no track skipping, no mute
  const r = render(ctx, { entity: "media_player.radio" },
    mkHass({ "media_player.radio": ["playing", { ...PLAYING, supported_features: 4 | 4096 | 16384 }] }));
  assert.equal(r.hidden(".prev"), true);
  assert.equal(r.hidden(".next"), true);
  assert.equal(r.hidden(".mute"), true);
  assert.equal(r.q(".play").getAttribute("aria-label"), "Stopp");
});

test("a broken cover falls back to the plain card", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro" }, mkHass({ "media_player.buro": ["playing", PLAYING] }));
  r.q(".img").fire("error");
  assert.equal(r.hidden(".bg"), true);
  assert.equal(r.q(".root").classList.contains("art"), false);
});

// ------------------------------------------------------------ cover colour

// canvas stub: getImageData returns `pixel` for every pixel, or throws (tainted)
function withCanvas(ctx, pixel) {
  const make = ctx.document.createElement;
  ctx.document.createElement = (t) => {
    if (t !== "canvas") return make(t);
    return {
      getContext: () => ({
        drawImage() {},
        getImageData(x, y, w, h) {
          if (!pixel) throw new Error("SecurityError: tainted canvas");
          const data = [];
          for (let i = 0; i < w * h; i++) data.push(...pixel);
          return { data };
        },
      }),
    };
  };
}

test("the background takes the colour of the cover's left edge once it has loaded", () => {
  const ctx = loadCard();
  withCanvas(ctx, [10, 20, 30, 255]);
  const r = render(ctx, { entity: "media_player.buro" }, mkHass({ "media_player.buro": ["playing", PLAYING] }));
  assert.equal(r.q(".bg").style.backgroundColor, undefined, "no colour before the cover has loaded");
  r.q(".img").fire("load");
  assert.equal(r.q(".bg").style.backgroundColor, "rgb(10, 20, 30)");
  assert.equal(r.q(".fade").style.backgroundImage, "linear-gradient(to right, rgb(10, 20, 30), rgba(10, 20, 30, 0))");
});

test("a new cover brings a new colour; a known cover gets it immediately", () => {
  const ctx = loadCard();
  withCanvas(ctx, [10, 20, 30, 255]);
  const r = render(ctx, { entity: "media_player.buro" }, mkHass({ "media_player.buro": ["playing", PLAYING] }));
  r.q(".img").fire("load");
  withCanvas(ctx, [200, 100, 50, 255]);
  r.card.hass = mkHass({ "media_player.buro": ["playing", { ...PLAYING, entity_picture: "/b.jpg" }] });
  assert.equal(r.q(".bg").style.backgroundColor, "rgb(10, 20, 30)", "old colour stays while the new cover loads");
  r.q(".img").fire("load");
  assert.equal(r.q(".bg").style.backgroundColor, "rgb(200, 100, 50)");
  r.card.hass = mkHass({ "media_player.buro": ["playing", PLAYING] });
  assert.equal(r.q(".bg").style.backgroundColor, "rgb(10, 20, 30)", "cached colour, no reload needed");
});

test("a late colour for a cover that is no longer shown is ignored", () => {
  const ctx = loadCard();
  const probes = [];
  const make = ctx.document.createElement;
  withCanvas(ctx, null); // tainted -> CORS probe
  const viaCanvas = ctx.document.createElement;
  ctx.document.createElement = (t) => { const el = viaCanvas(t); if (t === "img") probes.push(el); return el; };
  const r = render(ctx, { entity: "media_player.buro" }, mkHass({ "media_player.buro": ["playing", PLAYING] }));
  r.q(".img").fire("load");
  assert.equal(probes.length, 1);
  r.card.hass = mkHass({ "media_player.buro": ["playing", { ...PLAYING, entity_picture: "/b.jpg" }] });
  ctx.document.createElement = make;
  withCanvas(ctx, [1, 2, 3, 255]);
  probes[0].fire("load"); // colour of the old cover arrives late
  assert.equal(r.q(".bg").style.backgroundColor, undefined);
});

test("an unreadable cross-origin cover is retried with CORS, then falls back to neutral", () => {
  const ctx = loadCard();
  withCanvas(ctx, null);
  const probes = [];
  const viaCanvas = ctx.document.createElement;
  ctx.document.createElement = (t) => { const el = viaCanvas(t); if (t === "img") probes.push(el); return el; };
  const pic = "https://cdn.example.com/cover.jpg";
  const r = render(ctx, { entity: "media_player.buro" },
    mkHass({ "media_player.buro": ["playing", { ...PLAYING, entity_picture: pic }] }));
  r.q(".img").fire("load");
  assert.equal(probes.length, 1);
  assert.equal(probes[0].crossOrigin, "anonymous");
  assert.equal(probes[0].getAttribute("src"), pic);
  assert.equal(r.q(".img").crossOrigin, undefined, "the visible cover never needs CORS");
  probes[0].fire("error");
  assert.equal(r.q(".bg").style.backgroundColor, "");
  assert.equal(r.q(".fade").style.backgroundImage, "");
});

test("render errors are shown inside the card instead of throwing", () => {
  const ctx = loadCard();
  const hass = mkHass({});
  Object.defineProperty(hass, "states", { get() { throw new Error("boom"); } });
  const r = render(ctx, { entity: "media_player.buro" }, hass);
  assert.match(r.warning, /boom/);
  assert.ok(ctx.__errors.length > 0);
});

// ------------------------------------------------------------ actions

test("play/pause, prev, next, mute and power call the right services", () => {
  const ctx = loadCard();
  const hass = mkHass({ "media_player.buro": ["playing", PLAYING] });
  const r = render(ctx, { entity: "media_player.buro" }, hass);
  r.q(".play").fire("click");
  r.q(".prev").fire("click");
  r.q(".next").fire("click");
  r.q(".mute").fire("click");
  assert.deepEqual(hass.calls.map((c) => c.service),
    ["media_pause", "media_previous_track", "media_next_track", "volume_mute"]);
  assert.equal(hass.calls[3].data.is_volume_muted, true);
  assert.ok(hass.calls.every((c) => c.domain === "media_player" && c.data.entity_id === "media_player.buro"));

  const off = mkHass({ "media_player.buro": ["off", PLAYING] });
  r.card.hass = off;
  r.q(".power").fire("click");
  assert.equal(off.calls[0].service, "turn_on");
});

test("clicking title or artist opens more-info", () => {
  const ctx = loadCard();
  const r = render(ctx, { entity: "media_player.buro" }, mkHass({ "media_player.buro": ["playing", PLAYING] }));
  r.q(".info").fire("click");
  const ev = r.card.dispatched.find((e) => e.type === "hass-more-info");
  assert.ok(ev);
  assert.equal(ev.detail.entityId, "media_player.buro");
});

// ------------------------------------------------------------ volume slider

test("tap on the slider sets the volume at that position", () => {
  const ctx = loadCard();
  const hass = mkHass({ "media_player.buro": ["playing", PLAYING] });
  const r = render(ctx, { entity: "media_player.buro" }, hass);
  const s = r.q(".slider"); // left 100, width 200
  s.fire("pointerdown", { clientX: 250 });
  assert.equal(hass.calls.length, 0, "pointerdown alone must not send – it may become a scroll");
  assert.equal(r.q(".pct").textContent, "75 %");
  s.fire("pointerup", { clientX: 250 });
  assert.equal(hass.calls.length, 1);
  assert.equal(hass.calls[0].service, "volume_set");
  assert.equal(hass.calls[0].data.volume_level, 0.75);
});

test("dragging sends live updates and the final value once", () => {
  const ctx = loadCard();
  const hass = mkHass({ "media_player.buro": ["playing", PLAYING] });
  const r = render(ctx, { entity: "media_player.buro" }, hass);
  const s = r.q(".slider");
  s.fire("pointerdown", { clientX: 120 });
  s.fire("pointermove", { clientX: 400 }); // beyond the right edge
  s.fire("pointerup", { clientX: 400 });
  const vols = hass.calls.map((c) => c.data.volume_level);
  assert.deepEqual(vols, [1], "live value 1 already sent, no duplicate on release");
});

test("pointercancel (page scroll) reverts without sending", () => {
  const ctx = loadCard();
  const hass = mkHass({ "media_player.buro": ["playing", PLAYING] });
  const r = render(ctx, { entity: "media_player.buro" }, hass);
  const s = r.q(".slider");
  s.fire("pointerdown", { clientX: 280 });
  s.fire("pointercancel");
  assert.equal(hass.calls.length, 0);
  assert.equal(r.q(".pct").textContent, "35 %");
});

test("the user's value stays until Home Assistant confirms it", () => {
  const ctx = loadCard();
  const hass = mkHass({ "media_player.buro": ["playing", PLAYING] });
  const r = render(ctx, { entity: "media_player.buro" }, hass);
  const s = r.q(".slider");
  s.fire("pointerdown", { clientX: 200 });
  s.fire("pointerup", { clientX: 200 });
  r.card.hass = mkHass({ "media_player.buro": ["playing", PLAYING] }); // old value 0.35 still
  assert.equal(r.q(".pct").textContent, "50 %");
  r.card.hass = mkHass({ "media_player.buro": ["playing", { ...PLAYING, volume_level: 0.5 }] });
  r.card.hass = mkHass({ "media_player.buro": ["playing", { ...PLAYING, volume_level: 0.42 }] });
  assert.equal(r.q(".pct").textContent, "42 %", "after confirmation external changes show again");
});

test("arrow keys change the volume in 5 % steps", () => {
  const ctx = loadCard();
  const hass = mkHass({ "media_player.buro": ["playing", PLAYING] });
  const r = render(ctx, { entity: "media_player.buro" }, hass);
  r.q(".slider").fire("keydown", { key: "ArrowRight" });
  assert.equal(hass.calls[0].data.volume_level, 0.4);
  r.q(".slider").fire("keydown", { key: "Home" });
  assert.equal(hass.calls[1].data.volume_level, 0);
});

// ------------------------------------------------------------ sizes & stub

test("card provides sizes for sections and masonry", () => {
  const ctx = loadCard();
  const card = new (ctx.customElements.get("now-playing-card"))();
  assert.equal(typeof card.getCardSize(), "number");
  assert.equal(card.getGridOptions().columns, 12);
  assert.equal(card.getGridOptions().rows, 3, "fixed height, no jumping between tracks");
  assert.equal(card.getGridOptions().min_rows, 3);
});

test("getStubConfig prefers a playing media player and never throws", () => {
  const ctx = loadCard();
  const Card = ctx.customElements.get("now-playing-card");
  const hass = mkHass({ "media_player.a": ["off", {}], "media_player.b": ["playing", {}], "light.x": ["on", {}] });
  assert.equal(Card.getStubConfig(hass).entity, "media_player.b");
  assert.equal(Card.getStubConfig({}).entity, "");
  assert.equal(Card.getStubConfig(undefined).entity, "");
});

// ------------------------------------------------------------ editor

test("editor works while ha-form is not defined", () => {
  const ctx = loadCard();
  const editor = new (ctx.customElements.get("now-playing-card-editor"))();
  editor.hass = mkHass({});
  editor.setConfig({ type: "custom:now-playing-card", entity: "media_player.buro" });
  editor.connectedCallback();
  assert.equal(editor.children.length, 0);
});
