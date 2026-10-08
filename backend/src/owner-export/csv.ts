// RFC 4180 CSV for the owner's export (EXP-CSV): UTF-8 with a byte order mark so spreadsheet
// apps read Cyrillic names, CRLF records, and text that a spreadsheet would run as a formula
// written as plain text.

export type CsvCell = string | number | boolean | null;

/** U+FEFF, written as a code so the source holds no invisible character. */
export const BOM = String.fromCharCode(0xfeff);
const number = /^-?[0-9]+(\.[0-9]+)?$/;
const formula = /^[=+\-@\t\r]/;

function cell(value: CsvCell): string {
  if (value === null) return '';
  let text = String(value);
  if (formula.test(text) && !number.test(text)) text = `'${text}`;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvFile(header: readonly string[], rows: readonly (readonly CsvCell[])[]): Buffer {
  const records = [header, ...rows].map((row) => {
    if (row.length !== header.length) throw new Error('CSV row width differs from its header');
    return `${row.map(cell).join(',')}\r\n`;
  });
  return Buffer.from(`${BOM}${records.join('')}`, 'utf8');
}
