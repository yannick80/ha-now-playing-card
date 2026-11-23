# AGENTS.md – ha-now-playing-card

Media player card for Home Assistant (cover, title, controls, large volume
slider), distributed through HACS as a **Dashboard** (plugin) repository.

## Working agreement

- Work on a feature branch. Commit locally, never push. Push, tags on remotes
  and GitHub releases only on explicit request.
- Commit as the agent with the attribution trailers the session provides.
- Release = two commits: the change, then `vX.Y.Z -- <summary>` that bumps
  `VERSION` in `dist/now-playing-card.js` and moves the CHANGELOG entry from
  *Unreleased* to the new version. Annotated tag `vX.Y.Z` locally.
  The release workflow refuses a tag that does not match `VERSION`.
- Semver: feature = minor, fix = patch.
- TDD: every bug gets a regression test that fails on the old code (check it).
- Never claim "tested in Home Assistant" when only the node tests and the
  mocked preview ran.
- Keep the card small. It is meant to do less than mini-media-player.

## Project structure

```
dist/now-playing-card.js    the card (single file, no build step, no deps)
tests/card.test.mjs         node tests (vm + minimal DOM stub)
docs/preview.html           mocked ha-card + hass, all states, service log
                            (?readme cards only, ?en English, ?dark)
docs/render-previews.sh     renders docs/preview.png (en) and preview-de.png
.github/ISSUE_TEMPLATE/     bug report, feature request
hacs.json                   HACS metadata (filename, min. HA version)
.github/workflows/          validate.yml (HACS, syntax, tests), release.yml
README.md, CHANGELOG.md, LICENSE
```

## Card rules

- Whole file in `(function () { … })();`, syntax ≤ ES2019 (no `?.`, `??`,
  logical assignment, `.at()`, `replaceAll`, `#private`).
- Every `color-mix()` has a plain fallback declaration directly before it;
  no flex/grid `gap`, no `inset`.
- Registration guarded (`customElements.get`, `window.customCards` by type).
- Render errors are caught and shown in the card (`_safeUpdate`).
- Server/user strings only via `textContent`; icons are inline MDI paths.
- Buttons follow `supported_features`; nothing is shown that cannot work.
- Volume slider: Pointer Events with touch/mouse fallback, `touch-action:
  pan-y`. `pointerdown` only previews (it may become a scroll), moves send
  throttled `volume_set`, release sends the final value once. The user's
  value is kept until HA confirms it or 3 s pass.
- Cover: `<img>` in full height on the right, never `crossOrigin` on the
  visible image. Background colour = average of the left edge via a 16×16
  canvas; tainted canvas -> one CORS probe image -> neutral fallback. Colours
  are cached per URL and applied only if that URL is still the shown cover.
- Editor: load `ha-form` via `loadCardHelpers()` before use.

## Tests

`node --test tests/*.mjs`. Without Node, JavaScriptCore
(`/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`)
can run them with a shim for `node:test`, `assert` and `vm` (`$262.createRealm()`).
