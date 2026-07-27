export function csvCell(value) {
  const raw = String(value ?? "");
  const formulaLike = /^[\u0000-\u0020]*[=+\-@]/.test(raw);
  const safe = formulaLike ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
