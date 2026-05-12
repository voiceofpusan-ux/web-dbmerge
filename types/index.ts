export interface ColumnMap {
  group: string;
  last_name: string;
  name: string;
  phone: string;
  memo: string;
}

export interface SheetEntry {
  id: string;
  fileName: string;
  sheetName: string;
  headers: string[];
  data: Record<string, string>[];
  columnMap: ColumnMap;
}

export interface RowRecord {
  group: string;
  name: string;
  수정전이름: string;
  이름처리: '' | '좌우폭조절' | '복성제거' | '4글자이상';
  긴이름나머지: string;
  phone: string;
  memo: string;
  원본번호: string;
  출처파일: string;
  수정번호: string;
  비고작업: '' | '구번호변환' | '오류번호';
  중복작업: '' | '중복';
}

export interface ProcessResult {
  uniqueRows: RowRecord[];
  allRows: RowRecord[];
  stats: {
    total: number;
    unique: number;
    duplicate: number;
    converted: number;
    error: number;
  };
}

export interface LicenseInfo {
  id: string;
  name: string;
  phone: string;
  password: string;
  machine_id: string;
  is_admin: boolean;
  status: 'active' | 'blocked';
  quota: number;
  used: number;
  charge_count: number;
  registered_at: string;
}

export interface Session {
  id: string;
  name: string;
  phone: string;
  is_admin: boolean;
  quota: number;
  used: number;
}
