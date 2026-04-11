'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getJobs, getRows, dbRowsToRecords, JobRecord, DbRow } from '@/lib/db';
import { exportSingle } from '@/lib/exporter';
import { isConfigured } from '@/lib/supabase';

export default function HistoryPage() {
  const [jobs,        setJobs]        = useState<JobRecord[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [rowsCache,   setRowsCache]   = useState<Record<string, DbRow[]>>({});
  const [loadingRows, setLoadingRows] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    getJobs()
      .then(setJobs)
      .catch((e) => alert(`조회 오류: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const handleExpand = async (jobId: string) => {
    if (expandedId === jobId) { setExpandedId(null); return; }
    setExpandedId(jobId);
    if (rowsCache[jobId]) return;

    setLoadingRows(jobId);
    try {
      const rows = await getRows(jobId);
      setRowsCache((prev) => ({ ...prev, [jobId]: rows }));
    } catch (e: unknown) {
      alert(`행 조회 오류: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoadingRows(null);
    }
  };

  const handleDownload = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloading(jobId);
    try {
      let rows = rowsCache[jobId];
      if (!rows) {
        rows = await getRows(jobId);
        setRowsCache((prev) => ({ ...prev, [jobId]: rows }));
      }
      exportSingle(dbRowsToRecords(rows), '정제결과');
    } catch (err: unknown) {
      alert(`다운로드 오류: ${err instanceof Error ? err.message : err}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-base font-bold text-gray-800">작업 이력</h1>
        <Link href="/" className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
          ← 처리 화면으로
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6">
        {!isConfigured ? (
          <Empty text="Supabase가 설정되지 않아 이력 조회가 불가합니다." />
        ) : loading ? (
          <p className="text-center text-gray-400 py-16 text-sm">불러오는 중...</p>
        ) : jobs.length === 0 ? (
          <Empty text="저장된 작업 이력이 없습니다." />
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                {/* 작업 헤더 */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleExpand(job.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">
                      {new Date(job.created_at).toLocaleString('ko-KR')}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {job.file_names?.join(', ') || '-'}
                    </p>
                  </div>

                  <div className="flex gap-2 text-xs flex-shrink-0">
                    <Chip label="정제" value={job.unique_count} color="green" />
                    <Chip label="중복" value={job.duplicate}    color="orange" />
                    <Chip label="오류" value={job.error}        color="red" />
                  </div>

                  <button
                    onClick={(e) => handleDownload(job.id, e)}
                    disabled={downloading === job.id}
                    className="flex-shrink-0 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {downloading === job.id ? '...' : 'xlsx ↓'}
                  </button>

                  <span className="text-gray-400 text-xs flex-shrink-0">
                    {expandedId === job.id ? '▲' : '▼'}
                  </span>
                </div>

                {/* 펼치기: 행 미리보기 */}
                {expandedId === job.id && (
                  <div className="border-t">
                    {loadingRows === job.id ? (
                      <p className="text-center text-xs text-gray-400 py-4">로딩 중...</p>
                    ) : rowsCache[job.id] ? (
                      <>
                        <div className="overflow-auto max-h-64">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                {['이름', '폰번호', '수정번호', '그룹', '메모', '출처파일', '비고작업'].map((h) => (
                                  <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 border-b whitespace-nowrap">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rowsCache[job.id].slice(0, 100).map((row, i) => (
                                <tr key={i} className="border-b hover:bg-gray-50">
                                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{row.name}</td>
                                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{row.phone}</td>
                                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{row.fixed_phone}</td>
                                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{row.grp}</td>
                                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{row.memo}</td>
                                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-400 text-[11px]">{row.source}</td>
                                  <td className={`px-3 py-1.5 whitespace-nowrap ${row.remark === '오류번호' ? 'text-red-500' : row.remark ? 'text-orange-500' : ''}`}>
                                    {row.remark}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {rowsCache[job.id].length > 100 && (
                          <p className="text-center text-xs text-gray-400 py-2">
                            상위 100건만 표시 · 전체 {rowsCache[job.id].length.toLocaleString()}건
                          </p>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-xl border p-12 text-center text-gray-400 text-sm">
      {text}
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: number; color: string }) {
  const c: Record<string, string> = {
    green:  'bg-green-50  text-green-700',
    orange: 'bg-orange-50 text-orange-600',
    red:    'bg-red-50    text-red-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full font-medium ${c[color]}`}>
      {label} {value?.toLocaleString()}
    </span>
  );
}
