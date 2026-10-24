// 엑셀 파싱 및 컬럼 자동추론 테스트
import { describe, it, expect, beforeAll } from 'vitest';
import * as XLSX from 'xlsx';
import { loadFile } from './loader';

// Node에는 FileReader가 없어 File.arrayBuffer()로 대체
beforeAll(() => {
  globalThis.FileReader = class {
    onload: ((e: { target: { result: ArrayBuffer } }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    readAsArrayBuffer(file: File) {
      file.arrayBuffer().then((result) => this.onload?.({ target: { result } }), (e) => this.onerror?.(e));
    }
  } as unknown as typeof FileReader;
});

async function load(aoa: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const [sheet] = await loadFile(new File([buf], 'test.xlsx'));
  return sheet;
}

describe('컬럼 자동추론', () => {
  it('기본 헤더 매핑', async () => {
    const s = await load([['그룹', '이름', '휴대폰', '메모'], ['A', '홍길동', '01012345678', 'm']]);
    expect(s.columnMap).toMatchObject({ group: '그룹', name: '이름', phone: '휴대폰', memo: '메모' });
  });

  it('성/이름 분리 헤더는 성을 last_name으로', async () => {
    const s = await load([['성', '이름', '휴대폰'], ['홍', '길동', '01012345678']]);
    expect(s.columnMap).toMatchObject({ last_name: '성', name: '이름' });
  });

  it("'성별'은 성(last_name)으로 잡지 않음", async () => {
    const s = await load([['이름', '성별', '휴대폰'], ['홍길동', '남', '01012345678']]);
    expect(s.columnMap.last_name).toBe('');
  });

  it("'당원구분'은 그룹이 아니라 당원구분으로", async () => {
    const s = await load([['이름', '당원구분', '휴대폰'], ['홍길동', '권리당원', '01012345678']]);
    expect(s.columnMap.party_type).toBe('당원구분');
    expect(s.columnMap.group).toBe('');
  });

  it("'일련번호'보다 실제 전화번호 컬럼을 폰번호로", async () => {
    const s = await load([['일련번호', '이름', '휴대폰'], ['1', '홍길동', '01012345678']]);
    expect(s.columnMap.phone).toBe('휴대폰');
  });

  it("헤더가 '구분'·'번호' 그대로면 그룹·폰번호로", async () => {
    const s = await load([['구분', '이름', '번호'], ['A', '홍길동', '01012345678']]);
    expect(s.columnMap).toMatchObject({ group: '구분', phone: '번호' });
  });
});

describe('헤더 빈 칸', () => {
  it('중간에 빈 헤더가 있어도 값이 밀리지 않음', async () => {
    const s = await load([['이름', '', '휴대폰'], ['홍길동', 'x', '01012345678']]);
    expect(s.headers).toEqual(['이름', '휴대폰']);
    expect(s.data[0]).toEqual({ 이름: '홍길동', 휴대폰: '01012345678' });
  });
});
