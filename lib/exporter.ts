import * as XLSX from 'xlsx';
import { RowRecord } from '@/types';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function getTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function makeSheet(
  headers: string[],
  cols: (keyof RowRecord)[],
  rows: RowRecord[],
) {
  const data = [headers, ...rows.map((r) => cols.map((c) => r[c] ?? ''))];
  return XLSX.utils.aoa_to_sheet(data);
}

/** DB 이력에서 다운로드 — 정제결과 1파일만 생성 */
export function exportSingle(rows: RowRecord[], label = '정제결과') {
  const ts = getTimestamp();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(
      ['그룹', '이름', '폰번호', '수정번호', '메모', '원본번호', '출처파일', '비고작업'],
      ['group', 'name', 'phone', '수정번호', 'memo', '원본번호', '출처파일', '비고작업'],
      rows,
    ),
    label,
  );
  XLSX.writeFile(wb, `번호통합_${ts}_${label}.xlsx`);
}

export function exportExcel(uniqueRows: RowRecord[], allRows: RowRecord[]) {
  const ts = getTimestamp();

  // 정제결과 (중복 제거본)
  const wb1 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb1,
    makeSheet(
      ['그룹', '이름', '폰번호', '수정번호', '메모', '원본번호', '출처파일', '비고작업'],
      ['group', 'name', 'phone', '수정번호', 'memo', '원본번호', '출처파일', '비고작업'],
      uniqueRows,
    ),
    '정제결과',
  );
  XLSX.writeFile(wb1, `번호통합_${ts}_정제결과.xlsx`);

  // 전체이력 (중복작업 컬럼 포함)
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb2,
    makeSheet(
      ['그룹', '이름', '폰번호', '수정번호', '메모', '원본번호', '출처파일', '비고작업', '중복작업'],
      ['group', 'name', 'phone', '수정번호', 'memo', '원본번호', '출처파일', '비고작업', '중복작업'],
      allRows,
    ),
    '전체이력',
  );
  XLSX.writeFile(wb2, `번호통합_${ts}_전체이력.xlsx`);
}
