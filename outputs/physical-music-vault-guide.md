# Physical Music Vault Guide

Use `Vault On-Off.cmd` to turn the dashboard on or off. When it is on, open `http://localhost:8787/`.

## Free Scanner

1. Open **Settings** and leave **Built-in keyless search** selected.
2. Select **Select Today's 500** to prepare the daily queue.
3. Leave automation enabled, or select **Scan Next 25** for an immediate batch.

No API key or paid account is required. Advanced users may select **Self-hosted SearXNG** and enter their own local SearXNG URL.

## Daily Rules

- Safety cap: 500 albums per calendar day in the browser's timezone.
- Selection: Wanted albums ordered by priority 5 to 1, then least recently checked.
- Batch: 25 selected albums every 30 minutes while the vault is on.
- Sync: local folder changes trigger a sync; a 10-minute reconciliation catches anything the watcher misses.
- Privacy: public artist, album, format, and search terms leave the PC. Local paths and account data do not.

## Verification

Each album begins with:

```text
artist - album buy
```

Discogs and Encyclopedia Metallum are searched for identity evidence. A direct seller page is accepted only when it proves the release, selected physical format, numeric price, purchase control, and current stock state.

## Dashboard

- **Today's 500** shows the local-day workload and progress.
- **Successful Matches Today** shows newly verified direct listings.
- **Top 100 Available Albums** ranks current Wanted matches by priority and freshness.
- **Priority 5 Matches** keeps the most important available albums visible.
- **Search Vault** manages status, priority, format, and price range.
- **System Health** reports sync, search, verification, and vendor-learning status.
- **Settings** manages automation, local-network access, provider, and timezone.
