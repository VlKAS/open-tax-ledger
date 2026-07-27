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

When refreshing a source:

1. Download it from the recorded provider into the ignored `work/` directory.
2. Pin the community repository commit and calculate SHA-256 hashes.
3. Review licensing, field changes, record counts, and unexpected gaps.
4. Replace the appropriate snapshot and update `manifest.json` plus
   `docs/data-sources.md`.
5. Run `npm run data:build` and `npm run check`.

Never add taxpayer statements, derived taxpayer rows, account identifiers, or
generated tax workbooks to this directory.
