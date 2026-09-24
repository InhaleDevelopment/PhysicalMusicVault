# Contributing

Thank you for helping make Physical Music Vault more useful and trustworthy.

## Development Setup

1. Install Node.js 20 or newer.
2. Run `npm ci`.
3. Run `npm run verify`.
4. Start the local app with `npm start`.

Use `VAULT_DATA_DIR` and `MUSIC_ROOT` when developing with synthetic fixtures. Never commit a real library, settings file, scan result, log, API key, or absolute user path.

## Change Principles

- Preserve the local-first architecture and zero-account default.
- Prefer strict listing verification over a larger but unreliable result count.
- Keep catalogue status separate from availability.
- Keep the default provider free and keyless; optional providers must remain optional.
- Make controls usable with keyboard, mouse, and touch.
- Test at 390px, 768px, and desktop widths with no horizontal page overflow.
- Do not add a build system or framework without a clear maintenance and user benefit.

## Pull Requests

Describe the user journey affected, the failure mode addressed, and the verification performed. Add or update tests whenever behaviour changes. `npm run verify` must pass before review.

For scanner changes, include fixtures for both an accepted physical seller page and a plausible rejection. Do not use personal seller history as a fixture.
