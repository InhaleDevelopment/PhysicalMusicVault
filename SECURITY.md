# Security Policy

## Supported Version

Security fixes target the latest release on the default branch.

## Reporting

Please report a suspected vulnerability privately through GitHub's security advisory feature. Do not include library exports, local paths, logs, seller history, or other personal data in a public issue.

## Security Model

- The server listens on localhost unless private-network access is explicitly enabled.
- Mutation endpoints enforce same-origin browser requests.
- Only the dashboard and its stylesheet are public static files. Runtime JSON, settings, logs, source code, and scan state are not web-accessible.
- Public API responses remove music roots, source paths, and artwork paths.
- Artwork requests resolve an album ID and verify the real image remains inside that album's source folder.
- Settings and album updates use field allowlists and bounded values.
- JSON state is written atomically.
- External URLs are used only for public search terms, identity checks, seller pages, and exchange-rate references.

Private-LAN mode does not include user accounts or TLS and is intended only for a trusted home network. Never expose port 8787 through a router, public reverse proxy, or untrusted Wi-Fi.

## Local Data

The files ignored in `.gitignore` can contain personal catalogue data and browsing targets. Before publishing a fork, run:

```powershell
git status --ignored
git grep -n -I -E "(C:\\\\Users|/Users/|api[_-]?key|vault-data)" -- . ":(exclude)package-lock.json"
```

Review staged changes manually before every release.
