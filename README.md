# OpenTax Ledger

![Status](https://img.shields.io/badge/status-v0.2.0-blue)
![Privacy](https://img.shields.io/badge/privacy-browser--only-0f766e)
![Node](https://img.shields.io/badge/node-%3E%3D22.13.0-339933)
![License](https://img.shields.io/badge/license-AGPL--3.0--only-black)

**OpenTax Ledger** helps Indian Interactive Brokers users turn IBKR Activity
Statement CSV exports into CA-reviewable working papers for Indian income tax
return preparation.

It runs in the browser, keeps taxpayer files local, and exports draft schedules
and reconciliation checks. It does **not** log in to IBKR, ask for PAN or
Aadhaar, connect to the Income Tax Department portal, or file a return.

> This project is not tax advice. It prepares draft working papers for review
> by the taxpayer and a qualified Chartered Accountant.

## 🔗 Links

| Destination | Link |
| --- | --- |
| Live app | <https://vlkas.github.io/open-tax-ledger/> |
| Source repository | <https://github.com/VlKAS/open-tax-ledger> |
| Roadmap | [docs/roadmap.md](docs/roadmap.md) |
| Methodology | [docs/methodology.md](docs/methodology.md) |
| Data provenance | [docs/data-sources.md](docs/data-sources.md) |
| Threat model | [docs/threat-model.md](docs/threat-model.md) |

## ✨ What It Does

- 📄 Imports Interactive Brokers Activity Statement CSV files.
- 🧾 Creates draft Schedule CG, Schedule FA, Schedule FSI, and Schedule TR
  working papers.
- 🔎 Shows reconciliation checks for missing FX, unsupported instruments,
  transfers, duplicate rows, and review items.
- 🏦 Bundles a pinned community USD TT BUY reference table for exact-date lookup.
- 🏢 Enriches supported tickers with offline SEC EDGAR company, CIK, ticker, and
  exchange metadata.
- 🔒 Processes taxpayer CSV files locally in the browser.
- 🚀 Deploys as a static GitHub Pages app.

## 🚦 Supported Scope

Supported now:

- Listed foreign equities and ETFs held through IBKR.
- Stock trades, dividends, withholding tax, interest, open positions, transfers,
  and optional exchange-rate sections recognized by the current parser.
- Browser-only import, review, and export.
- Synthetic fixtures only in the repository and test suite.
- Static deployment through the checked-in GitHub Pages workflow.

Not supported yet:

- Direct ITR JSON generation or e-filing.
- PAN, Aadhaar, income tax portal login, AIS login, or IBKR login.
- Tax advice, return-position recommendations, or CA sign-off.
- Futures, options, crypto, bonds, mutual funds, margin interest, complex
  corporate actions, or multi-broker consolidation.
- XLSX exports.
- Automatic Rule 115 date selection or automatic INR conversion from the bundled
  USD TT BUY table.
- Live prices or a complete global security master.

## 🧭 How To Use

1. Download an IBKR Activity Statement CSV from Client Portal.
2. Open the [live app](https://vlkas.github.io/open-tax-ledger/) or run it
   locally.
3. Import the CSV in the browser.
4. Review parsed trades, dividends, taxes withheld, transfers, positions,
   offline company matches, and FX assumptions.
5. Determine the prescribed Rule 115 date with a qualified reviewer.
6. Use the exact-date USD TT BUY lookup and retain primary evidence for material
   dates. The app does not apply a prior-day fallback.
7. Export draft schedules and reconciliation checks.
8. Share the exported working papers with a CA.
9. Enter final CA-approved values in the official Income Tax Department utility
   or portal.

## 🧪 Quick Start For Developers

Prerequisites:

- Node.js `>=22.13.0`
- npm

Install locked dependencies:

```bash
npm ci
```

Run the app locally:

```bash
PORT=3001 npm run dev
```

Then open <http://localhost:3001/>.

Run parser and reference-data tests:

```bash
npm test
```

Run the full local release check:

```bash
npm run check
```

Build the static client:

```bash
npm run build
```

Regenerate checked-in reference assets after intentionally updating pinned
source snapshots:

```bash
npm run data:build
```

The command names are defined in [package.json](package.json).

## 🏦 Reference Data

OpenTax Ledger uses local reference data only. The browser does not call SBI,
SEC, market-data vendors, analytics providers, or project servers while
processing taxpayer statements.

### USD TT BUY table

The bundled USD table is derived from the community-maintained
[`sahilgupta/sbi-fx-ratekeeper`](https://github.com/sahilgupta/sbi-fx-ratekeeper)
repository and pinned to commit
`4cea84491ec53b80a5171463e51e04f667bcb6e5`.

Official context:

- [Income Tax Rule 115](https://www.incometaxindia.gov.in/w/rule-115-2)
- [Income Tax Rule 26 TT buying-rate definition](https://www.incometaxindia.gov.in/w/rule-26-8)
- [SBI current Forex Card Rates PDF](https://sbi.bank.in/documents/16012/1400784/FOREX_CARD_RATES.pdf)

Important caveats:

- SBI publishes a current mutable PDF, not an official historical CSV archive.
- The bundled table is a convenience reference, not an official SBI-published
  historical feed.
- Lookup is exact-date only. Missing dates and conflicting intraday observations
  remain review items.
- The app does not silently substitute RBI rates, broker rates, market rates, or
  prior-business-day values.
- The app does not automatically convert schedule values from the bundled table.

### Company metadata

Company metadata is bundled from the SEC EDGAR ticker and exchange associations
file:

- [SEC EDGAR data access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC reuse and fair-access guidance](https://www.sec.gov/about/webmaster-frequently-asked-questions)
- [SEC company ticker and exchange associations](https://www.sec.gov/files/company_tickers_exchange.json)

SEC ticker matches enrich display and audit fields only. They do not establish
issuer residence, instrument type, treaty eligibility, or tax treatment.

Dataset hashes, record counts, snapshot dates, and refresh rules are maintained
in [docs/data-sources.md](docs/data-sources.md) and
[reference-data/README.md](reference-data/README.md).

## 🔒 Privacy And Security

OpenTax Ledger is designed around local processing:

- Uploaded IBKR CSV files are parsed in the browser process.
- No taxpayer file should be sent to project maintainers.
- No server-side storage is used by the core workflow.
- No personal identifiers are required.
- Test data must be synthetic.

Do not enter or contribute PAN, Aadhaar, passport numbers, bank account numbers,
income tax portal credentials, IBKR credentials, real statements, screenshots,
tax forms, AIS files, Form 67 records, or CA workpapers.

Security reporting and private-data handling rules are in
[SECURITY.md](SECURITY.md). The detailed model is in
[docs/threat-model.md](docs/threat-model.md).

## 🚀 GitHub Pages Deployment

The workflow at
[`.github/workflows/pages.yml`](.github/workflows/pages.yml):

1. Installs dependencies with `npm ci`.
2. Runs `npm run check`.
3. Uploads `dist/client`.
4. Deploys the static site to the `github-pages` environment.

For a new repository, open **Settings → Pages** and set the publishing source to
**GitHub Actions**. The client uses relative asset paths, so it works at both a
user-site root and a project path such as
<https://vlkas.github.io/open-tax-ledger/>.

## 🤝 Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

Contribution rules:

- Use synthetic data only.
- Keep tax logic explainable and covered by tests.
- Add references for assumptions that depend on external forms, broker formats,
  or statutory guidance.
- Preserve browser-only processing unless a proposal explicitly changes the
  privacy model and updates the threat model.
- Prefer visible review warnings over hidden tax assumptions.

Before opening a pull request:

```bash
npm test
npm run check
```

## 📚 Official References

- [IBKR statement download guidance](https://www.ibkrguides.com/complianceportal/howtorunastatement.htm)
- [IBKR Activity Statement API documentation](https://www.interactivebrokers.com/docs/web-api/account-management/reporting/activity-statements)
- [Income Tax Department ITR utilities](https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns)
- [Income Tax Rule 115](https://www.incometaxindia.gov.in/w/rule-115-2)
- [Income Tax Rule 26 TT buying-rate definition](https://www.incometaxindia.gov.in/w/rule-26-8)
- [SBI current Forex Card Rates PDF](https://sbi.bank.in/documents/16012/1400784/FOREX_CARD_RATES.pdf)
- [SEC company ticker and exchange associations](https://www.sec.gov/files/company_tickers_exchange.json)
- [RBI Liberalised Remittance Scheme master direction](https://www.rbi.org.in/scripts/notificationuser.aspx?id=10192)

## ⚖️ License

Code is licensed under
[GNU Affero General Public License v3.0 only](https://www.gnu.org/licenses/agpl-3.0.en.html)
using the SPDX identifier `AGPL-3.0-only`.

Documentation under `docs/`, `README.md`, `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, and `SECURITY.md` is licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
unless a file states otherwise.

Bundled reference data retains its source-specific provenance and limitations.
See [docs/data-sources.md](docs/data-sources.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
