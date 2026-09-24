# Architecture

Physical Music Vault is intentionally local-first and dependency-light. A Node.js service owns filesystem access, scheduling, search, verification, and persistence. A responsive browser client owns presentation and user input.

## Components

| Component | Responsibility |
| --- | --- |
| `vault-server.js` | HTTP API, same-origin mutation checks, scan and sync orchestration, private/public data boundary |
| `vault-sync.js` | Artist/album folder discovery, artwork discovery, and non-destructive catalogue reconciliation |
| `availability-scanner.js` | Search discovery, identity checks, seller-page verification, market filtering, shipping extraction, currency conversion |
| `web-search.js` | Free keyless search with optional self-hosted SearXNG support |
| `scan-plan.js` | Local-day queue selection, priority ordering, request accounting, and retry state |
| `catalog-model.js` | Catalogue invariants, money helpers, physical-source policy, and sorting |
| `vault-platform.js` | Atomic persistence, settings allowlist, artwork safety, and API response sanitisation |
| `vault-agent.js` | Background server supervision and local health reporting |
| `vault-toggle.js` | One-command Windows on/off lifecycle |
| `physical-music-vault.html` + `vault.css` + `assets/music-shelf.png` | Install-free browser application, responsive shelf interaction, and visual system |

## Data Flow

1. The sync worker reads the configured media folder and writes a temporary snapshot.
2. The server merges that snapshot into the latest vault so status, priority, budgets, and live scan results cannot be overwritten by a concurrent sync.
3. The daily planner selects only present Wanted albums, ordered by priority and least-recent scan. It records the active CD, vinyl, or cassette search while preserving daily request accounting when that format changes.
4. The scanner emits an IPC result after every album. The server atomically merges it immediately, so the dashboard updates during a batch rather than after it.
5. The public API strips local paths. Artwork is served only by album ID after validating that the resolved image remains inside that album's source folder.

## Listing Acceptance

A search result becomes a listing only when all of these checks pass:

1. Discogs independently matches the artist and release.
2. The final URL is a direct vendor or marketplace page, not a search, wiki, review, video, or digital-only store.
3. Product-page evidence matches the artist and album.
4. Product-page evidence names the selected physical format.
5. The page exposes a positive numeric price.
6. The page exposes Add To Cart, Add To Basket, Buy Now, or Buy It Now and is not marked unavailable.
7. When a country or region is selected, seller origin or delivery evidence matches that market.

Shipping uses structured `OfferShippingDetails` or explicit page text first. If a seller withholds the rate until checkout, the scanner stores a conservative estimate based on format and the inferred seller-to-destination distance. Exact, free, and estimated amounts are distinct data states; delivered totals combine item and shipping conversions without disguising estimates as seller quotes.

The policy favours precision over recall: uncertain pages are rejected.

## Persistence

Runtime files live beside the app by default and are ignored by Git. This includes market, destination, library, and catalogue preferences. Set `VAULT_DATA_DIR` to keep runtime data elsewhere and `MUSIC_ROOT` to select a library folder without using the local Settings control. JSON state is written through temporary files and atomic renames.

## Network Boundary

The service binds to `127.0.0.1` by default. Private-LAN binding is explicit and requires a restart. It does not install a proxy, modify DNS, edit the hosts file, create firewall rules, intercept browser traffic, or expose a webhook. Outbound traffic consists of ordinary HTTPS requests for search, verification, seller pages, and exchange rates.

## Test Strategy

`npm run verify` performs syntax checks and Node's test suite. Tests cover catalogue rules, daily planning, parsers, scanner evidence, sync reconciliation, public-data sanitisation, artwork containment, and a real temporary HTTP server journey. CI runs the same command on Windows with Node.js 20.
