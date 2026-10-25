'use client';

import { useState } from 'react';
import { ProcessResult, RowRecord, Session } from '@/types';
import { exportExcel } from '@/lib/exporter';
import { refreshSession, isConfigured as licConfigured } from '@/lib/license';
import { chargeExport } from '@/lib/db';

interface Props {
  result: ProcessResult;
  fileNames: string[];
  onClose: () => void;
  onLicenseRefresh: () => void;
}

const DISPLAY_COLS: { key: keyof RowRecord; label: string }[] = [
  { key: 'group',        label: '그룹' },
  { key: 'name',         label: '이름' },
  { key: '수정번호',     label: '수정번호' },
  { key: '원본번호',     label: '원본번호' },
  { key: 'phone',        label: '폰번호' },
  { key: 'memo',         label: '메모' },
  { key: '주소',         label: '주소' },
  { key: '당원구분',     label: '당원구분' },
  { key: '비고1',        label: '비고1' },
  { key: '비고2',        label: '비고2' },
  { key: '비고3',        label: '비고3' },
  { key: '비고4',        label: '비고4' },
  { key: '비고5',        label: '비고5' },
  { key: '출처파일',     label: '출처파일' },
  { key: '비고작업',     label: '비고작업' },
  { key: '수정전이름',   label: '수정전이름' },
  { key: '이름처리',     label: '이름처리' },
  { key: '긴이름나머지', label: '긴이름나머지' },
];

export default function ResultPanel({ result, fileNames, onClose, onLicenseRefresh }: Props) {
  const [step,    setStep]    = useState<'idle' | 'checking' | 'confirm' | 'downloading'>('idle');
  const [session, setSession] = useState<Session | null>(null);
  const [charged, setCharged] = useState(false);   // 이 결과로 이미 차감했으면 다시 받을 때 추가 차감 없음
  const [notice,  setNotice]  = useState('');

  const { uniqueRows, allRows, stats } = result;

  // 엑셀받기 — 서버에서 최신 잔여건수를 받아 확인 창 표시 (Supabase 미설정 시 차감 없이 바로 받기)
  const handleExcelClick = async () => {
    if (!licConfigured) { exportExcel(uniqueRows, allRows); return; }
    setStep('checking');
    const s = await refreshSession();
    onLicenseRefresh();
    setSession(s);
    setStep('confirm');
  };

  // 확인 → 서버 차감(첫 회만) → 파일 다운로드
  const handleConfirm = async () => {
    setStep('downloading');
    try {
      if (!charged) {
        await chargeExport(result, fileNames);
        setCharged(true);
      }
      exportExcel(uniqueRows, allRows);
      const s = await refreshSession();
      onLicenseRefresh();
      setNotice(
        charged         ? '✓ 다시 받기 완료 · 추가 차감 없음'
        : s?.is_admin   ? '✓ 엑셀받기 완료 · 슈퍼어드민(차감 없음)'
        : `✓ 엑셀받기 완료 · ${stats.unique.toLocaleString()}건 차감 · 잔여 ${s ? (s.quota - s.used).toLocaleString() : '-'}건`,
      );
    } catch (e: unknown) {
      alert(`엑셀받기 오류: ${e instanceof Error ? e.message : e}`);
      await refreshSession();
      onLicenseRefresh();
    } finally {
      setStep('idle');
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

      {notice && <p className="text-sm text-green-600 font-medium">{notice}</p>}

      {/* 액션 버튼 */}
      <div className="flex gap-3 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          다시 작업
        </button>

        <button
          onClick={handleExcelClick}
          disabled={step !== 'idle'}
          className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {step === 'checking' ? '확인 중...' : step === 'downloading' ? '받는 중...' : '엑셀받기'}
        </button>
      </div>

      {(step === 'confirm' || step === 'downloading') && (
        <ExportDialog
          count={stats.unique}
          errorCount={stats.error}
          session={session}
          charged={charged}
          busy={step === 'downloading'}
          onConfirm={handleConfirm}
          onCancel={() => setStep('idle')}
        />
      )}
    </div>
  );
}

const EXPORT_NOTICES = [
  '엑셀받기를 누르면 서버가 잔여 건수를 확인하고 정제결과 건수만큼 차감한 뒤 파일을 내려줍니다. 건수가 모자라면 받을 수 없습니다.',
  '서버에는 사용 기록만 남습니다(날짜, 파일명, 건수). 연락처 행은 저장하지 않습니다.',
  '같은 결과를 다시 받을 때는 추가로 차감하지 않습니다. "다시 작업"으로 새로 처리하면 다시 차감됩니다.',
  '이력 화면은 "사용 이력"(언제 몇 건 차감됐는지)만 보여 줍니다.',
];

/** 엑셀받기 확인 창 — 이번 차감 건수와 잔여건수, 안내 문구 표시 */
function ExportDialog({ count, errorCount, session, charged, busy, onConfirm, onCancel }: {
  count: number;
  errorCount: number;
  session: Session | null;
  charged: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const remaining = session ? session.quota - session.used : 0;
  const isAdmin   = !!session?.is_admin;
  const lacking   = !charged && !isAdmin && remaining < count;
  const blocked   = !session || lacking;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-xl shadow-2xl w-[380px] p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-800">엑셀받기</h2>

        {!session ? (
          <p className="text-sm text-red-600">로그인이 필요합니다. 다시 로그인한 뒤 시도하세요.</p>
        ) : charged ? (
          <p className="text-sm text-gray-600">이미 건수가 차감된 결과입니다. 다시 받아도 추가로 차감되지 않습니다.</p>
        ) : (
          <div className="border rounded-lg p-4 bg-gray-50 space-y-2 text-sm">
            <Row label="이번 차감" value={isAdmin ? '0건 (슈퍼어드민)' : `${count.toLocaleString()}건`} strong />
            {!isAdmin && errorCount > 0 && (
              <p className="text-xs text-gray-400 text-right">정제결과 기준 · 오류번호 {errorCount.toLocaleString()}건 포함</p>
            )}
            {!isAdmin && (
              <>
                <Row label="현재 잔여" value={`${remaining.toLocaleString()}건`} />
                <div className="border-t pt-2">
                  <Row
                    label="차감 후 잔여"
                    value={lacking ? `${(count - remaining).toLocaleString()}건 부족` : `${(remaining - count).toLocaleString()}건`}
                    strong
                    color={lacking ? 'text-red-600' : 'text-green-600'}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {lacking && (
          <p className="text-xs text-red-500">잔여 건수가 부족합니다. 관리자에게 충전을 요청하세요.</p>
        )}

        <ul className="text-xs text-gray-500 space-y-1 list-disc pl-4">
          {EXPORT_NOTICES.map((t) => <li key={t}>{t}</li>)}
        </ul>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || blocked}
            className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium"
          >
            {busy ? '받는 중...' : charged ? '다시 받기' : isAdmin ? '받기' : `${count.toLocaleString()}건 차감하고 받기`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`${strong ? 'font-semibold' : ''} ${color ?? 'text-gray-800'}`}>{value}</span>
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
