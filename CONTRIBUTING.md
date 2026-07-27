# Contributing to OpenTax Ledger

Thank you for helping build OpenTax Ledger. This project handles workflows that
can involve sensitive financial and tax information, so contribution quality and
data hygiene matter.

## Ground Rules

- Do not commit real taxpayer data.
- Do not commit real IBKR Activity Statements, AIS exports, Form 67 data, CA
  workpapers, screenshots, names, account IDs, PAN, Aadhaar, bank account
  numbers, passport numbers, email addresses, or broker credentials.
- Use synthetic fixtures only. Synthetic data must not be derived from a real
  taxpayer statement by simple redaction.
- Keep the core workflow browser-only unless an accepted design changes the
  privacy model and updates [docs/threat-model.md](docs/threat-model.md).
- Treat outputs as draft working papers, not filing artifacts or tax advice.

## Development Setup

Prerequisites:

- Node.js `>=22.13.0`
- npm

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run the full local check:

```bash
npm run check
```

Start local development:

```bash
npm run dev
```

## Fixture Policy

Fixtures must be synthetic and minimal. A good fixture:

- Uses fake account identifiers such as `U0000000`.
- Uses invented trades and prices.
- Exercises one behavior at a time.
- Includes expected output values when the calculation is deterministic.
- Avoids copying row sequences, quantities, dates, or cash balances from a real
  statement.

Do not submit fixtures produced from real statements, even if names and account
numbers are removed.

## Tax Logic Changes

For calculation or schedule-mapping changes, include:

- The source rows covered by the test fixture.
- The expected normalized ledger rows.
- The expected schedule output or reconciliation warning.
- A short note in [docs/methodology.md](docs/methodology.md) if the assumption
  changes.
- An official or primary reference URL when the behavior depends on a form,
  utility, broker format, or published regulator guidance.

Do not add silent fallbacks for ambiguous tax treatment. Emit a review warning
instead.

## Pull Request Checklist

Before opening a pull request:

- [ ] No real taxpayer or broker data is present.
- [ ] Tests cover new parsing, normalization, or schedule behavior.
- [ ] Documentation reflects new assumptions or limitations.
- [ ] Privacy and threat-model implications were considered.
- [ ] `npm test` passes.
- [ ] `npm run check` passes, or the pull request explains why it could not be
      run.

## Commit Messages

Use clear commit messages that explain why the change is needed. Prefer small,
reviewable commits.

## Documentation License

By contributing documentation, you agree that it is licensed under Creative
Commons Attribution 4.0 International unless a file states otherwise.
