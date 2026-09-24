# Changelog

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
