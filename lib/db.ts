import { supabase } from './supabase';
import { getSession } from './license';
import { RowRecord, ProcessResult } from '@/types';

export interface JobRecord {
  id: string;
  user_id: string;
  total: number;
  unique_count: number;
  duplicate: number;
  converted: number;
  error: number;
  file_names: string[];
  created_at: string;
}

export interface DbRow {
  id: string;
  job_id: string;
  user_id: string;
  grp: string;
  name: string;
  orig_name: string;
  name_remark: string;
  long_name: string;
  phone: string;
  fixed_phone: string;
  memo: string;
  orig_phone: string;
  source: string;
  remark: string;
  address: string;
  party_type: string;
  note1: string;
  note2: string;
  note3: string;
  note4: string;
  note5: string;
}

const CHUNK = 500;
const PAGE  = 1000;   // Supabase 기본 응답 제한(1000행)

// job_id·user_id는 서버(dbmerge_add_rows)가 채움
function toDbRow(row: RowRecord) {
  return {
    grp:         row.group,
    name:        row.name,
    orig_name:   row.수정전이름,
    name_remark: row.이름처리,
    long_name:   row.긴이름나머지,
    phone:       row.phone,
    fixed_phone: row.수정번호,
    memo:        row.memo,
    orig_phone:  row.원본번호,
    source:      row.출처파일,
    remark:      row.비고작업,
    address:     row.주소,
    party_type:  row.당원구분,
    note1:       row.비고1,
    note2:       row.비고2,
    note3:       row.비고3,
    note4:       row.비고4,
    note5:       row.비고5,
  };
}

function requireToken(): string {
  const token = getSession()?.token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return token;
}

/**
 * 정제결과(uniqueRows)를 DB에 저장. onProgress(0~100) 콜백 지원
 * 건수 차감은 서버(dbmerge_start_job)에서 하고, 행 저장이 실패하면 작업을 취소해 환불받음
 */
export async function saveJob(
  result: ProcessResult,
  fileNames: string[],
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  const token = requireToken();

  const { data: jobId, error: jobErr } = await supabase.rpc('dbmerge_start_job', {
    p_token:      token,
    p_total:      result.stats.total,
    p_unique:     result.stats.unique,
    p_duplicate:  result.stats.duplicate,
    p_converted:  result.stats.converted,
    p_error:      result.stats.error,
    p_file_names: fileNames,
  });

  if (jobErr) throw new Error(jobErr.message);
  onProgress?.(5);

  const rows = result.uniqueRows;
  const chunks: RowRecord[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    chunks.push(rows.slice(i, i + CHUNK));
  }

  for (let i = 0; i < chunks.length; i++) {
    const { error } = await supabase.rpc('dbmerge_add_rows', {
      p_token:  token,
      p_job_id: jobId,
      p_rows:   chunks[i].map(toDbRow),
    });
    if (error) {
      await supabase.rpc('dbmerge_abort_job', { p_token: token, p_job_id: jobId });
      throw new Error(`행 저장 오류 (청크 ${i + 1}): ${error.message}`);
    }
    onProgress?.(5 + Math.round(((i + 1) / chunks.length) * 95));
  }

  return jobId as string;
}

/** 현재 로그인 사용자의 작업 이력 */
export async function getJobs(): Promise<JobRecord[]> {
  if (!supabase) return [];
  const session = getSession();
  if (!session) return [];

  const { data, error } = await supabase.rpc('dbmerge_get_jobs', { p_token: session.token });

  if (error) throw new Error(error.message);
  return (data ?? []) as JobRecord[];
}

/** 특정 작업의 결과 행 전체 조회 (1000행씩 나눠 받음) */
export async function getRows(jobId: string): Promise<DbRow[]> {
  if (!supabase) return [];
  const token = requireToken();

  const all: DbRow[] = [];
  for (;;) {
    const { data, error } = await supabase.rpc('dbmerge_get_rows', {
      p_token:  token,
      p_job_id: jobId,
      p_offset: all.length,
      p_limit:  PAGE,
    });
    if (error) throw new Error(error.message);
    const page = (data ?? []) as DbRow[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

/** DbRow → RowRecord 변환 (엑셀 저장용) */
export function dbRowsToRecords(rows: DbRow[]): RowRecord[] {
  return rows.map((r) => ({
    group:        r.grp,
    name:         r.name,
    수정전이름:   r.orig_name   ?? '',
    이름처리:     (r.name_remark ?? '') as '' | '좌우폭조절' | '복성제거' | '4글자이상',
    긴이름나머지: r.long_name   ?? '',
    phone:    r.phone,
    memo:     r.memo,
    원본번호: r.orig_phone,
    출처파일: r.source,
    수정번호: r.fixed_phone,
    비고작업: r.remark as '' | '구번호변환' | '오류번호',
    중복작업: '',
    주소:     r.address    ?? '',
    당원구분: r.party_type ?? '',
    비고1:    r.note1      ?? '',
    비고2:    r.note2      ?? '',
    비고3:    r.note3      ?? '',
    비고4:    r.note4      ?? '',
    비고5:    r.note5      ?? '',
  }));
}
