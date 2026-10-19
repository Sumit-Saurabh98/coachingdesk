export type CsvCell = string | number | boolean | null | undefined;

// Excel, LibreOffice and Google Sheets treat a cell starting with one of these as a FORMULA.
// An export holds text other people typed (student names, notes): "=HYPERLINK(...)" must
// open as text, not run. OWASP "CSV injection": prefix such cells with a single quote.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;
// UTF-8 byte order mark: without it, Excel on Windows shows Hindi names as garbage.
const BOM = '﻿';

/** One CSV file (RFC 4180: CRLF line ends, quotes doubled), with a header row. */
export function toCsv(header: readonly string[], rows: Iterable<readonly CsvCell[]>): string {
  const lines = [header.map(cell).join(',')];
  for (const row of rows) {
    lines.push(row.map(cell).join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) {
    return '';
  }
  // Numbers and booleans are written as they are: -5 is a number, not a formula.
  let text = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
