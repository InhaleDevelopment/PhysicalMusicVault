# User Journeys

These are the release acceptance journeys for Physical Music Vault.

## First Start

1. The user double-clicks `outputs/Vault On-Off.cmd`.
2. Missing npm dependencies install on the first run only.
3. The local service starts and the dashboard opens.
4. A found music folder syncs immediately; a missing folder produces a clear System status without deleting browser data.

## Build The Watchlist

1. The Collection view shows the synced library with local cover artwork when available.
2. Search and format/status filters narrow large libraries without rendering the whole catalogue at once.
3. Wanted enters search selection; Owned and Not Interested stay out.
4. Priority 1-5 controls queue order. Priority 5 is the highest.
5. The editor sets physical format, minimum/maximum price, and AUD, USD, GBP, or EUR budget currency.
6. Changes update one album through the API and cannot overwrite a concurrent sync or scan.

## Find A Physical Release

1. The user selects Today's 500 or clicks Scan selected albums.
2. Up to 500 Wanted albums enter the local-day queue, priority 5 first.
3. The next batch starts without holding the browser request open.
4. The live banner shows the album currently being checked.
5. Each verified seller result appears as soon as that album finishes.
6. The seller link opens the final direct page, never a search redirect.

## Assess Results

1. Successful Matches Today shows newly discovered listings in local chronological order.
2. Top 100 Available Albums shows one current listing per Wanted album, priority first and recency second.
3. Priority 5 Matches remains visible while those listings continue to pass verification.
4. Every row contains album, artist, priority, converted price, seller link, local timestamp, and identity sources.
5. In-range and out-of-range notices remain visually distinct.

## Background Operation

1. The library watcher reacts to folder changes; a ten-minute reconciliation covers missed events.
2. Availability scans run every 30 minutes while automation is enabled.
3. The daily request ceiling resets in the browser-reported IANA timezone.
4. Temporary provider limits trigger a one-hour automatic cooldown; manual retry remains available.
5. The System view reports server, agent, sync, internet, scanner, result, and trusted-vendor health separately.

## Mobile Access

1. The user enables iPhone and iPad access on a trusted private network and restarts the vault.
2. The settings page displays the private-network URL.
3. The mobile layout uses a fixed bottom navigation, stacked result rows, touch-sized controls, and no horizontal overflow.
4. The Windows PC must remain on because it owns the files and background service.

## Backup And Migration

1. Settings provides CSV/JSON import, manual album entry, availability import, and vault export.
2. Personal runtime files are ignored by Git and never belong in a repository.
3. Clearing the hidden legacy browser cache does not clear server data.

## Failure Expectations

- A seller page that cannot prove identity, physical format, price, and purchase action is rejected.
- A digital-only store is rejected even when it says “CD quality.”
- A 403 from Discogs health checking is reported as reachable-but-blocked, not as loss of internet access.
- A failed search leaves existing availability unchanged.
- A synced album cannot be deleted from the dashboard; it can be marked Not Interested and will remain linked to the library.
