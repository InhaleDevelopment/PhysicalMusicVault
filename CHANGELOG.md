# Changelog

## 3.3.0 - 2026-09-24

### Added

- A tactile, image-backed music cabinet with responsive shelf rows and cover-forward interaction.
- A focused search launcher for CD, vinyl, or cassette with the exact query pattern visible before scanning.

### Changed

- Album and artist text now appears on shelf interaction rather than beneath every cover.
- Physical format is a scan-session choice instead of a Collection filter or per-album field.
- Switching search format prepares the new medium without resetting the daily request count.

## 3.2.0 - 2026-09-24

### Added

- Artwork-first music shelf with a centred album workspace that returns to the same shelf position.
- Explicit CD, vinyl, and cassette targets for each album.
- Worldwide, country, and regional seller-market controls with a configurable delivery destination.
- Seller-page shipping extraction, clearly labelled delivery estimates, and delivered-price totals.

### Changed

- Collection order defaults to newest added for a chronological browsing journey.
- Price-range decisions now use delivered totals when shipping data is available.
- Availability tables separate item price, delivery, and total cost.

### Privacy

- Market and delivery preferences remain in each user's ignored local settings file.
- No local username, source path, catalogue, or runtime scan data is included in the release.

## 3.1.0 - 2026-09-24

### Added

- Host-only source-folder configuration for any `<Artist>/<Album>` music library.
- Vendor-neutral CSV/JSON catalogue import guidance.

### Changed

- Release identity verification now uses Discogs across every music genre.
- Album artwork is center-cropped into stable square containers at every responsive breakpoint.
- Library sync language and health reporting are provider-neutral.

## 3.0.0 - 2026-09-24

### Added

- Responsive collection workspace with local album artwork and mobile bottom navigation.
- Live scan progress and per-album result delivery during a batch.
- Targeted album mutation endpoints that avoid full-vault overwrite races.
- Public/private data sanitisation and album-ID artwork serving.
- Temporary-server integration coverage for core catalogue journeys.
- Architecture, user journey, contribution, and security documentation.

### Changed

- Sync workers now produce temporary snapshots that the server merges into current state.
- Collection rendering is capped and progressively expanded for large libraries.
- Device timezone determines daily boundaries and regional currency defaults.
- Product-page evidence is scoped to seller content before a physical listing is accepted.
- System health treats active sync and scan work as healthy running states.

### Security

- Static serving is restricted to the dashboard and stylesheet; runtime JSON is never public.
- LAN responses no longer expose music roots, source paths, artwork paths, or agent log paths.
- Settings and album writes use explicit field allowlists.
- Digital-only storefronts and indirect content sites are excluded from physical results.

## 2.0.0

- Introduced free keyless search, strict direct-page verification, daily priority queues, trusted vendors, background sync, Windows agent controls, and system health reporting.
