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
  broker cash movements, duplicate rows, and review items.
- 🗓️ Derives supported Rule 115 and Rule 128 calendar dates automatically.
- 🏦 Uses a pinned community USD TT BUY table for reviewable INR previews,
  retaining the statutory date and showing when the latest published source
  observation on or before that date was used.
- 📊 Computes FIFO lot-matched capital-gain rows, STCG/LTCG ageing, foreign
  income, country-wise FTC candidates, and latest-statement holdings.
- 🧭 Adds an Audit tab with source/output row reconciliation, methodology,
  assumptions, provenance, and validation severity.
- 👀 Requires a schedule-and-audit preview before local downloads.
- 🧩 Builds a Schedule FA A3 portal CSV after review, with portal metadata
  entered once per security and lot-level INR rows generated locally.
- 🏢 Enriches supported tickers with offline SEC EDGAR company, CIK, ticker, and
  exchange metadata.
- 🔒 Processes taxpayer CSV files locally in the browser.
- 🚀 Deploys as a static GitHub Pages app.

## 🚦 Supported Scope

Supported now:

- Listed foreign equities and ETFs held through IBKR.
- Stock trades, dividends, withholding tax, interest, open positions, broker
  cash movements, securities transfers, and optional exchange-rate sections
  recognized by the current parser.
- Browser-only import, review, and export.
- Schedule FA A3 portal CSV preparation for supported securities, subject to
  manual portal validation and CA review.
- Synthetic fixtures only in the repository and test suite.
- Static deployment through the checked-in GitHub Pages workflow.

Not supported yet:

- Direct ITR JSON generation or e-filing.
- PAN, Aadhaar, income tax portal login, AIS login, or IBKR login.
- Tax advice, return-position recommendations, or CA sign-off.
- Futures, options, crypto, bonds, mutual funds, margin interest, complex
  corporate actions, or multi-broker consolidation.
- XLSX exports.
- Live prices or a complete global security master.

## 🧭 How To Use

1. Download an IBKR Activity Statement CSV from Client Portal.
2. Open the [live app](https://vlkas.github.io/open-tax-ledger/) or run it
   locally.
3. Import the CSV in the browser.
4. Confirm filing assumptions. The app derives supported Rule 115 specified
   dates and Rule 128 foreign-tax dates automatically.
5. Review the headline summary, FIFO lot rows, per-row INR preview, TT BUY
   evidence status, country-wise FTC candidates, and unresolved checks. Use the
   Audit tab to reconcile accepted source rows against generated CG, FSI, TR,
   and FA working-paper rows.
6. Retain primary SBI evidence for material dates. The app keeps the Rule 115
   or Rule 128 prescribed date visible; if the community archive has no row on
   that date, it may use the latest published observation on or before that date
   within the configured review window and marks that evidence status.
7. If you need Schedule FA A3 portal import, complete the entity metadata in
   Step 4 and download the portal CSV after the review gate is satisfied.
8. Export draft schedules and reconciliation checks.
9. Share the exported working papers with a CA.
10. Enter or import final CA-approved values in the official Income Tax
    Department utility or portal.

## 🧩 Schedule FA A3 Portal CSV

The Schedule FA A3 CSV is a browser-local import aid for the official Income Tax
Department portal. It is not an ITR JSON file, does not connect to the portal,
and does not file anything automatically.

Workflow:

1. Import the IBKR Activity Statement CSV and complete the review preview first.
   Downloads stay locked until you confirm the generated schedules and audit
   checks.
2. In Step 4, fill portal-ready metadata once per security:
   `Country/Region name`, `Country Name and Code`, `Name of entity`,
   `Address of entity`, `ZIP Code`, and `Nature of entity`.
3. Keep the address and ZIP fields aligned with the portal's current limits:
   address line up to 35 characters and ZIP Code up to 8 characters. Use the
   portal-ready entity address and shorten it only when the portal limit
   requires it.
4. Download `opentax-ledger-schedule-fa-a3.csv`. The file is generated locally
   from browser memory and is not uploaded by OpenTax Ledger.

The CSV creates one row per Schedule FA A3 acquisition lot. Each row carries the
lot acquisition date, initial value, peak value, closing balance, gross
paid/credited amount, and sale/redemption proceeds in INR.

For the two portal period-amount columns, OpenTax Ledger follows the current
review decision: the lot's Sold value is used for both
`Total gross amount paid/credited with respect to the holding during the period`
and
`Total gross proceeds from sale or redemption of investment during the period`.
Fully unsold lots export `0` for those sold-value fields.

Portal import steps:

1. Sign in to <https://www.incometax.gov.in/>.
2. Open the relevant ITR, go to **Schedule FA**, and choose table **A3**.
3. Use the portal's CSV import option for A3 and upload the downloaded CSV.
4. Review every imported row in the portal before saving. Correct country
   labels, address truncation, ZIP handling, entity nature, INR values, and any
   portal-side validation messages manually.

Always verify the imported rows against IBKR statements, exchange-rate evidence,
and CA-approved positions before filing. This project is not tax advice.

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

Refresh both SBI and SEC snapshots from their source endpoints:

```bash
npm run data:refresh
```

A scheduled workflow at
[`.github/workflows/refresh-reference-data.yml`](.github/workflows/refresh-reference-data.yml)
runs daily at 03:37 UTC (09:07 Asia/Kolkata), validates the complete app, and
opens or updates a review pull request when checked-in snapshots change. It
never merges the pull request automatically. GitHub may disable scheduled
workflows after 60 days without repository activity; the same workflow remains
available through manual dispatch.

The workflow always refreshes the community SBI archive and attempts the
official SEC endpoint directly. SEC currently rate-limits GitHub-hosted runner
networks; when that happens, the run emits a visible warning and retains the
last verified SEC snapshot for up to 30 days so SBI updates are not blocked.
The normal `npm run data:refresh` command remains fail-closed for local/manual
refreshes.

The command names are defined in [package.json](package.json).

## 🏦 Reference Data

OpenTax Ledger uses local reference data only. The browser does not call SBI,
SEC, market-data vendors, analytics providers, or project servers while
processing taxpayer statements.

### USD TT BUY table

The bundled USD table is derived from the community-maintained
[`sahilgupta/sbi-fx-ratekeeper`](https://github.com/sahilgupta/sbi-fx-ratekeeper)
repository. Every refresh pins evidence links to the full source commit recorded
in [`reference-data/manifest.json`](reference-data/manifest.json).

Official context:

- [Income Tax Rule 115](https://www.incometaxindia.gov.in/w/rule-115-2)
- [Income Tax Rule 26 TT buying-rate definition](https://www.incometaxindia.gov.in/w/rule-26-8)
- [Income Tax Rule 128 foreign tax credit](https://www.incometaxindia.gov.in/w/rule-128-1)
- [SBI current Forex Card Rates PDF](https://sbi.bank.in/documents/16012/1400784/FOREX_CARD_RATES.pdf)

Important caveats:

- SBI publishes a current mutable PDF, not an official historical CSV archive.
- The bundled table is a convenience reference, not an official SBI-published
  historical feed.
- The prescribed Rule 115 or Rule 128 date remains the calculation basis. The
  app does not change that date to a statutory prior business day.
- Rate evidence can be exact, prior-observation, missing, or ambiguous. A
  prior-observation match means the bundled community archive had a published
  source row on or before the prescribed date within the configured review
  window.
- The app does not substitute RBI rates, broker rates, market rates, or
  unchecked vendor rates.
- Supported USD capital-gain, dividend, other-source interest, and foreign-tax
  rows receive a draft INR preview only when the local evidence status is
  usable.
- IBKR Interest rows default to other-source interest and remain flagged for
  classification review.

## 🧮 Calculation Model

OpenTax Ledger aims for deterministic, audit-friendly drafts rather than hidden
tax assumptions.

| Area | Implemented behavior |
| --- | --- |
| Capital gains | Equity and ETF disposals are matched against earlier buy lots using FIFO. Earlier lots are retained even when the sale falls inside the selected financial year. Holding period over 730 days is marked LTCG; other supported disposals are marked STCG. Net foreign-currency gain is converted at the transfer-month prescribed Rule 115 date. |
| Dividends | IBKR dividend payment rows are converted row by row. Summary rows without a real payment date are excluded from income totals and listed for audit. INR is rounded per row to whole rupees before totals are added. |
| Withholding tax | Negative withholding rows are converted row by row. Positive WHT reversals and summary/no-date rows are excluded from tax-paid totals and listed for audit. INR is rounded per row to whole rupees before totals are added. |
| FTC candidates | Foreign tax credit relief is grouped by country at the user-entered marginal rate. The draft relief is the lower of foreign tax paid and estimated Indian tax on that country income. Eligibility, treaty position, and Form 67 remain CA review items. |
| Transfers | IBKR securities transfers are tracked separately from Deposits & Withdrawals cash movements. Cash deposits and withdrawals do not count as securities transfers or income. |
| Schedule FA | The app groups calendar-year securities into Schedule FA entities, uses the latest imported statement snapshot for current holdings, and labels peak/closing values with evidence status. A latest holding without in-year evidence is retained as a review-only entity instead of being silently omitted. Snapshot-limited peaks are review items unless the taxpayer supplies stronger market-value evidence. |

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
