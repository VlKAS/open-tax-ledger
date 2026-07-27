# Threat Model

OpenTax Ledger's primary privacy claim is browser-only processing for the core
workflow. This document defines what that claim protects and what it does not.

## Assets

Sensitive assets include:

- IBKR Activity Statement CSV files.
- Generated ledgers and draft schedule exports.
- Account IDs, names, addresses, holdings, trades, dividends, withholding tax,
  fees, and cash balances.
- AIS/TIS/Form 26AS references if a user manually compares them.
- CA notes and return-review decisions.

The project must not request PAN, Aadhaar, broker credentials, income tax portal
credentials, passport numbers, or bank credentials.

## Trust Boundaries

| Boundary | Expected behavior |
| --- | --- |
| Browser | Parses and computes locally for the core workflow |
| Static app assets | May be fetched from the deployment host |
| User files | Stay in the browser unless the user exports them |
| Repository fixtures | Synthetic only |
| Maintainers | Should never receive real taxpayer files through issues or pull requests |

## In-Scope Threats

- Accidental upload of real statements to issues, fixtures, or tests.
- A regression that sends imported CSV content to a server.
- Persistent storage of sensitive rows without clear user action.
- Third-party scripts or analytics that can observe imported data.
- Error reporting that includes source rows or generated schedule values.
- Cross-site scripting that exposes imported statement data.
- Misleading outputs that appear final or filing-ready.

## Out-of-Scope Threats

OpenTax Ledger cannot protect against:

- A compromised operating system or browser.
- Malicious browser extensions.
- A malicious fork or deployment that changes the code.
- User-chosen sharing of exports with untrusted parties.
- Incorrect final tax positions approved outside the tool.
- IBKR, bank, or government portal account compromise.

## Controls

Required controls for the core workflow:

- No IBKR login.
- No income tax portal login.
- No PAN or Aadhaar fields.
- No analytics on imported data.
- No server upload for imported statements.
- No real taxpayer fixtures.
- Clear draft and CA-review labels on generated outputs.
- Review warnings for unsupported or ambiguous rows.

Recommended implementation controls:

- Keep parsing and calculation code deterministic and testable.
- Avoid remote dependencies at runtime where practical.
- Use Content Security Policy headers on hosted deployments.
- Avoid logging imported row content.
- Keep generated files user-initiated.
- Add regression tests for "does not transmit imported file content" when a
  network boundary exists.

## Privacy Regression Checklist

Before merging a change that touches file import, parsing, exports, telemetry,
or hosting:

- [ ] Does the change send source CSV content over the network?
- [ ] Does it store source rows outside the browser?
- [ ] Does it add analytics, logging, or error reporting around imported data?
- [ ] Does it request identity, PAN, Aadhaar, broker, or portal credentials?
- [ ] Does it add real or derived taxpayer data to the repository?
- [ ] Does the UI still describe outputs as draft working papers?

If any answer is yes, update this threat model and require explicit maintainer
review.
