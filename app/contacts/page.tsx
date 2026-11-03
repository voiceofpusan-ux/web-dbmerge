'use client';
// 내 주소록: DB에 보관된 연락처 검색·필터·수정·삭제·그룹 일괄 변경

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookRow, Session } from '@/types';
import { BookFilter, EditableField, Facet, bookFacets, deleteBookRows, searchBook, setBookGroup, updateBookRow } from '@/lib/book';
import { getSession, retentionLabel } from '@/lib/license';

const PAGE = 50;
const ALL = '__all__';      // 필터 선택: 전체
const EMPTY = '__empty__';  // 필터 선택: 값 없음

const toFilterValue = (v: string) => (v === ALL ? null : v === EMPTY ? '' : v);

const EDIT_FIELDS: { key: EditableField; label: string }[] = [
  { key: 'name', label: '이름' },
  { key: 'grp', label: '그룹' },
  { key: 'party_type', label: '당원구분' },
  { key: 'address', label: '주소' },
  { key: 'memo', label: '메모' },
  { key: 'note1', label: '비고1' },
  { key: 'note2', label: '비고2' },
  { key: 'note3', label: '비고3' },
  { key: 'note4', label: '비고4' },
  { key: 'note5', label: '비고5' },
];

export default function ContactsPage() {
  const [session,  setSession]  = useState<Session | null | undefined>(undefined);   // undefined = 아직 읽기 전
  const [facets,   setFacets]   = useState<{ total: number; groups: Facet[]; parties: Facet[] } | null>(null);
  const [query,    setQuery]    = useState('');
  const [groupSel, setGroupSel] = useState(ALL);
  const [partySel, setPartySel] = useState(ALL);
  const [hideOpt,  setHideOpt]  = useState(false);
  const [filter,   setFilter]   = useState<BookFilter>({ query: '', group: null, party: null, hideOptout: false });
  const [page,     setPage]     = useState(0);
  const [data,     setData]     = useState<{ total: number; rows: BookRow[] } | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkGrp,  setBulkGrp]  = useState('');
  const [editing,  setEditing]  = useState<BookRow | null>(null);
  const [notice,   setNotice]   = useState('');

  useEffect(() => { setSession(getSession()); }, []);
  const canStore = !!session && (!!session.can_store || session.is_admin);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, f] = await Promise.all([searchBook(filter, page * PAGE, PAGE), bookFacets()]);
      setData(res);
      setFacets(f);
      setSelected(new Set());
    } catch (e: unknown) {
      alert(`조회 오류: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => { if (canStore) load(); }, [canStore, load]);

  const applySearch = () => {
    setPage(0);
    setFilter({ query: query.trim(), group: toFilterValue(groupSel), party: toFilterValue(partySel), hideOptout: hideOpt });
  };

  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.row_id));

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.row_id)));

  const runBulk = async (fn: () => Promise<number>, done: (n: number) => string) => {
    try {
      const n = await fn();
      setNotice(done(n));
      await load();
    } catch (e: unknown) {
      alert(`처리 오류: ${e instanceof Error ? e.message : e}`);
    }
  };

  const handleBulkGroup = () => runBulk(
    () => setBookGroup([...selected], bulkGrp),
    (n) => `✓ ${n}건의 그룹을 "${bulkGrp.trim() || '(없음)'}"(으)로 바꿨습니다.`,
  );

  const handleBulkDelete = () => {
    if (!confirm(`선택한 ${selected.size}건을 삭제하시겠습니까?\n되돌릴 수 없습니다.`)) return;
    runBulk(() => deleteBookRows([...selected]), (n) => `✓ ${n}건을 삭제했습니다.`);
  };

  const handleSaveEdit = async (fields: Partial<Record<EditableField, string>>) => {
    if (!editing) return;
    try {
      await updateBookRow(editing.row_id, fields);
      setNotice(`✓ ${editing.fixed_phone} 수정했습니다.`);
      setEditing(null);
      await load();
    } catch (e: unknown) {
      alert(`수정 오류: ${e instanceof Error ? e.message : e}`);
    }
  };

  // 삭제 예정 시각 = 저장 시각 + 계정 보관 시간 (슈퍼어드민·영구는 없음)
  const retention = session && !session.is_admin ? session.retention_hours ?? null : null;
  const deleteAt = (savedAt: string) =>
    retention == null ? '영구' : new Date(new Date(savedAt).getTime() + retention * 3600e3).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-base font-bold text-gray-800">내 주소록</h1>
        <div className="flex items-center gap-3">
          <Link href="/optouts" className="text-sm px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">수신거부</Link>
          <Link href="/book" className="text-sm px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50">주소록 정리</Link>
          <Link href="/" className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">엑셀 정리</Link>
        </div>
      </header>

      {canStore && !session!.is_admin && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-800">
          {retention == null
            ? 'DB는 영구 보관됩니다.'
            : `DB는 보관기간이 ${retentionLabel(retention)}입니다. 기간이 지나면 자동으로 삭제됩니다.`}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {session === undefined ? null : !session ? (
          <Empty>로그인이 필요합니다. <Link href="/" className="underline">처음 화면</Link>에서 로그인하세요.</Empty>
        ) : !canStore ? (
          <Empty>DB 저장 권한이 없습니다. 관리자에게 권한을 요청하세요.</Empty>
        ) : (
          <>
            {/* 검색·필터 */}
            <div className="bg-white rounded-xl border p-4 shadow-sm flex flex-wrap gap-2 items-center">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
                placeholder="이름 · 번호 일부 · 메모 · 주소"
                className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
              <FacetSelect label="그룹" value={groupSel} onChange={setGroupSel} items={facets?.groups ?? []} />
              <FacetSelect label="당원구분" value={partySel} onChange={setPartySel} items={facets?.parties ?? []} />
              <label className="flex items-center gap-1.5 text-sm text-gray-600 select-none">
                <input type="checkbox" checked={hideOpt} onChange={(e) => setHideOpt(e.target.checked)} />
                수신거부 제외
              </label>
              <button onClick={applySearch} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">검색</button>
              <span className="text-sm text-gray-500 ml-auto">
                {data ? `검색 ${data.total.toLocaleString()}건` : ''}{facets ? ` · 전체 ${facets.total.toLocaleString()}건` : ''}
              </span>
            </div>

            {/* 선택한 행 일괄 작업 */}
            {selected.size > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-blue-800">선택 {selected.size}건</span>
                <input
                  value={bulkGrp}
                  onChange={(e) => setBulkGrp(e.target.value)}
                  placeholder="새 그룹 이름"
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-40"
                />
                <button onClick={handleBulkGroup} className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">그룹 변경</button>
                <button onClick={handleBulkDelete} className="px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700">삭제</button>
              </div>
            )}

            {notice && <p className="text-sm text-green-600 font-medium">{notice}</p>}

            {/* 목록 */}
            <div className="bg-white rounded-xl border shadow-sm overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 border-b w-8"><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="이 페이지 전체 선택" /></th>
                    {['전화번호', '이름', '그룹', '당원구분', '주소', '메모', '저장', '삭제 예정', ''].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 border-b whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.row_id} className={`border-b ${selected.has(r.row_id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-1.5"><input type="checkbox" checked={selected.has(r.row_id)} onChange={() => toggle(r.row_id)} /></td>
                      <td className="px-3 py-1.5 whitespace-nowrap font-medium text-gray-800">
                        {r.fixed_phone}
                        {r.optout && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-xs font-normal">수신거부</span>}
                      </td>
                      <td className="px-3 py-1.5 whitespace-pre">{r.name}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{r.grp}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{r.party_type}</td>
                      <td className="px-3 py-1.5 text-gray-600 max-w-[240px] truncate" title={r.address}>{r.address}</td>
                      <td className="px-3 py-1.5 text-gray-600 max-w-[200px] truncate" title={r.memo}>{r.memo}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-400 text-xs">{new Date(r.saved_at).toLocaleDateString('ko-KR')}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-gray-400 text-xs">{deleteAt(r.saved_at)}</td>
                      <td className="px-3 py-1.5">
                        <button onClick={() => setEditing(r)} className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100">수정</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && rows.length === 0 && <p className="text-center text-gray-400 text-sm py-10">검색 결과가 없습니다.</p>}
              {loading && <p className="text-center text-gray-400 text-sm py-4">불러오는 중...</p>}
            </div>

            {/* 페이지 */}
            <div className="flex justify-center items-center gap-3 text-sm">
              <button disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40">이전</button>
              <span className="text-gray-600">{page + 1} / {pages} 페이지</span>
              <button disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40">다음</button>
            </div>
          </>
        )}
      </main>

      {editing && <EditDialog row={editing} onSave={handleSaveEdit} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function FacetSelect({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: Facet[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white" aria-label={label}>
      <option value={ALL}>{label}: 전체</option>
      {items.map((f) => (
        <option key={f.value || EMPTY} value={f.value === '' ? EMPTY : f.value}>
          {f.value === '' ? `(${label} 없음)` : f.value} ({f.count.toLocaleString()})
        </option>
      ))}
    </select>
  );
}

/** 행 수정 창 — 바뀐 칸만 서버로 보냄. 전화번호는 비교 기준이라 수정 불가 */
function EditDialog({ row, onSave, onCancel }: {
  row: BookRow;
  onSave: (fields: Partial<Record<EditableField, string>>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<EditableField, string>>(
    () => Object.fromEntries(EDIT_FIELDS.map(({ key }) => [key, row[key] ?? ''])) as Record<EditableField, string>,
  );
  const changed = EDIT_FIELDS.filter(({ key }) => values[key] !== (row[key] ?? ''));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl w-[440px] p-6 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-800">연락처 수정</h2>
        <p className="text-sm text-gray-500">{row.fixed_phone} <span className="text-xs">(번호는 바꿀 수 없습니다. 바꾸려면 삭제 후 다시 올리세요.)</span></p>
        <div className="grid grid-cols-[80px_1fr] gap-2 items-center text-sm max-h-[60vh] overflow-auto">
          {EDIT_FIELDS.map(({ key, label }) => (
            <label key={key} className="contents">
              <span className="text-gray-600">{label}</span>
              <input
                value={values[key]}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400"
              />
            </label>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">취소</button>
          <button
            onClick={() => onSave(Object.fromEntries(changed.map(({ key }) => [key, values[key]])))}
            disabled={changed.length === 0}
            className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium"
          >
            저장{changed.length ? ` (${changed.length}칸)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border p-12 text-center text-gray-500 text-sm">{children}</div>;
}
