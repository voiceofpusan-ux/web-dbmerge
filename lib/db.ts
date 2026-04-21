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
  name_remark: string;
  long_name: string;
  phone: string;
  fixed_phone: string;
  memo: string;
  orig_phone: string;
  source: string;
  remark: string;
}

const CHUNK = 500;

function toDbRow(row: RowRecord, jobId: string, userId: string) {
  return {
    job_id:      jobId,
    user_id:     userId,
    grp:         row.group,
    name:        row.name,
    name_remark: row.이름처리,
    long_name:   row.긴이름나머지,
    phone:       row.phone,
    fixed_phone: row.수정번호,
    memo:        row.memo,
    orig_phone:  row.원본번호,
    source:      row.출처파일,
    remark:      row.비고작업,
  };
}

/** 정제결과(uniqueRows)를 DB에 저장. onProgress(0~100) 콜백 지원 */
export async function saveJob(
  result: ProcessResult,
  fileNames: string[],
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');

  const session = getSession();
  const userId = session?.id ?? 'anonymous';

  const { data: job, error: jobErr } = await supabase
    .from('dbmerge_jobs')
    .insert({
      user_id:      userId,
      total:        result.stats.total,
      unique_count: result.stats.unique,
      duplicate:    result.stats.duplicate,
      converted:    result.stats.converted,
      error:        result.stats.error,
      file_names:   fileNames,
    })
    .select()
    .single();

  if (jobErr) throw new Error(jobErr.message);
  onProgress?.(5);

  const rows = result.uniqueRows;
  const chunks: RowRecord[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    chunks.push(rows.slice(i, i + CHUNK));
  }

  for (let i = 0; i < chunks.length; i++) {
    const { error } = await supabase
      .from('dbmerge_rows')
      .insert(chunks[i].map((r) => toDbRow(r, job.id, userId)));
    if (error) throw new Error(`행 저장 오류 (청크 ${i + 1}): ${error.message}`);
    onProgress?.(5 + Math.round(((i + 1) / chunks.length) * 95));
  }

  return job.id;
}

/** 현재 로그인 사용자의 작업 이력 */
export async function getJobs(): Promise<JobRecord[]> {
  if (!supabase) return [];
  const session = getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from('dbmerge_jobs')
    .select('*')
    .eq('user_id', session.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as JobRecord[];
}

/** 특정 작업의 결과 행 전체 조회 */
export async function getRows(jobId: string): Promise<DbRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('dbmerge_rows')
    .select('*')
    .eq('job_id', jobId)
    .order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DbRow[];
}

/** DbRow → RowRecord 변환 (엑셀 저장용) */
export function dbRowsToRecords(rows: DbRow[]): RowRecord[] {
  return rows.map((r) => ({
    group:      r.grp,
    name:       r.name,
    이름처리:   r.name_remark ?? '',
    긴이름나머지: r.long_name ?? '',
    phone:    r.phone,
    memo:     r.memo,
    원본번호: r.orig_phone,
    출처파일: r.source,
    수정번호: r.fixed_phone,
    비고작업: r.remark as '' | '구번호변환' | '오류번호',
    중복작업: '',
  }));
}
