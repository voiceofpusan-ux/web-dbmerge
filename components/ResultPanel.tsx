'use client';

import { useState } from 'react';
import { ProcessResult, RowRecord } from '@/types';
import { exportExcel } from '@/lib/exporter';
import { consumeLicense, isConfigured as licConfigured } from '@/lib/license';
import { saveJob } from '@/lib/db';
import { isConfigured as dbConfigured } from '@/lib/supabase';

interface Props {
  result: ProcessResult;
  fileNames: string[];
  onClose: () => void;
  onLicenseRefresh: () => void;
}

const DISPLAY_COLS: { key: keyof RowRecord; label: string }[] = [
  { key: 'group',      label: '그룹' },
  { key: 'name',       label: '이름' },
  { key: '수정전이름', label: '수정전이름' },
  { key: '이름처리',   label: '이름처리' },
  { key: '긴이름나머지', label: '긴이름나머지' },
  { key: 'phone',      label: '폰번호' },
  { key: '수정번호',   label: '수정번호' },
  { key: 'memo',       label: '메모' },
  { key: '출처파일',   label: '출처파일' },
  { key: '비고작업',   label: '비고작업' },
];

export default function ResultPanel({ result, fileNames, onClose, onLicenseRefresh }: Props) {
  const [saving,   setSaving]   = useState(false);
  const [dbSaving, setDbSaving] = useState(false);
  const [dbProgress, setDbProgress] = useState(0);
  const [dbSaved,  setDbSaved]  = useState(false);

  const { uniqueRows, allRows, stats } = result;

  // 엑셀 파일로 저장 (2파일) — 라이선스 차감 없음, 로컬 다운로드
  const handleSaveExcel = async () => {
    setSaving(true);
    try {
      exportExcel(uniqueRows, allRows);
    } finally {
      setSaving(false);
    }
  };

  // DB에 저장 — 라이선스 차감 후 저장
  const handleSaveDb = async () => {
    if (!dbConfigured) { alert('Supabase가 설정되지 않았습니다.'); return; }
    if (licConfigured) {
      const { ok, message } = await consumeLicense(uniqueRows.length);
      if (!ok) { alert(message); return; }
      onLicenseRefresh();
    }
    setDbSaving(true);
    setDbProgress(0);
    setDbSaved(false);
    try {
      await saveJob(result, fileNames, setDbProgress);
      setDbSaved(true);
    } catch (e: unknown) {
      alert(`DB 저장 오류: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDbSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 통계 */}
      <div className="flex gap-2 flex-wrap">
        <StatBadge label="정제결과" value={stats.unique}    color="green" />
        <StatBadge label="전체"     value={stats.total}     color="gray" />
        <StatBadge label="중복제거" value={stats.duplicate} color="orange" />
        <StatBadge label="구번호변환" value={stats.converted} color="blue" />
        <StatBadge label="오류번호" value={stats.error}     color="red" />
      </div>

      {/* 미리보기 테이블 */}
      <div className="border rounded-lg overflow-auto max-h-72">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {DISPLAY_COLS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap border-b">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {uniqueRows.slice(0, 100).map((row, i) => (
              <tr key={i} className="border-b hover:bg-gray-50">
                {DISPLAY_COLS.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-1.5 ${c.key === 'name' ? 'whitespace-pre' : 'whitespace-nowrap'} ${
                      c.key === '비고작업' && row[c.key]
                        ? row[c.key] === '오류번호' ? 'text-red-500' : 'text-orange-500'
                        : 'text-gray-700'
                    }`}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {uniqueRows.length > 100 && (
          <p className="text-center text-xs text-gray-400 py-2">
            상위 100건만 표시 · 전체 {uniqueRows.length.toLocaleString()}건
          </p>
        )}
      </div>

      {/* DB 저장 진행바 */}
      {dbSaving && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>DB 저장 중...</span>
            <span>{Math.round(dbProgress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-200"
              style={{ width: `${dbProgress}%` }}
            />
          </div>
        </div>
      )}

      {dbSaved && (
        <p className="text-sm text-green-600 font-medium">✓ DB 저장 완료</p>
      )}

      {/* 액션 버튼 */}
      <div className="flex gap-3 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          다시 작업
        </button>

        {dbConfigured && (
          <button
            onClick={handleSaveDb}
            disabled={dbSaving || dbSaved}
            className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium"
          >
            {dbSaving ? `저장 중... ${Math.round(dbProgress)}%` : dbSaved ? '저장됨 ✓' : 'DB 저장'}
          </button>
        )}

        <button
          onClick={handleSaveExcel}
          disabled={saving}
          className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {saving ? '저장 중...' : '엑셀 저장 (2파일)'}
        </button>
      </div>
    </div>
  );
}

function StatBadge({ label, value, color }: { label: string; value: number; color: 'green' | 'gray' | 'orange' | 'blue' | 'red' }) {
  const colors = {
    green:  'bg-green-50  border-green-200  text-green-700',
    gray:   'bg-gray-50   border-gray-200   text-gray-600',
    orange: 'bg-orange-50 border-orange-200 text-orange-600',
    blue:   'bg-blue-50   border-blue-200   text-blue-600',
    red:    'bg-red-50    border-red-200    text-red-600',
  };
  return (
    <div className={`border rounded-lg px-3 py-1.5 text-sm font-medium ${colors[color]}`}>
      {label}: {value.toLocaleString()}건
    </div>
  );
}
