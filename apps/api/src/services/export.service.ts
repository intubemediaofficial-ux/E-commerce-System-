import { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export type ExportFormat = 'json' | 'csv' | 'excel' | 'pdf';

export interface Column<T> {
  header: string;
  key: keyof T & string;
  width?: number;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function filename(title: string, extension: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/**
 * Streams a tabular report in the requested format. JSON keeps the standard API
 * envelope; csv/excel/pdf download as files.
 */
export async function sendReport<T extends Record<string, unknown>>(
  res: Response,
  format: ExportFormat,
  title: string,
  columns: Column<T>[],
  rows: T[],
  meta?: Record<string, unknown>,
): Promise<void> {
  if (format === 'json') {
    res.status(200).json({ success: true, data: { title, columns, rows, ...(meta ? { meta } : {}) } });
    return;
  }

  if (format === 'csv') {
    const lines = [columns.map((c) => csvCell(c.header)).join(',')];
    for (const row of rows) {
      lines.push(columns.map((c) => csvCell(row[c.key])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename(title, 'csv')}"`);
    res.send(lines.join('\n'));
    return;
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(title.slice(0, 30));
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
    sheet.getRow(1).font = { bold: true };
    rows.forEach((row) => sheet.addRow(row));
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename(title, 'xlsx')}"`);
    const buffer = await workbook.xlsx.writeBuffer();
    res.end(Buffer.from(buffer));
    return;
  }

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename(title, 'pdf')}"`);
  doc.pipe(res);

  doc.fontSize(16).text(title, { align: 'left' });
  doc.fontSize(9).fillColor('#555').text(`Generated ${new Date().toISOString()}`);
  doc.moveDown(0.6).fillColor('#000');

  const usableWidth = doc.page.width - 64;
  const columnWidth = usableWidth / columns.length;

  const writeRow = (values: string[], bold: boolean): void => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    values.forEach((value, index) => {
      doc.text(value, 32 + index * columnWidth, y, {
        width: columnWidth - 4,
        ellipsis: true,
        lineBreak: false,
      });
    });
    doc.moveDown(1);
    if (doc.y > doc.page.height - 48) doc.addPage();
  };

  writeRow(
    columns.map((c) => c.header),
    true,
  );
  rows.forEach((row) =>
    writeRow(
      columns.map((c) => (row[c.key] === null || row[c.key] === undefined ? '' : String(row[c.key]))),
      false,
    ),
  );

  doc.end();
}
