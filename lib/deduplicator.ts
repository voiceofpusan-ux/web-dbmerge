import { RowRecord, SheetEntry, ProcessResult } from '@/types';
import { normalizePhone } from './normalizer';

export function process(sheets: SheetEntry[]): ProcessResult {
  const allRows: RowRecord[] = [];

  for (const sheet of sheets) {
    const source = `${sheet.fileName} [${sheet.sheetName}]`;
    const { columnMap, data } = sheet;

    for (const raw of data) {
      const lastName  = columnMap.last_name ? (raw[columnMap.last_name] ?? '') : '';
      const firstName = columnMap.name      ? (raw[columnMap.name]      ?? '') : '';
      const name  = (lastName + firstName).trim();
      const phone = columnMap.phone ? (raw[columnMap.phone] ?? '') : '';
      const group = columnMap.group ? (raw[columnMap.group] ?? '') : '';
      const memo  = columnMap.memo  ? (raw[columnMap.memo]  ?? '') : '';

      const [수정번호, 비고작업] = normalizePhone(String(phone).trim());

      allRows.push({
        group:    String(group).trim(),
        name,
        phone:    String(phone).trim(),
        memo:     String(memo).trim(),
        원본번호: String(phone).trim(),
        출처파일: source,
        수정번호,
        비고작업,
        중복작업: '',
      });
    }
  }

  // 중복 검사 (오류번호 제외, 수정번호 기준 keep='first')
  const seen = new Set<string>();
  for (const row of allRows) {
    if (row.비고작업 !== '오류번호' && row.수정번호) {
      if (seen.has(row.수정번호)) {
        row.중복작업 = '중복';
      } else {
        seen.add(row.수정번호);
      }
    }
  }

  const uniqueRows = allRows.filter((r) => r.중복작업 !== '중복');

  const stats = {
    total:     allRows.length,
    unique:    uniqueRows.length,
    duplicate: allRows.filter((r) => r.중복작업  === '중복').length,
    converted: allRows.filter((r) => r.비고작업 === '구번호변환').length,
    error:     allRows.filter((r) => r.비고작업 === '오류번호').length,
  };

  return { uniqueRows, allRows, stats };
}
