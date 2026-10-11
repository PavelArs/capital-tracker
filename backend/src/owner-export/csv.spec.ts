import { BOM, csvFile } from './csv';

const text = (bytes: Buffer) => bytes.toString('utf8');

describe('CSV files of the export (EXP-CSV)', () => {
  it('starts with a UTF-8 byte order mark and ends every record with CRLF', () => {
    const bytes = csvFile(['name', 'quantity'], [['Ledger', '0.5']]);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(bytes)).toBe(`${BOM}name,quantity\r\nLedger,0.5\r\n`);
  });

  it('quotes commas, quotes, line breaks and edge spaces; null is an empty cell', () => {
    const bytes = csvFile(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      [['Cold, storage', 'say "hi"', 'two\nlines', ' padded', null, true]],
    );
    expect(text(bytes)).toBe(
      `${BOM}a,b,c,d,e,f\r\n"Cold, storage","say ""hi""","two\nlines"," padded",,true\r\n`,
    );
  });

  it('keeps Cyrillic names exact', () => {
    expect(text(csvFile(['name'], [['Наличные']]))).toBe(`${BOM}name\r\nНаличные\r\n`);
  });

  it('turns text a spreadsheet would run as a formula into plain text, numbers stay numbers', () => {
    const bytes = csvFile(
      ['cell'],
      [['=HYPERLINK("x")'], ['+1+2'], ['@SUM(A1)'], ['-2+3'], ['\tTab'], ['-0.0001'], ['12']],
    );
    expect(text(bytes).split('\r\n').slice(1, -1)).toEqual([
      `"'=HYPERLINK(""x"")"`,
      "'+1+2",
      "'@SUM(A1)",
      "'-2+3",
      "'\tTab",
      '-0.0001',
      '12',
    ]);
  });

  it('refuses a row whose width differs from the header', () => {
    expect(() => csvFile(['a', 'b'], [['only one']])).toThrow('CSV row width');
  });
});
