import { badRequest } from './errors';

export type CsvRow = Record<string, string>;

/** Parses RFC4180-style CSV text (quoted fields, escaped quotes, CRLF) into header-keyed rows. */
export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;

  const pushField = (): void => {
    record.push(field);
    field = '';
  };
  const pushRecord = (): void => {
    pushField();
    if (record.some((value) => value.trim() !== '')) rows.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushRecord();
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || record.length > 0) pushRecord();

  if (rows.length < 2) {
    throw badRequest('VALIDATION_ERROR', 'CSV must contain a header row and at least one data row.');
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? '').trim();
    });
    return row;
  });
}
