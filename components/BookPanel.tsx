'use client';
// 주소록 정리: 내 DB와 번호 비교, 중복 검토(고른 DB 행 삭제), DB 정리(신규 저장·빈 칸 채움)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookRow, ProcessResult, Session } from '@/types';
import { bookTargets, deleteBookRows, findExisting, saveBook } from '@/lib/book';
import { refreshSession, retentionLabel } from '@/lib/license';

interface Props {
  result: ProcessResult;
  fileNames: string[];
  onLicenseRefresh: () => void;
}

// 중복 검토 목록은 화면이 느려지지 않게 앞쪽 일부만 표시
const MAX_GROUPS = 300;

export default function BookPanel({ result, fileNames, onLicenseRefresh }: Props) {
  const targets = useMemo(() => bookTargets(result.uniqueRows), [result]);
  const errorCount = result.uniqueRows.length - targets.length;

  const [existing,  setExisting]  = useState<Map<string, BookRow[]> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected,  setSelected]  = useState<Set<number>>(new Set());
  const [deleting,  setDeleting]  = useState(false);
  const [step,      setStep]      = useState<'idle' | 'checking' | 'confirm' | 'saving'>('idle');
  const [session,   setSession]   = useState<Session | null>(null);
  const [progress,  setProgress]  = useState(0);
  const [notice,    setNotice]    = useState('');

  const load = useCallback(async () => {
    setExisting(null);
    setLoadError('');
    setSelected(new Set());
    try {
      setExisting(await findExisting(targets.map((r) => r.수정번호)));
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [targets]);

  useEffect(() => { load(); }, [load]);

  const newRows = existing ? targets.filter((r) => !existing.has(r.수정번호)) : [];
  const dupRows = existing ? targets.filter((r) => existing.has(r.수정번호)) : [];

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!confirm(`선택한 DB 행 ${selected.size}건을 삭제하시겠습니까?\n되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    try {
      const n = await deleteBookRows([...selected]);
      setNotice(`✓ DB 행 ${n}건을 삭제했습니다.`);
      await load();
    } catch (e: unknown) {
      alert(`삭제 오류: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDeleting(false);
    }
  };

  // DB 정리 확인 창 — 서버에서 최신 잔여건수를 받아 표시
  const openConfirm = async () => {
    setStep('checking');
    const s = await refreshSession();
    onLicenseRefresh();
    setSession(s);
    setStep('confirm');
  };

  const handleSave = async () => {
    setStep('saving');
    setProgress(0);
    try {
      const res = await saveBook(fileNames.join(', '), targets, setProgress);
      setNotice(
        `✓ DB 정리 완료 · 신규 ${res.inserted.toLocaleString()}건 저장 · 빈 칸 채움 ${res.filled.toLocaleString()}건` +
        (session?.is_admin ? '' : ` · ${res.inserted.toLocaleString()}건 차감`),
      );
    } catch (e: unknown) {
      alert(`DB 정리 오류: ${e instanceof Error ? e.message : e}`);
    } finally {
      setStep('idle');
      await refreshSession();
      onLicenseRefresh();
      await load();
    }
  };

  if (loadError) {
    return (
      <div className="text-sm text-red-600">
        DB 비교 오류: {loadError}{' '}
        <button onClick={load} className="underline">다시 시도</button>
      </div>
    );
  }
  if (!existing) return <p className="text-sm text-gray-400">내 DB와 비교하는 중...</p>;

  return (
    <div className="flex flex-col gap-4">
      {/* 통계 */}
      <div className="flex gap-2 flex-wrap text-sm">
        <Badge label="비교 대상" value={targets.length} color="gray" />
        <Badge label="신규" value={newRows.length} color="green" />
        <Badge label="DB중복" value={dupRows.length} color="orange" />
        {errorCount > 0 && <Badge label="오류번호(저장 제외)" value={errorCount} color="red" />}
      </div>

      {/* 중복 검토 */}
      {dupRows.length > 0 && (
        <div className="border rounded-lg">
          <div className="flex items-center justify-between px-3 py-2 bg-orange-50 border-b">
            <p className="text-sm text-orange-800">
              DB에 이미 있는 번호 {dupRows.length.toLocaleString()}개 · 지울 DB 행을 골라 삭제하세요. DB 정리 때는 기존 값은 그대로 두고 빈 칸만 채웁니다.
            </p>
            <button
              onClick={handleDelete}
              disabled={selected.size === 0 || deleting}
              className="text-sm px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 flex-shrink-0 ml-3"
            >
              {deleting ? '삭제 중...' : `선택한 DB 행 삭제 (${selected.size})`}
            </button>
          </div>
          <div className="overflow-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {['구분', '이름', '그룹', '메모', '주소', '당원구분', '출처'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap border-b">{h}</th>
                  ))}
                </tr>
              </thead>
              {dupRows.slice(0, MAX_GROUPS).map((r) => (
                <tbody key={r.수정번호} className="border-b-2 border-gray-200">
                  <tr className="bg-gray-100">
                    <td colSpan={7} className="px-3 py-1.5 font-semibold text-gray-700">
                      {r.수정번호} · DB {existing.get(r.수정번호)!.length}건
                    </td>
                  </tr>
                  <tr className="bg-blue-50">
                    <td className="px-3 py-1.5 whitespace-nowrap text-blue-700 font-medium">이번 파일</td>
                    <Cells name={r.name} grp={r.group} memo={r.memo} address={r.주소} party={r.당원구분} source={r.출처파일} />
                  </tr>
                  {existing.get(r.수정번호)!.map((d) => (
                    <tr key={d.row_id} className={selected.has(d.row_id) ? 'bg-red-50' : ''}>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={selected.has(d.row_id)} onChange={() => toggle(d.row_id)} />
                          <span className="text-gray-500">DB · {new Date(d.saved_at).toLocaleDateString('ko-KR')}</span>
                        </label>
                      </td>
                      <Cells name={d.name} grp={d.grp} memo={d.memo} address={d.address} party={d.party_type} source={d.file_name} />
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {dupRows.length > MAX_GROUPS && (
              <p className="text-center text-xs text-gray-400 py-2">
                앞의 {MAX_GROUPS}개 번호만 표시 · 전체 {dupRows.length.toLocaleString()}개
              </p>
            )}
          </div>
        </div>
      )}

      {step === 'saving' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>DB 정리 중...</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-purple-500 h-2 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {notice && <p className="text-sm text-green-600 font-medium">{notice}</p>}

      <div className="flex justify-end">
        <button
          onClick={openConfirm}
          disabled={step !== 'idle' || targets.length === 0}
          className="px-5 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 font-medium"
        >
          {step === 'checking' ? '확인 중...' : step === 'saving' ? `DB 정리 중... ${progress}%` : 'DB 정리'}
        </button>
      </div>

      {step === 'confirm' && (
        <SaveDialog
          newCount={newRows.length}
          dupCount={dupRows.length}
          errorCount={errorCount}
          session={session}
          onConfirm={handleSave}
          onCancel={() => setStep('idle')}
        />
      )}
    </div>
  );
}

function Cells({ name, grp, memo, address, party, source }: Record<string, string>) {
  return (
    <>
      <td className="px-3 py-1.5 whitespace-pre text-gray-800">{name}</td>
      <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{grp}</td>
      <td className="px-3 py-1.5 whitespace-nowrap text-gray-600 max-w-[160px] truncate">{memo}</td>
      <td className="px-3 py-1.5 whitespace-nowrap text-gray-600 max-w-[200px] truncate">{address}</td>
      <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{party}</td>
      <td className="px-3 py-1.5 whitespace-nowrap text-gray-400 max-w-[180px] truncate">{source}</td>
    </>
  );
}

/** DB 정리 확인 창 — 신규 건수만큼 차감, 잔여건수와 보관 기간 안내 */
function SaveDialog({ newCount, dupCount, errorCount, session, onConfirm, onCancel }: {
  newCount: number;
  dupCount: number;
  errorCount: number;
  session: Session | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const remaining = session ? session.quota - session.used : 0;
  const isAdmin   = !!session?.is_admin;
  const lacking   = !isAdmin && remaining < newCount;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl w-[400px] p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-800">DB 정리</h2>

        {!session ? (
          <p className="text-sm text-red-600">로그인이 필요합니다. 다시 로그인한 뒤 시도하세요.</p>
        ) : (
          <div className="border rounded-lg p-4 bg-gray-50 space-y-2 text-sm">
            <Row label="이번 차감" value={isAdmin ? '0건 (슈퍼어드민)' : `${newCount.toLocaleString()}건 (신규)`} strong />
            {!isAdmin && (
              <>
                <Row label="현재 잔여" value={`${remaining.toLocaleString()}건`} />
                <div className="border-t pt-2">
                  <Row
                    label="차감 후 잔여"
                    value={lacking ? `${(newCount - remaining).toLocaleString()}건 부족` : `${(remaining - newCount).toLocaleString()}건`}
                    strong
                    color={lacking ? 'text-red-600' : 'text-green-600'}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {lacking && <p className="text-xs text-red-500">잔여 건수가 부족합니다. 관리자에게 충전을 요청하세요.</p>}

        <ul className="text-xs text-gray-500 space-y-1 list-disc pl-4">
          <li>신규 번호 {newCount.toLocaleString()}건을 내 DB에 저장하고, 신규 건수만큼 차감합니다.</li>
          {dupCount > 0 && <li>DB중복 {dupCount.toLocaleString()}건은 기존 값은 그대로 두고 빈 칸만 채웁니다. 차감하지 않습니다.</li>}
          {errorCount > 0 && <li>오류번호 {errorCount.toLocaleString()}건은 저장하지 않습니다.</li>}
          <li>
            {isAdmin || session?.retention_hours == null
              ? '저장한 DB는 영구 보관됩니다.'
              : `저장한 DB는 보관기간 ${retentionLabel(session.retention_hours)}이 지나면 자동으로 삭제됩니다.`}
          </li>
        </ul>

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={!session || lacking}
            className="flex-1 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 font-medium"
          >
            {isAdmin || newCount === 0 ? 'DB 정리' : `${newCount.toLocaleString()}건 차감하고 DB 정리`}
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

function Badge({ label, value, color }: { label: string; value: number; color: 'gray' | 'green' | 'orange' | 'red' }) {
  const colors = {
    gray:   'bg-gray-50   border-gray-200   text-gray-600',
    green:  'bg-green-50  border-green-200  text-green-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-600',
    red:    'bg-red-50    border-red-200    text-red-600',
  };
  return <div className={`border rounded-lg px-3 py-1.5 font-medium ${colors[color]}`}>{label}: {value.toLocaleString()}건</div>;
}
