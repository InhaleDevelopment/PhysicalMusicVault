# Physical Music Vault

Physical Music Vault is a local-first dashboard that turns a digital music folder into a physical-release watchlist. It syncs artist and album folders, lets each user decide what is Wanted, Owned, or Not Interested, and links only to seller pages that can be verified as purchasable.

Version 3 is a dependency-light Node.js application with no account, cloud database, paid search API, or build step. Windows hosts the service; current desktop and mobile browsers provide the interface.

## Product Flow

1. Watch any configured `<Artist>/<Album>` music folder for changes and reconcile it every 10 minutes, or import a CSV/JSON catalogue.
2. Browse an artwork-first chronological shelf and open any cover into a focused album workspace.
3. Keep catalogue status separate from a 1-5 purchase priority, CD/vinyl/cassette target, and per-album delivered-price range.
4. Select up to 500 Wanted albums per local calendar day, highest priority first.
5. Search `Artist - Album buy`, optionally narrowed to a country or region, using a free keyless provider or self-hosted SearXNG.
6. Cross-check the artist and release against Discogs across every genre.
7. Accept a result only when the direct seller page proves the artist, album, selected format, numeric price, active purchase control, and any requested market restriction.
8. Extract a seller shipping rate where published; otherwise show a format- and distance-based estimate and keep it visibly labelled.
9. Show new finds, the Top 100 priority-ranked available albums, and all current priority 5 matches with item, delivery, and total prices.

Local album artwork is served through album IDs and never exposes its filesystem path to the browser.

Prices are converted among AUD, USD, GBP, and EUR using daily reference rates from the keyless [Frankfurter API](https://frankfurter.dev/).

## Windows Setup

1. Install Node.js 20 or newer, including npm.
2. Double-click `outputs/Vault On-Off.cmd`.
3. The first start installs the open-source parser dependency and opens `http://localhost:8787/`.
4. In Settings, point **Synced source folder** to the folder containing `<Artist>/<Album>` directories, or import a CSV/JSON catalogue.
5. Open an album cover, mark it Wanted, Owned, or Not Interested, then set priority, format, and delivered-price range.
6. In Settings, choose Worldwide, Country, or Region results and the country used for delivery calculations.
7. Enable **Automated availability scanning** when ready. The consent prompt explains that artist and album terms are sent to the selected search provider and matching seller pages are visited.
8. Select **Today's 500**, then use **Scan Next 25** or leave 30-minute automation enabled.

Double-click `Vault On-Off.cmd` again to stop the dashboard. The built-in provider needs no API key, account, card, or paid plan.

## Library Sources

- **Folder sync:** use any local or externally mounted folder organised as `<Artist>/<Album>`. Change it from Settings on the host PC or set the `MUSIC_ROOT` environment variable.
- **Catalogue import:** load CSV or JSON exported by a digital music service. Album and Artist are required; Album Artist, Genre, Year, Date Added, Format, and Artwork URL are optional.
- **Manual entry:** add an album directly when it is not represented in a folder or export.

The source path stays in the private local settings file and is never returned by the browser API or committed to Git.

## Search Providers

- **Built-in keyless search** is the default and works without configuration. It is best effort and may be temporarily rate-limited by the upstream service.
- **Self-hosted SearXNG** is optional. Set its URL in Settings when greater control and multiple search engines are needed.

Country and region modes require seller-location or delivery-coverage evidence. Worldwide mode does not restrict seller location. Delivery charges marked **site rate** come from seller-page structured or visible shipping data; **Est.** charges use conservative format and distance bands because many shops calculate the final rate only after an address is entered.

No search product can guarantee every item on the public internet. Shops may be unindexed, require a login, render only in a browser, or block automated access. The vault aims for broad indexed coverage and rejects results it cannot verify rather than presenting uncertain purchase links.

Known digital-only stores are excluded even when a page uses phrases such as “CD quality.” Indirect review, video, wiki, and search pages can help confirm identity but are never accepted as seller links.

## iPhone And iPad

Turn on **iPhone and iPad access** in Settings, turn the vault off and on once, then use the private-network URL shown in Settings. The PC and mobile device must be on the same trusted home network. Do not allow public-network access.

## Privacy

- Library data, preferences, scan history, and trusted vendors stay in ignored files under `outputs/`.
- Search requests contain artist, album, public market terms, and release-search terms only. Local paths and music-service account details are never sent.
- The browser reports its IANA timezone to the local server so daily queues and timestamps match the user's device.
- The app does not change Windows proxy, DNS, hosts, or firewall settings. It makes ordinary outbound HTTPS requests from Node.js.
- The server binds to localhost by default; private-network listening is opt-in.

No username, library path, API key, or personal catalogue is included in the repository.

## Listing Rules

A listing is accepted only when:

1. Discogs confirms the artist and release.
2. The seller page itself matches the artist and album.
3. The selected physical format is present.
4. A numeric price is present.
5. Add To Cart, Add To Basket, Buy Now, or Buy It Now is present.
6. Structured stock data does not mark the item unavailable.
7. A country or region restriction, when selected, is supported by seller origin or delivery evidence.

The displayed total is the item price plus a published shipping charge or a clearly labelled estimate converted into the user's budget currency. Final checkout tax, duties, and address-specific surcharges remain the seller's authority.

Accepted seller domains are stored locally as trusted vendors and prioritised in later scans. Search-result redirect URLs are never used as purchase links.

## Development

```powershell
npm install
npm run verify
npm start
```

Local data and settings are excluded by `.gitignore`. Before publishing, run `git status --ignored` and confirm that `vault-data.json`, `settings.json`, scan results, logs, and library exports are ignored.

See [Architecture](docs/ARCHITECTURE.md), [User Journeys](docs/USER-JOURNEYS.md), [Contributing](CONTRIBUTING.md), and [Security](SECURITY.md) before changing service boundaries or preparing a release.
