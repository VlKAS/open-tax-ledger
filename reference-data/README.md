# Reference Snapshots

This directory contains the exact offline inputs used to generate the app's
local reference modules.

- `sbi-usd-tt-buy-community.csv` is a normalized, pinned community table. It is
  not an official SBI archive.
- `sec-company-tickers-exchange.json` is the SEC-published snapshot identified
  in `manifest.json`.
- `manifest.json` records source URLs, hashes, dates, counts, and normalization
  rules.

The browser does not fetch these providers at runtime. `npm run data:build`
validates the source shapes, writes `lib/reference-data.generated.js`, and
copies the normalized USD CSV into `public/data/`. `npm run data:check` fails
when generated assets have drifted from the checked-in snapshots.

`npm run data:refresh` fetches both upstream sources, bounds their response
sizes, validates their schemas, rejects suspicious SBI coverage regression or a
large SEC row-count reduction, normalizes the snapshots, and updates the
manifest plus browser assets.

The scheduled workflow runs that command daily and opens a pull request only
when tracked reference data changes. It does not push changes directly to
`main`, and it never auto-merges the result.

When reviewing an automated or manual refresh:

1. Confirm the community SBI commit and SEC endpoint in `manifest.json`.
2. Review hashes, field changes, record counts, and unexpected coverage gaps.
3. Inspect representative row-level SBI evidence links.
4. Confirm `npm run check` passed before merging.

Never add taxpayer statements, derived taxpayer rows, account identifiers, or
generated tax workbooks to this directory.
