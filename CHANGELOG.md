# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Changed
- The card is now three grid rows high (at least 182 px outside the sections
  grid) instead of following its content, so the dashboard no longer jumps
  when a title changes between one and two lines. The volume row stays at
  the bottom.

## 1.1.0

### Changed
- The cover is no longer stretched to the card's width and cropped. It sits on
  the right in full height; the rest of the card takes the colour of the
  cover's left edge, blended with a gradient, and changes with every track.

## 1.0.0
Initial release: cover as full-card background, title, artist and album,
play/pause, previous/next and power next to the title, a thin progress line,
mute and a large touch-friendly volume slider.
