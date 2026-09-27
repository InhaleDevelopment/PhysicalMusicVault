# User Journeys

These are the release acceptance journeys for Physical Music Vault.

## First Start

1. The user double-clicks `outputs/Vault On-Off.cmd`.
2. Missing npm dependencies install on the first run only.
3. The local service starts and the dashboard opens.
4. The default Music folder syncs immediately. The user can point Settings to any `<Artist>/<Album>` folder or import a CSV/JSON catalogue.

## Build The Watchlist

1. The Collection view combines the configured folder, imported catalogues, and manual entries, with local cover artwork when available.
2. Collection opens as an artist index: A–Z first, then 0–9 and Other. Selecting an initial shows every artist in that category and all of their albums on grouped shelf rows.
3. Every tile permanently displays `Album - Artist`. Selecting a cover opens the album in the centre of the screen; closing it restores the exact shelf position.
4. Wanted enters search selection; Owned and Not Interested stay out.
5. Priority 1-5 controls queue order. Priority 5 is the highest.
6. The album workspace sets minimum/maximum delivered price and AUD, USD, GBP, or EUR budget currency.
7. Changes update one album through the API and cannot overwrite a concurrent sync or scan.

## Find A Physical Release

1. The user selects Today's 500 or clicks Search wanted albums.
2. A focused launcher asks for CD, vinyl, or cassette and previews every exact query. CD runs one `cd` search; vinyl combines separate `vinyl` and `LP` searches; cassette combines separate `tape` and `cassette` searches.
3. Up to 500 Wanted albums enter the local-day queue, priority 5 first; switching format prepares new pending searches without resetting requests already used that day.
4. The next batch starts without holding the browser request open.
5. The live banner shows the album currently being checked.
6. Each verified seller result appears as soon as that album finishes.
7. The seller link opens the final direct page, never a search redirect.
8. Worldwide, country, or regional scope filters seller results using origin and delivery evidence.

## Assess Results

1. Successful Matches Today shows newly discovered listings in local chronological order.
2. Top 100 Available Albums shows one current listing per Wanted album, priority first and recency second.
3. Priority 5 Matches remains visible while those listings continue to pass verification.
4. Every row contains album, artist, format, priority, converted item price, delivery, delivered total, seller link, local timestamp, and identity sources.
5. In-range and out-of-range notices remain visually distinct.
6. Site shipping rates, free delivery, and estimates are labelled distinctly; the seller's checkout remains final.

## Use Intelligence

1. Price History records accepted seller prices automatically and charts the lowest delivered price per local day in the user's device currency.
2. Repeated unchanged observations are compacted to one seller price per day; a changed price is retained immediately.
3. Smart Collections save reusable combinations of status, availability, minimum priority, physical format, album budget, maximum delivered price, and listing recency.
4. Smart results update whenever the library, priorities, budgets, or verified listings change and can open the seller or begin a purchase record.
5. The Purchase Ledger records album, format, seller, item and delivery cost, currency, date, condition, order status, link, and notes.
6. Saving a purchase can mark its album Owned. The ledger converts paid totals into the device currency and compares them with the latest verified delivered price.
7. Price observations, rules, and purchase records remain in private ignored vault data and are never committed to Git.

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

1. Settings provides CSV/JSON import, manual album entry, availability import, and a vault export containing albums plus price history, smart collections, and purchases.
2. Personal runtime files are ignored by Git and never belong in a repository.
3. Clearing the hidden legacy browser cache does not clear server data.

## Failure Expectations

- A seller page that cannot prove identity, physical format, price, and purchase action is rejected.
- A digital-only store is rejected even when it says “CD quality.”
- A 403 from Discogs health checking is reported as reachable-but-blocked, not as loss of internet access.
- A failed search leaves existing availability unchanged.
- A synced album cannot be deleted from the dashboard; it can be marked Not Interested and will remain linked to the library.
