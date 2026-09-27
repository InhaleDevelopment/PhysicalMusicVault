# Changelog

## 3.5.0 - 2026-09-27

### Added

- A normalized artist index ordered A–Z, then 0–9, with an Other category for remaining symbols.
- Artist-grouped shelf sections that reveal every album for the selected initial.
- Accent-insensitive categorization so names beginning with accented letters file under their base letter.

### Changed

- Reworked the visual skin into a tighter record-catalogue system with a persistent index, clearer hierarchy, and leaner Collection controls.
- Collection search now spans the full library while initial browsing remains fast and focused.
- Removed redundant Collection sorting and pagination; artist and album order is now naturally sorted within the selected category.

## 3.4.0 - 2026-09-24

### Changed

- Every Collection tile now permanently displays `Album - Artist` on the cover (for example, `Entity - 0`) instead of revealing metadata only on hover.
- Vinyl scans combine separate `vinyl buy` and `LP buy` searches.
- Cassette scans combine separate `tape buy` and `cassette buy` searches.
- Multi-query results are merged and deduplicated before Discogs identity and seller-page verification.

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
