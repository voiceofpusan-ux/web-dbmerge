'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getJobs, JobRecord } from '@/lib/db';
import { isConfigured } from '@/lib/supabase';

export default function HistoryPage() {
  const [jobs,        setJobs]        = useState<JobRecord[]>([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    getJobs()
      .then(setJobs)
      .catch((e) => alert(`조회 오류: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-base font-bold text-gray-800">사용 이력</h1>
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
          <Empty text="엑셀받기 기록이 없습니다." />
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="bg-white rounded-xl border shadow-sm flex items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">
                    {new Date(job.created_at).toLocaleString('ko-KR')}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {job.file_names?.join(', ') || '-'}
                  </p>
                </div>

                <div className="flex gap-2 text-xs flex-shrink-0">
                  <Chip label="차감" value={job.unique_count} color="blue" />
                  <Chip label="전체" value={job.total}        color="gray" />
                  <Chip label="중복" value={job.duplicate}    color="orange" />
                  <Chip label="오류" value={job.error}        color="red" />
                </div>
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
    blue:   'bg-blue-50   text-blue-700',
    gray:   'bg-gray-100  text-gray-600',
    orange: 'bg-orange-50 text-orange-600',
    red:    'bg-red-50    text-red-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full font-medium ${c[color]}`}>
      {label} {value?.toLocaleString()}
    </span>
  );
}
