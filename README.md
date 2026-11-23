# Now Playing Card

A compact Home Assistant media player card. It shows what is playing
(cover as full-card background, title, artist, album, player and source) and
has a **large volume slider** that is easy to hit on small displays.

It replaces the combination of the built-in `media-control` card and a `tile`
card with the `media-player-volume-slider` feature.

## What you get

- **Cover as background** of the whole card, darkened so the text stays readable.
  Without a cover the card uses your theme's normal colours.
- **Title, artist – album, player · source.** Long titles wrap onto a second line.
- **Play/pause, previous, next** next to the title. Buttons the player does not
  support are left out. A player that is off shows only a power button.
- **Progress** as a thin line along the bottom edge, no time display.
- **Large volume slider.** Tap anywhere to jump to that volume, or drag. Vertical
  swipes still scroll the page. The card keeps your value until Home Assistant
  confirms it, so the slider does not jump back. Arrow keys work too.
- **Mute button** and the current volume in percent.
- **Tap title or artist** to open the more-info dialog.
- **Visual editor**, English and German.
- **One JavaScript file, no dependencies**, works on old wall tablets.

## Installation

### HACS (custom repository)

1. HACS → ⋮ → *Custom repositories*
2. Repository: `https://github.com/yannick80/ha-now-playing-card`, type **Dashboard**
3. Install *Now Playing Card* and reload the browser.

### Manual

1. Copy `dist/now-playing-card.js` to `/config/www/`.
2. *Settings → Dashboards → ⋮ → Resources → Add resource*:
   URL `/local/now-playing-card.js?v=1.0.0`, type **JavaScript module**.
3. Reload the browser (clear the cache in the companion app).

## Usage

```yaml
type: custom:now-playing-card
entity: media_player.buro
```

Or search for "Now Playing" in the card picker.

## Options

| Option          | Default            | Description                          |
|-----------------|--------------------|--------------------------------------|
| `entity`        | –                  | The `media_player` entity (required) |
| `name`          | friendly name      | Name shown under the title           |
| `show_artwork`  | `true`             | Cover as card background             |
| `show_progress` | `true`             | Progress line at the bottom edge     |

In the sections view the card takes the full width (12 columns) and its height
follows the content.

## For developers

- The card is `dist/now-playing-card.js`, plain JavaScript, no build step.
- Tests: `node --test tests/*.mjs` (no npm dependencies).
- Visual check: serve the repository root (`python3 -m http.server`) and open
  `docs/preview.html`. It mocks `ha-card` and Home Assistant and logs every
  service call.
- Release: bump `VERSION` in the card and the CHANGELOG, tag `vX.Y.Z`, publish a
  GitHub release. The release workflow attaches the card file.

## License

MIT
