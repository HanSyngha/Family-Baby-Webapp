import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../api';
import type { User, TripPlan, TripPlanOption, TripPlanScenario, TripPlanItem, TripPlanRequest, TripPlanDetail, TripOptionCategory, TripOptionPhoto } from '../api';
import { isNativeApp } from '../lib/backup';
import TripMap, { type MapPoint } from '../components/trip/TripMap';
import styles from './TripPlans.module.css';
import Icon, { type IconName } from '../components/ui/Icon';

/**
 * 여행 계획(견적).
 * - 플래너(한승하)만 작성/수정. 공개(published)해야 다른 가족(황하람)에게 보인다.
 * - 플래머가 아닌 사람에게 보이는 금액은 서버가 이미 할인 적용해서 내려준다(여기선 그대로 표시).
 */

interface Props {
  user: User;
}

const CATEGORIES: { value: TripOptionCategory; label: string; icon: IconName }[] = [
  { value: 'flight', label: '항공', icon: 'plane' },
  { value: 'lodging', label: '숙소', icon: 'bed' },
  { value: 'transport', label: '교통', icon: 'car' },
  { value: 'activity', label: '액티비티', icon: 'ticket' },
  { value: 'food', label: '식사', icon: 'utensils' },
  { value: 'etc', label: '기타', icon: 'bag' },
];

const CAT_LABEL: Record<string, { label: string; icon: string }> = Object.fromEntries(
  CATEGORIES.map(c => [c.value, { label: c.label, icon: c.icon }]),
);

function formatKrw(v: number | null | undefined): string {
  if (v === null || v === undefined) return '미정';
  return v.toLocaleString('ko-KR') + '원';
}

function formatManwon(v: number | null | undefined): string {
  if (v === null || v === undefined) return '미정';
  if (Math.abs(v) >= 10000) {
    const man = v / 10000;
    return (Number.isInteger(man) ? man.toString() : man.toFixed(1)) + '만원';
  }
  return v.toLocaleString('ko-KR') + '원';
}

// 서버(roundPrice)와 같은 규칙 — 플래너에게 '상대가 볼 금액'을 미리 보여주기 위한 재현
function roundPrice(v: number): number {
  if (v >= 50000) return Math.round(v / 1000) * 1000;
  if (v >= 5000) return Math.round(v / 100) * 100;
  return Math.round(v / 10) * 10;
}
function discounted(v: number | null | undefined, pct: number): number | null {
  if (v === null || v === undefined) return null;
  if (!pct) return Math.round(v);
  return roundPrice(v * (1 - pct / 100));
}

function formatPeriod(startDate: string | null, endDate: string | null): string {
  if (!startDate) return '기간 미정';
  const s = startDate.slice(2).replace(/-/g, '.');
  if (!endDate || endDate === startDate) return s;
  const nights = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
  return `${s} – ${endDate.slice(5).replace(/-/g, '.')} · ${nights}박${nights + 1}일`;
}

function hhmm(v: string | null | undefined): string {
  if (!v) return '';
  const t = v.includes('T') ? v.split('T')[1] : v.split(' ')[1];
  return t ? t.slice(0, 5) : v.slice(0, 5);
}

function mdhm(v: string | null | undefined): string {
  if (!v) return '';
  const [d, t] = v.split(' ');
  if (!d) return v;
  const md = d.slice(5).replace('-', '/');
  return t ? `${md} ${t.slice(0, 5)}` : md;
}

// ============================================================
// 목록
// ============================================================

export default function TripPlans(_props: Props) {
  const [plans, setPlans] = useState<TripPlan[]>([]);
  const [isPlanner, setIsPlanner] = useState(false);
  const [plannerName, setPlannerName] = useState('한승하');
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  // '와이프 뷰': 상대가 보는 화면 그대로를 서버에서 받아 미리본다.
  const [wifeView, setWifeView] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getTripPlans(wifeView ? 'viewer' : undefined)
      .then(d => { setPlans(d.items); setIsPlanner(d.isPlanner); setPlannerName(d.plannerName); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [wifeView]);
  useEffect(() => { load(); }, [load]);

  if (detailId !== null) {
    return <PlanDetail planId={detailId} wifeView={wifeView} onBack={() => { setDetailId(null); load(); }} />;
  }

  return (
    <div className={styles.list}>
      {isPlanner && (
        <div className={styles.viewToggle}>
          <button className={!wifeView ? styles.viewToggleActive : ''} onClick={() => setWifeView(false)}>내 뷰</button>
          <button className={wifeView ? styles.viewToggleActive : ''} onClick={() => setWifeView(true)}><Icon name="eye" size={14} /> 와이프 뷰</button>
        </div>
      )}
      {isPlanner && wifeView && (
        <div className={styles.wifeBanner}>
          지금 화면은 <b>황하람님에게 보이는 그대로</b>입니다. 공개한 계획만, 공개용 금액으로 보여요.
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>불러오는 중...</div>
      ) : plans.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIllust}><Icon name="map" size={32} /></div>
          <p>{wifeView ? '아직 공개한 계획이 없어요' : '아직 여행 계획이 없어요'}</p>
          <span className={styles.emptyHint}>
            {wifeView
              ? '계획을 공개하면 이 화면에 나타납니다'
              : isPlanner ? '새 계획을 만들고 항공·숙소 후보를 모아보세요' : `${plannerName}님이 계획을 공개하면 여기에 보여요`}
          </span>
          {isPlanner && !wifeView && <button className={styles.emptyBtn} onClick={() => setCreating(true)}>새 여행 계획</button>}
        </div>
      ) : (
        <div className={styles.cards}>
          {plans.map(p => (
            <button key={p.id} className={styles.card} onClick={() => setDetailId(p.id)}>
              <div className={styles.cardTop}>
                <span className={styles.cardTitle}>{p.title}</span>
                {isPlanner && !wifeView && (
                  <span className={`${styles.badge} ${p.status === 'published' ? styles.badgePublished : styles.badgeDraft}`}>
                    {p.status === 'published' ? '공개됨' : p.status === 'archived' ? '보관' : '작성중'}
                  </span>
                )}
              </div>
              <div className={styles.cardMeta}>
                {p.destination && <span><Icon name="pin" size={13} /> {p.destination}</span>}
                <span><Icon name="calendar" size={13} /> {formatPeriod(p.startDate, p.endDate)}</span>
              </div>
              <div className={styles.cardFooter}>
                <div className={styles.cardTotal}>
                  <span className={styles.cardTotalLabel}>예상 견적</span>
                  <strong>{formatManwon(p.totalKrw)}</strong>
                </div>
                <span className={styles.cardCounts}>후보 {p.optionCount ?? 0} · 조합 {p.scenarioCount ?? 0}</span>
              </div>
              {isPlanner && !wifeView && p.displayDiscountPct > 0 && (
                <div className={styles.cardDiscount}>공개용 −{p.displayDiscountPct}% 적용중</div>
              )}
            </button>
          ))}
        </div>
      )}

      {isPlanner && !wifeView && plans.length > 0 && (
        <button className={styles.fab} onClick={() => setCreating(true)} aria-label="새 여행 계획">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}

      {creating && (
        <PlanForm
          onClose={() => setCreating(false)}
          onSubmit={async (data) => {
            const created = await api.createTripPlan(data as any);
            setCreating(false);
            load();
            setDetailId(created.id);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 상세
// ============================================================

type Section = 'estimate' | 'calc' | 'options' | 'schedule';

function PlanDetail({ planId, wifeView, onBack }: { planId: number; wifeView?: boolean; onBack: () => void }) {
  const [data, setData] = useState<TripPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('estimate');
  const [editPlan, setEditPlan] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [editOption, setEditOption] = useState<Partial<TripPlanOption> | null>(null);
  const [editScenario, setEditScenario] = useState<Partial<TripPlanScenario> | null>(null);
  const [editItem, setEditItem] = useState<Partial<TripPlanItem> | null>(null);
  const [showRequests, setShowRequests] = useState(false);
  const [photoView, setPhotoView] = useState<{ photos: TripOptionPhoto[]; index: number; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getTripPlan(planId, wifeView ? 'viewer' : undefined)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [planId, wifeView]);
  useEffect(() => { load(); }, [load]);

  const plan = data?.plan;
  const canEdit = !!plan?.canEdit;
  const pct = plan?.displayDiscountPct ?? 0;

  const optionsByCat = useMemo(() => {
    const map = new Map<string, TripPlanOption[]>();
    for (const o of data?.options ?? []) {
      if (!map.has(o.category)) map.set(o.category, []);
      map.get(o.category)!.push(o);
    }
    return map;
  }, [data]);

  // 일정은 '안(조합)'별로 따로 짤 수 있다. scenarioId가 없는 항목은 모든 안에 공통.
  // 안마다 완결된 일정이라 '전체'로 겹쳐 보면 출국·픽업이 중복돼 보인다 → 항상 한 안만 본다.
  const [scheduleScenario, setScheduleScenario] = useState<number | 'all'>('all');
  const scheduleScenarios = useMemo(
    () => (data?.scenarios ?? []).filter(s => (data?.items ?? []).some(i => i.scenarioId === s.id)),
    [data],
  );

  // 선택된 안이 없으면 추천안(없으면 첫 안)을 기본으로
  const activeScenario = useMemo(() => {
    if (scheduleScenario !== 'all') return scheduleScenario;
    const pref = scheduleScenarios.find(s => s.isPreferred) ?? scheduleScenarios[0];
    return pref ? pref.id : 'all';
  }, [scheduleScenario, scheduleScenarios]);

  const days = useMemo(() => {
    const map = new Map<number, TripPlanItem[]>();
    for (const it of data?.items ?? []) {
      if (activeScenario !== 'all' && it.scenarioId !== null && it.scenarioId !== activeScenario) continue;
      if (!map.has(it.dayIndex)) map.set(it.dayIndex, []);
      map.get(it.dayIndex)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [data, activeScenario]);

  // 지도 점: 일정에 좌표가 있으면 그걸, 없으면 연결된 후보(숙소/명소)의 좌표를 쓴다.
  const mapPoints = useMemo<MapPoint[]>(() => {
    const opts = data?.options ?? [];
    const pts: MapPoint[] = [];
    let n = 0;
    for (const [, list] of days) {
      for (const it of list) {
        const linked = it.optionId ? opts.find(o => o.id === it.optionId) : undefined;
        const lat = it.lat ?? linked?.lat;
        const lng = it.lng ?? linked?.lng;
        if (!Number.isFinite(lat as number) || !Number.isFinite(lng as number)) continue;
        n += 1;
        pts.push({
          id: it.id,
          lat: lat as number,
          lng: lng as number,
          label: `${it.startTime ? hhmm(it.startTime) + ' ' : ''}${it.title}`,
          order: n,
          kind: linked?.category === 'lodging' ? 'stay' : 'spot',
        });
      }
    }
    return pts;
  }, [days, data]);

  const openRequests = (data?.requests ?? []).filter(r => r.status === 'open');

  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    try { await fn(); load(); }
    catch (e: any) { alert(e?.message || '오류가 발생했어요'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className={styles.loading}>불러오는 중...</div>;
  if (!plan) {
    return (
      <div className={styles.empty}>
        <p>계획을 찾을 수 없어요</p>
        <button className={styles.emptyBtn} onClick={onBack}>돌아가기</button>
      </div>
    );
  }

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <button className={styles.iconBtn} onClick={onBack} aria-label="뒤로">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className={styles.detailTitleWrap}>
          <h2 className={styles.detailTitle}>{plan.title}</h2>
          <span className={styles.detailMeta}>
            {plan.destination ? `${plan.destination} · ` : ''}{formatPeriod(plan.startDate, plan.endDate)} · 어른 {plan.adults}{plan.children > 0 ? ` · 아이 ${plan.children}` : ''}
          </span>
        </div>
        {canEdit && (
          <button className={styles.iconBtn} onClick={() => setEditPlan(true)} aria-label="계획 수정">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          </button>
        )}
      </div>

      {/* 플래너 전용 컨트롤: 공개 / 공개가 할인 / 리서치 요청 */}
      {canEdit && (
        <div className={styles.plannerBar}>
          <button
            className={`${styles.plannerBtn} ${plan.status === 'published' ? styles.plannerBtnOn : ''}`}
            disabled={busy}
            onClick={() => run(() => api.updateTripPlan(plan.id, { status: plan.status === 'published' ? 'draft' : 'published' }))}
          >
            {plan.status === 'published' ? <><Icon name="unlock" size={13} /> 공개중</> : <><Icon name="lock" size={13} /> 나만 보기</>}
          </button>
          <button className={`${styles.plannerBtn} ${pct > 0 ? styles.plannerBtnAccent : ''}`} onClick={() => setShowDiscount(true)}>
            공개가 {pct > 0 ? `−${pct}%` : '설정'}
          </button>
          <button className={styles.plannerBtn} onClick={() => setShowRequests(true)}>
            리서치 요청{openRequests.length > 0 ? ` ${openRequests.length}` : ''}
          </button>
        </div>
      )}

      {wifeView && (
        <div className={styles.wifeBanner}>
          <Icon name="eye" size={15} /> <b>황하람님 화면 미리보기</b>
          {data!.previewNotVisibleYet ? ' — 아직 공개 전이라 실제로는 목록에 보이지 않습니다.' : ' — 공개용 금액으로 표시 중입니다.'}
        </div>
      )}

      {canEdit && plan.status !== 'published' && (
        <div className={styles.notice}>이 계획은 아직 나만 보여요. 공개하면 가족에게 보입니다.</div>
      )}
      {canEdit && pct > 0 && (
        <div className={styles.noticeAccent}>
          공개용 금액은 실제보다 <b>{pct}%</b> 낮게 표시됩니다. (내 화면은 실제 금액)
        </div>
      )}

      <div className={styles.sectionTabs}>
        {([['estimate', '견적'], ['calc', '계산기'], ['options', '후보'], ['schedule', '일정']] as [Section, string][]).map(([v, label]) => (
          <button key={v} className={`${styles.sectionTab} ${section === v ? styles.sectionTabActive : ''}`} onClick={() => setSection(v)}>
            {label}
          </button>
        ))}
      </div>

      {/* ---------- 견적(조합 비교) ---------- */}
      {section === 'estimate' && (
        <div className={styles.body}>
          {plan.budgetKrw !== null && (
            <div className={styles.budgetRow}>
              <span>목표 예산</span>
              <strong>{formatKrw(plan.budgetKrw)}</strong>
            </div>
          )}

          {data!.scenarios.length === 0 ? (
            <div className={styles.sectionEmpty}>
              <p>아직 견적 조합이 없어요</p>
              <span>후보를 모은 뒤 조합을 만들면 총액이 자동 계산돼요</span>
            </div>
          ) : (
            data!.scenarios.map(s => {
              const view = discounted(s.totalKrw, pct);
              return (
                <div key={s.id} className={`${styles.scenario} ${s.isPreferred ? styles.scenarioPreferred : ''}`}>
                  <div className={styles.scenarioHead}>
                    <div className={styles.scenarioTitleWrap}>
                      {s.isPreferred && <span className={styles.preferredTag}>추천</span>}
                      <span className={styles.scenarioTitle}>{s.title}</span>
                    </div>
                    <div className={styles.scenarioTotalWrap}>
                      <strong className={styles.scenarioTotal}>{formatKrw(s.totalKrw)}</strong>
                      {canEdit && pct > 0 && <span className={styles.shownPrice}>공개가 {formatKrw(view)}</span>}
                    </div>
                  </div>
                  {s.memo && <p className={styles.scenarioMemo}>{s.memo}</p>}
                  <div className={styles.scenarioOptions}>
                    {s.optionIds.map(oid => {
                      const o = data!.options.find(x => x.id === oid);
                      if (!o) return null;
                      return (
                        <span key={oid} className={styles.chip}>
                          {CAT_LABEL[o.category]?.icon} {o.title}
                          <em>{formatManwon(o.priceKrw)}</em>
                        </span>
                      );
                    })}
                    {s.extraKrw > 0 && <span className={styles.chip}>💵 기타<em>{formatManwon(s.extraKrw)}</em></span>}
                  </div>
                  {canEdit && (
                    <div className={styles.rowActions}>
                      <button onClick={() => run(() => api.updateTripScenario(s.id, { isPreferred: !s.isPreferred }))} disabled={busy}>
                        {s.isPreferred ? '추천 해제' : '추천으로'}
                      </button>
                      <button onClick={() => setEditScenario(s)}>수정</button>
                      <button className={styles.dangerText} onClick={() => { if (confirm(`'${s.title}' 조합을 삭제할까요?`)) run(() => api.deleteTripScenario(s.id)); }}>삭제</button>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {canEdit && (
            <button className={styles.addBtn} onClick={() => setEditScenario({ title: '', extraKrw: 0, optionIds: [] })}>＋ 견적 조합 추가</button>
          )}
        </div>
      )}

      {/* ---------- 조합 계산기 ---------- */}
      {section === 'calc' && (
        <CombinationCalculator
          options={data!.options}
          discountPct={canEdit ? pct : 0}
          canEdit={canEdit}
          onSaved={load}
          planId={plan.id}
        />
      )}

      {/* ---------- 후보 ---------- */}
      {section === 'options' && (
        <div className={styles.body}>
          {data!.options.length === 0 && (
            <div className={styles.sectionEmpty}>
              <p>후보가 없어요</p>
              <span>{canEdit ? '항공·숙소 후보를 추가하거나 리서치를 요청하세요' : '아직 등록된 후보가 없어요'}</span>
            </div>
          )}
          {CATEGORIES.filter(c => optionsByCat.has(c.value)).map(c => (
            <section key={c.value} className={styles.optionSection}>
              <h3 className={styles.optionSectionTitle}>{c.icon} {c.label}<span>{optionsByCat.get(c.value)!.length}</span></h3>
              {optionsByCat.get(c.value)!.map(o => (
                <div key={o.id} className={styles.option}>
                  <div className={styles.optionHead}>
                    <div className={styles.optionTitleWrap}>
                      <span className={styles.optionTitle}>{o.title}</span>
                      {o.provider && <span className={styles.optionProvider}>{o.provider}</span>}
                    </div>
                    <div className={styles.optionPriceWrap}>
                      <strong className={styles.optionPrice}>{formatKrw(o.priceKrw)}</strong>
                      {o.priceNote && <span className={styles.optionPriceNote}>{o.priceNote}</span>}
                      {canEdit && pct > 0 && <span className={styles.shownPrice}>공개가 {formatKrw(discounted(o.priceKrw, pct))}</span>}
                    </div>
                  </div>
                  {(o.startAt || o.endAt || o.durationMin || o.location) && (
                    <div className={styles.optionMeta}>
                      {o.startAt && <span>🕘 {mdhm(o.startAt)}{o.endAt ? ` → ${mdhm(o.endAt)}` : ''}</span>}
                      {!!o.durationMin && <span>⏱ {Math.floor(o.durationMin / 60)}시간 {o.durationMin % 60}분</span>}
                      {o.location && <span>📍 {o.location}</span>}
                      {!!o.rating && <span>⭐ {o.rating}</span>}
                    </div>
                  )}
                  {!!o.photos?.length && (
                    <div className={styles.photoStrip}>
                      {o.photos.map((ph, idx) => (
                        <button
                          key={ph.id}
                          className={styles.photoThumb}
                          onClick={() => setPhotoView({ photos: o.photos!, index: idx, title: o.title })}
                          aria-label={ph.caption || '사진 보기'}
                        >
                          <img src={api.tripPhotoUrl(ph.filename)} alt={ph.caption} loading="lazy" />
                          {ph.caption && <span>{ph.caption}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {(o.pros || o.cons) && (
                    <div className={styles.prosCons}>
                      {o.pros && <div className={styles.pros}>👍 {o.pros}</div>}
                      {o.cons && <div className={styles.cons}>👎 {o.cons}</div>}
                    </div>
                  )}
                  {o.memo && <p className={styles.optionMemo}>{o.memo}</p>}
                  <div className={styles.optionFooter}>
                    {o.url && (
                      <a
                        className={styles.link}
                        href={o.url}
                        target={isNativeApp ? undefined : '_blank'}
                        rel={isNativeApp ? undefined : 'noopener noreferrer'}
                        // 안드로이드 앱(WebView)은 새 창을 못 열어 _blank가 무시된다.
                        // AppShell 외부링크와 동일하게 top-level 이동으로 넘겨 시스템 브라우저가 받게 한다.
                        onClick={e => { if (isNativeApp) { e.preventDefault(); window.location.href = o.url; } }}
                      >
                        예약 링크 ↗
                      </a>
                    )}
                    {o.createdBy === 'agent' && <span className={styles.agentTag}>🤖 조사됨</span>}
                    {canEdit && (
                      <div className={styles.rowActions}>
                        <button onClick={() => setEditOption(o)}>수정</button>
                        <button className={styles.dangerText} onClick={() => { if (confirm(`'${o.title}' 후보를 삭제할까요?`)) run(() => api.deleteTripOption(o.id)); }}>삭제</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </section>
          ))}
          {canEdit && (
            <button className={styles.addBtn} onClick={() => setEditOption({ category: 'flight', title: '' })}>＋ 후보 추가</button>
          )}
        </div>
      )}

      {/* ---------- 일정표 ---------- */}
      {section === 'schedule' && (
        <div className={styles.body}>
          {scheduleScenarios.length > 0 && (
            <div className={styles.scenarioChips}>
              {scheduleScenarios.map(s => (
                <button
                  key={s.id}
                  className={`${styles.scenarioChip} ${activeScenario === s.id ? styles.scenarioChipActive : ''}`}
                  onClick={() => setScheduleScenario(s.id)}
                >
                  {s.title.split('·').pop()!.trim().split('(')[0].trim() || s.title}
                </button>
              ))}
            </div>
          )}
          {mapPoints.length > 1 && (
            <TripMap
              points={mapPoints}
              title={scheduleScenarios.find(s => s.id === activeScenario)?.title.split('·').pop()?.trim() ?? '동선'}
            />
          )}
          {days.length === 0 ? (
            <div className={styles.sectionEmpty}>
              <p>일정표가 비어있어요</p>
              <span>{canEdit ? '일차별로 일정을 추가해보세요' : '아직 일정이 정해지지 않았어요'}</span>
            </div>
          ) : (
            days.map(([dayIndex, list]) => (
              <section key={dayIndex} className={styles.daySection}>
                <h3 className={styles.dayTitle}>
                  Day {dayIndex}
                  {list[0]?.date && <span>{list[0].date.slice(5).replace('-', '/')}</span>}
                </h3>
                {list.map((it, idx) => {
                  const linked = it.optionId ? data!.options.find(o => o.id === it.optionId) : undefined;
                  // 일정 맥락에 맞는 사진을 앞으로 — '수영장' 일정엔 수영장 컷, 체크인/조식엔 객실 컷.
                  const want = /수영장|물놀이/.test(it.title) ? '수영장'
                    : /체크인|조식|숙소|휴식/.test(it.title) ? '객실'
                    : /키즈|아이|어린이/.test(it.title) ? '키즈' : null;
                  const shots = want
                    ? [...(linked?.photos ?? [])].sort((a, b) =>
                        (b.caption?.includes(want) ? 1 : 0) - (a.caption?.includes(want) ? 1 : 0))
                    : (linked?.photos ?? []);
                  return (
                  <div key={it.id} className={styles.item}>
                    <div className={styles.itemRail}>
                      <span className={styles.itemStep}>{idx + 1}</span>
                      <div className={styles.itemTime}>{it.startTime ? hhmm(it.startTime) : '—'}</div>
                    </div>
                    <div className={styles.itemBody}>
                      <div className={styles.itemTitleRow}>
                        <span className={styles.itemTitle}>{it.title}</span>
                        {it.costKrw !== null && <span className={styles.itemCost}>{formatManwon(it.costKrw)}</span>}
                      </div>
                      {(it.place || linked?.location) && <span className={styles.itemPlace}>📍 {it.place || linked?.location}</span>}
                      {shots.length > 0 && (
                        <div className={styles.photoStrip}>
                          {shots.slice(0, 6).map((ph, i) => (
                            <button key={ph.id} className={styles.photoThumbSm} onClick={() => setPhotoView({ photos: shots, index: i, title: linked!.title })}>
                              <img src={api.tripPhotoUrl(ph.filename)} alt="" loading="lazy" />
                            </button>
                          ))}
                        </div>
                      )}
                      {it.memo && <p className={styles.itemMemo}>{it.memo}</p>}
                      {canEdit && (
                        <div className={styles.rowActions}>
                          <button onClick={() => setEditItem(it)}>수정</button>
                          <button className={styles.dangerText} onClick={() => { if (confirm('이 일정을 삭제할까요?')) run(() => api.deleteTripItem(it.id)); }}>삭제</button>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </section>
            ))
          )}
          {canEdit && (
            <button className={styles.addBtn} onClick={() => setEditItem({ dayIndex: (days.at(-1)?.[0] ?? 0) + 1, title: '' })}>＋ 일정 추가</button>
          )}
        </div>
      )}

      {/* ---------- 시트들 ---------- */}
      {editPlan && (
        <PlanForm
          initial={plan}
          onClose={() => setEditPlan(false)}
          onDelete={async () => {
            if (!confirm(`'${plan.title}' 계획을 삭제할까요? 후보·조합·일정이 모두 지워집니다.`)) return;
            await api.deleteTripPlan(plan.id);
            onBack();
          }}
          onSubmit={async (d) => { await api.updateTripPlan(plan.id, d as any); setEditPlan(false); load(); }}
        />
      )}

      {showDiscount && (
        <DiscountSheet
          plan={plan}
          scenarios={data!.scenarios}
          onClose={() => setShowDiscount(false)}
          onSave={async (v) => { await api.updateTripPlan(plan.id, { displayDiscountPct: v }); setShowDiscount(false); load(); }}
        />
      )}

      {editOption && (
        <OptionForm
          initial={editOption}
          onClose={() => setEditOption(null)}
          onSubmit={async (d) => {
            if (editOption.id) await api.updateTripOption(editOption.id, d);
            else await api.addTripOptions(plan.id, [d]);
            setEditOption(null);
            load();
          }}
        />
      )}

      {editScenario && (
        <ScenarioForm
          initial={editScenario}
          options={data!.options}
          onClose={() => setEditScenario(null)}
          onSubmit={async (d) => {
            if (editScenario.id) await api.updateTripScenario(editScenario.id, d);
            else await api.createTripScenario(plan.id, d as any);
            setEditScenario(null);
            load();
          }}
        />
      )}

      {editItem && (
        <ItemForm
          initial={editItem}
          options={data!.options}
          onClose={() => setEditItem(null)}
          onSubmit={async (d) => {
            if (editItem.id) await api.updateTripItem(editItem.id, d);
            else await api.addTripItems(plan.id, [d]);
            setEditItem(null);
            load();
          }}
        />
      )}

      {photoView && (
        <PhotoViewer
          photos={photoView.photos}
          index={photoView.index}
          title={photoView.title}
          onClose={() => setPhotoView(null)}
        />
      )}

      {showRequests && (
        <RequestSheet
          planId={plan.id}
          requests={data!.requests}
          onClose={() => setShowRequests(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ============================================================
// 사진 뷰어 (숙소 수영장/객실 사진 크게 보기)
// ============================================================

function PhotoViewer({ photos, index, title, onClose }: {
  photos: TripOptionPhoto[];
  index: number;
  title: string;
  onClose: () => void;
}) {
  const [i, setI] = useState(index);
  const cur = photos[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI(v => Math.min(v + 1, photos.length - 1));
      if (e.key === 'ArrowLeft') setI(v => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, photos.length]);

  // 모바일 좌우 스와이프
  const touch = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touch.current === null) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    if (Math.abs(dx) > 50) setI(v => Math.max(0, Math.min(photos.length - 1, v + (dx < 0 ? 1 : -1))));
    touch.current = null;
  };

  if (!cur) return null;

  return (
    <div className={styles.photoOverlay} onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className={styles.photoHeader} onClick={e => e.stopPropagation()}>
        <span className={styles.photoTitle}>{title}</span>
        <span className={styles.photoCount}>{i + 1} / {photos.length}</span>
        <button className={styles.photoClose} onClick={onClose} aria-label="닫기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <img className={styles.photoFull} src={api.tripPhotoUrl(cur.filename)} alt={cur.caption} onClick={e => e.stopPropagation()} />
      {cur.caption && <div className={styles.photoCaption}>{cur.caption}</div>}
      {photos.length > 1 && (
        <div className={styles.photoNav} onClick={e => e.stopPropagation()}>
          <button onClick={() => setI(v => Math.max(0, v - 1))} disabled={i === 0} aria-label="이전">‹</button>
          <button onClick={() => setI(v => Math.min(photos.length - 1, v + 1))} disabled={i === photos.length - 1} aria-label="다음">›</button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 조합 계산기 — 카테고리별로 후보를 바꿔가며 총액을 즉시 확인
// ============================================================

function CombinationCalculator({ options, discountPct, canEdit, planId, onSaved }: {
  options: TripPlanOption[];
  discountPct: number;
  canEdit: boolean;
  planId: number;
  onSaved: () => void;
}) {
  const cats = CATEGORIES.filter(c => options.some(o => o.category === c.value && c.value !== 'etc'));
  const etcOptions = options.filter(o => o.category === 'etc');

  // 카테고리별 기본 선택: 가장 저렴한 후보
  const [picked, setPicked] = useState<Record<string, number | null>>(() => {
    const init: Record<string, number | null> = {};
    for (const c of cats) {
      const list = options.filter(o => o.category === c.value && o.priceKrw !== null);
      const cheapest = list.slice().sort((a, b) => (a.priceKrw ?? 0) - (b.priceKrw ?? 0))[0];
      init[c.value] = cheapest ? cheapest.id : null;
    }
    return init;
  });
  const [extra, setExtra] = useState<string>(String(etcOptions[0]?.priceKrw ?? 0));
  const [saving, setSaving] = useState(false);

  const chosen = cats
    .map(c => options.find(o => o.id === picked[c.value]))
    .filter((o): o is TripPlanOption => !!o);

  const extraNum = numOrNull(extra) ?? 0;
  const total = chosen.reduce((sum, o) => sum + (o.priceKrw ?? 0), 0) + extraNum;

  // 가능한 조합 수 (선택 안 함 포함)
  const comboCount = cats.reduce((n, c) => n * (options.filter(o => o.category === c.value).length + 1), 1);

  // 이 계획에서 나올 수 있는 최저/최고 총액
  const range = cats.reduce((acc, c) => {
    const prices = options.filter(o => o.category === c.value && o.priceKrw !== null).map(o => o.priceKrw as number);
    if (prices.length === 0) return acc;
    return { min: acc.min + Math.min(...prices), max: acc.max + Math.max(...prices) };
  }, { min: extraNum, max: extraNum });

  const save = async () => {
    const title = prompt('이 조합의 이름을 정해주세요', '내가 만든 조합');
    if (!title?.trim()) return;
    setSaving(true);
    try {
      await api.createTripScenario(planId, {
        title: title.trim(),
        memo: '조합 계산기에서 저장',
        extraKrw: extraNum,
        optionIds: chosen.map(o => o.id),
      });
      onSaved();
      alert('견적 조합으로 저장했어요. "견적" 탭에서 확인하세요.');
    } catch (e: any) {
      alert(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.body}>
      <div className={styles.calcSummary}>
        <span className={styles.calcSummaryLabel}>이 조합의 총액</span>
        <strong className={styles.calcTotal}>{formatKrw(total)}</strong>
        {canEdit && discountPct > 0 && (
          <span className={styles.shownPrice}>공개가 {formatKrw(discounted(total, discountPct))}</span>
        )}
        <span className={styles.calcRange}>
          가능 범위 {formatManwon(range.min)} ~ {formatManwon(range.max)} · 조합 {comboCount.toLocaleString('ko-KR')}가지
        </span>
      </div>

      {cats.map(c => {
        const list = options.filter(o => o.category === c.value);
        return (
          <section key={c.value} className={styles.calcSection}>
            <h3 className={styles.calcSectionTitle}>{c.icon} {c.label}<span>{list.length}</span></h3>
            <div className={styles.calcList}>
              <button
                className={`${styles.calcItem} ${picked[c.value] === null ? styles.calcItemActive : ''}`}
                onClick={() => setPicked(p => ({ ...p, [c.value]: null }))}
              >
                <span className={styles.calcRadio} />
                <span className={styles.calcItemTitle}>선택 안 함</span>
                <span className={styles.calcItemPrice}>0원</span>
              </button>
              {list.map(o => (
                <button
                  key={o.id}
                  className={`${styles.calcItem} ${picked[c.value] === o.id ? styles.calcItemActive : ''}`}
                  onClick={() => setPicked(p => ({ ...p, [c.value]: o.id }))}
                >
                  <span className={styles.calcRadio} />
                  <span className={styles.calcItemTitle}>
                    {o.title}
                    {o.priceNote && <em>{o.priceNote}</em>}
                  </span>
                  <span className={styles.calcItemPrice}>{formatManwon(o.priceKrw)}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      <section className={styles.calcSection}>
        <h3 className={styles.calcSectionTitle}>💵 기타 비용</h3>
        <input className={styles.calcExtra} inputMode="numeric" value={extra} onChange={e => setExtra(e.target.value)} placeholder="식비·관광 등" />
        {etcOptions[0]?.memo && <span className={styles.fieldHint}>{etcOptions[0].memo}</span>}
      </section>

      {canEdit && (
        <button className={styles.addBtn} onClick={save} disabled={saving || chosen.length === 0}>
          {saving ? '저장 중...' : '＋ 이 조합을 견적으로 저장'}
        </button>
      )}
    </div>
  );
}

// ============================================================
// 공통 시트
// ============================================================

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.sheetHeader}>
          <h3>{title}</h3>
          <button className={styles.sheetClose} onClick={onClose} aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
        {footer && <div className={styles.sheetFooter}>{footer}</div>}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

function numOrNull(v: string): number | null {
  const t = v.replace(/[,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ---------- 계획 폼 ----------

function PlanForm({ initial, onClose, onSubmit, onDelete }: {
  initial?: TripPlan;
  onClose: () => void;
  onSubmit: (d: Record<string, any>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [destination, setDestination] = useState(initial?.destination ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [adults, setAdults] = useState(String(initial?.adults ?? 2));
  const [children, setChildren] = useState(String(initial?.children ?? 1));
  const [budget, setBudget] = useState(initial?.budgetKrw != null ? String(initial.budgetKrw) : '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit({
        title: title.trim(), destination: destination.trim(),
        startDate: startDate || null, endDate: endDate || null,
        adults: numOrNull(adults) ?? 2, children: numOrNull(children) ?? 0,
        budgetKrw: numOrNull(budget), memo,
      });
    } catch (e: any) { alert(e?.message || '저장 실패'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet
      title={initial ? '계획 수정' : '새 여행 계획'}
      onClose={onClose}
      footer={
        <>
          {onDelete && <button className={styles.dangerBtn} onClick={onDelete}>삭제</button>}
          <button className={styles.primaryBtn} onClick={submit} disabled={busy || !title.trim()}>{busy ? '저장 중...' : '저장'}</button>
        </>
      }
    >
      <Field label="여행 이름"><input value={title} maxLength={100} onChange={e => setTitle(e.target.value)} placeholder="예: 오사카 가족여행" autoFocus /></Field>
      <Field label="목적지"><input value={destination} maxLength={100} onChange={e => setDestination(e.target.value)} placeholder="예: 일본 오사카" /></Field>
      <div className={styles.fieldRow}>
        <Field label="출발일"><input type="date" value={startDate ?? ''} onChange={e => setStartDate(e.target.value)} /></Field>
        <Field label="도착일"><input type="date" value={endDate ?? ''} onChange={e => setEndDate(e.target.value)} /></Field>
      </div>
      <div className={styles.fieldRow}>
        <Field label="어른"><input type="number" inputMode="numeric" min={0} value={adults} onChange={e => setAdults(e.target.value)} /></Field>
        <Field label="아이"><input type="number" inputMode="numeric" min={0} value={children} onChange={e => setChildren(e.target.value)} /></Field>
      </div>
      <Field label="목표 예산 (원)" hint="비워두면 미정">
        <input inputMode="numeric" value={budget} onChange={e => setBudget(e.target.value)} placeholder="예: 3000000" />
      </Field>
      <Field label="메모"><textarea rows={3} value={memo} onChange={e => setMemo(e.target.value)} placeholder="가고 싶은 이유, 조건 등" /></Field>
    </Sheet>
  );
}

// ---------- 공개가 할인 ----------

function DiscountSheet({ plan, scenarios, onClose, onSave }: {
  plan: TripPlan;
  scenarios: TripPlanScenario[];
  onClose: () => void;
  onSave: (v: number) => Promise<void>;
}) {
  const [pct, setPct] = useState(plan.displayDiscountPct);
  const [busy, setBusy] = useState(false);
  const sample = scenarios.find(s => s.isPreferred) ?? scenarios[0];

  return (
    <Sheet
      title="공개용 금액 조정"
      onClose={onClose}
      footer={
        <button
          className={styles.primaryBtn}
          disabled={busy}
          onClick={async () => { setBusy(true); try { await onSave(pct); } catch (e: any) { alert(e?.message || '저장 실패'); } finally { setBusy(false); } }}
        >
          {busy ? '저장 중...' : '저장'}
        </button>
      }
    >
      <p className={styles.sheetDesc}>
        가족에게 보이는 모든 금액(후보·조합·일정)에 이 비율만큼 낮춰서 표시합니다.
        실제 금액은 내 화면에서만 보여요.
      </p>
      <div className={styles.discountValue}>−{pct}%</div>
      <input className={styles.range} type="range" min={0} max={90} step={1} value={pct} onChange={e => setPct(Number(e.target.value))} />
      <div className={styles.discountPresets}>
        {[0, 10, 15, 20, 30, 40].map(v => (
          <button key={v} className={`${styles.presetBtn} ${pct === v ? styles.presetBtnActive : ''}`} onClick={() => setPct(v)}>
            {v === 0 ? '없음' : `−${v}%`}
          </button>
        ))}
      </div>
      {sample && (
        <div className={styles.discountPreview}>
          <div><span>실제 ({sample.title})</span><strong>{formatKrw(sample.totalKrw)}</strong></div>
          <div className={styles.discountPreviewShown}><span>가족에게 보이는 금액</span><strong>{formatKrw(discounted(sample.totalKrw, pct))}</strong></div>
        </div>
      )}
    </Sheet>
  );
}

// ---------- 후보 폼 ----------

function OptionForm({ initial, onClose, onSubmit }: {
  initial: Partial<TripPlanOption>;
  onClose: () => void;
  onSubmit: (d: Partial<TripPlanOption>) => Promise<void>;
}) {
  const [category, setCategory] = useState<TripOptionCategory>((initial.category as TripOptionCategory) ?? 'flight');
  const [title, setTitle] = useState(initial.title ?? '');
  const [provider, setProvider] = useState(initial.provider ?? '');
  const [price, setPrice] = useState(initial.priceKrw != null ? String(initial.priceKrw) : '');
  const [priceNote, setPriceNote] = useState(initial.priceNote ?? '');
  const [startAt, setStartAt] = useState((initial.startAt ?? '').slice(0, 16).replace(' ', 'T'));
  const [endAt, setEndAt] = useState((initial.endAt ?? '').slice(0, 16).replace(' ', 'T'));
  const [location, setLocation] = useState(initial.location ?? '');
  const [url, setUrl] = useState(initial.url ?? '');
  const [rating, setRating] = useState(initial.rating != null ? String(initial.rating) : '');
  const [pros, setPros] = useState(initial.pros ?? '');
  const [cons, setCons] = useState(initial.cons ?? '');
  const [memo, setMemo] = useState(initial.memo ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit({
        category, title: title.trim(), provider: provider.trim(),
        priceKrw: numOrNull(price), priceNote: priceNote.trim(),
        startAt: startAt ? startAt.replace('T', ' ') + ':00' : null,
        endAt: endAt ? endAt.replace('T', ' ') + ':00' : null,
        location: location.trim(), url: url.trim(),
        rating: rating ? Number(rating) : null,
        pros, cons, memo,
      });
    } catch (e: any) { alert(e?.message || '저장 실패'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet
      title={initial.id ? '후보 수정' : '후보 추가'}
      onClose={onClose}
      footer={<button className={styles.primaryBtn} onClick={submit} disabled={busy || !title.trim()}>{busy ? '저장 중...' : '저장'}</button>}
    >
      <Field label="분류">
        <div className={styles.catPicker}>
          {CATEGORIES.map(c => (
            <button key={c.value} type="button" className={`${styles.catBtn} ${category === c.value ? styles.catBtnActive : ''}`} onClick={() => setCategory(c.value)}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="이름"><input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="예: 대한항공 KE721 / 호텔 그랑비아 트윈" autoFocus /></Field>
      <Field label="업체/항공사"><input value={provider} maxLength={120} onChange={e => setProvider(e.target.value)} placeholder="예: 대한항공" /></Field>
      <div className={styles.fieldRow}>
        <Field label="가격 (원)"><input inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} placeholder="예: 1240000" /></Field>
        <Field label="가격 기준"><input value={priceNote} maxLength={200} onChange={e => setPriceNote(e.target.value)} placeholder="예: 2인 왕복" /></Field>
      </div>
      <div className={styles.fieldRow}>
        <Field label="시작/출발"><input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} /></Field>
        <Field label="종료/도착"><input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)} /></Field>
      </div>
      <div className={styles.fieldRow}>
        <Field label="위치"><input value={location} maxLength={200} onChange={e => setLocation(e.target.value)} placeholder="예: 난바역 도보 5분" /></Field>
        <Field label="평점"><input inputMode="decimal" value={rating} onChange={e => setRating(e.target.value)} placeholder="예: 4.5" /></Field>
      </div>
      <Field label="링크"><input value={url} maxLength={1000} onChange={e => setUrl(e.target.value)} placeholder="https://" /></Field>
      <div className={styles.fieldRow}>
        <Field label="장점"><textarea rows={2} value={pros} onChange={e => setPros(e.target.value)} /></Field>
        <Field label="단점"><textarea rows={2} value={cons} onChange={e => setCons(e.target.value)} /></Field>
      </div>
      <Field label="메모"><textarea rows={2} value={memo} onChange={e => setMemo(e.target.value)} /></Field>
    </Sheet>
  );
}

// ---------- 조합 폼 ----------

function ScenarioForm({ initial, options, onClose, onSubmit }: {
  initial: Partial<TripPlanScenario>;
  options: TripPlanOption[];
  onClose: () => void;
  onSubmit: (d: { title: string; memo: string; extraKrw: number; optionIds: number[] }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [memo, setMemo] = useState(initial.memo ?? '');
  const [extra, setExtra] = useState(initial.extraKrw != null ? String(initial.extraKrw) : '');
  const [selected, setSelected] = useState<Set<number>>(new Set(initial.optionIds ?? []));
  const [busy, setBusy] = useState(false);

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const total = options.filter(o => selected.has(o.id)).reduce((sum, o) => sum + (o.priceKrw ?? 0), 0) + (numOrNull(extra) ?? 0);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try { await onSubmit({ title: title.trim(), memo, extraKrw: numOrNull(extra) ?? 0, optionIds: Array.from(selected) }); }
    catch (e: any) { alert(e?.message || '저장 실패'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet
      title={initial.id ? '조합 수정' : '견적 조합 추가'}
      onClose={onClose}
      footer={
        <>
          <span className={styles.footerTotal}>합계 {formatKrw(total)}</span>
          <button className={styles.primaryBtn} onClick={submit} disabled={busy || !title.trim()}>{busy ? '저장 중...' : '저장'}</button>
        </>
      }
    >
      <Field label="조합 이름"><input value={title} maxLength={100} onChange={e => setTitle(e.target.value)} placeholder="예: 알뜰안 / 편한안" autoFocus /></Field>
      <Field label="포함할 후보">
        {options.length === 0 ? (
          <span className={styles.fieldHint}>먼저 후보를 추가하세요</span>
        ) : (
          <div className={styles.pickList}>
            {options.map(o => (
              <button key={o.id} type="button" className={`${styles.pickItem} ${selected.has(o.id) ? styles.pickItemActive : ''}`} onClick={() => toggle(o.id)}>
                <span className={styles.pickCheck}>{selected.has(o.id) ? '✓' : ''}</span>
                <span className={styles.pickTitle}>{CAT_LABEL[o.category]?.icon} {o.title}</span>
                <span className={styles.pickPrice}>{formatManwon(o.priceKrw)}</span>
              </button>
            ))}
          </div>
        )}
      </Field>
      <Field label="기타 비용 (원)" hint="식비·쇼핑 등 뭉뚱그린 금액">
        <input inputMode="numeric" value={extra} onChange={e => setExtra(e.target.value)} placeholder="예: 500000" />
      </Field>
      <Field label="메모"><textarea rows={2} value={memo} onChange={e => setMemo(e.target.value)} /></Field>
    </Sheet>
  );
}

// ---------- 일정 폼 ----------

function ItemForm({ initial, options, onClose, onSubmit }: {
  initial: Partial<TripPlanItem>;
  options: TripPlanOption[];
  onClose: () => void;
  onSubmit: (d: Partial<TripPlanItem>) => Promise<void>;
}) {
  const [dayIndex, setDayIndex] = useState(String(initial.dayIndex ?? 1));
  const [date, setDate] = useState(initial.date ?? '');
  const [startTime, setStartTime] = useState((initial.startTime ?? '').slice(0, 5));
  const [endTime, setEndTime] = useState((initial.endTime ?? '').slice(0, 5));
  const [title, setTitle] = useState(initial.title ?? '');
  const [place, setPlace] = useState(initial.place ?? '');
  const [cost, setCost] = useState(initial.costKrw != null ? String(initial.costKrw) : '');
  const [optionId, setOptionId] = useState(initial.optionId != null ? String(initial.optionId) : '');
  const [memo, setMemo] = useState(initial.memo ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit({
        dayIndex: numOrNull(dayIndex) ?? 1,
        date: date || null,
        startTime: startTime || null,
        endTime: endTime || null,
        title: title.trim(), place: place.trim(),
        costKrw: numOrNull(cost),
        optionId: optionId ? Number(optionId) : null,
        memo,
      });
    } catch (e: any) { alert(e?.message || '저장 실패'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet
      title={initial.id ? '일정 수정' : '일정 추가'}
      onClose={onClose}
      footer={<button className={styles.primaryBtn} onClick={submit} disabled={busy || !title.trim()}>{busy ? '저장 중...' : '저장'}</button>}
    >
      <div className={styles.fieldRow}>
        <Field label="며칠차"><input type="number" inputMode="numeric" min={1} value={dayIndex} onChange={e => setDayIndex(e.target.value)} /></Field>
        <Field label="날짜"><input type="date" value={date ?? ''} onChange={e => setDate(e.target.value)} /></Field>
      </div>
      <div className={styles.fieldRow}>
        <Field label="시작"><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></Field>
        <Field label="종료"><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} /></Field>
      </div>
      <Field label="일정"><input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="예: 유니버설 스튜디오" autoFocus /></Field>
      <Field label="장소"><input value={place} maxLength={200} onChange={e => setPlace(e.target.value)} /></Field>
      <Field label="비용 (원)"><input inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)} /></Field>
      <Field label="연결된 후보" hint="선택하면 어떤 후보의 일정인지 표시돼요">
        <select value={optionId} onChange={e => setOptionId(e.target.value)}>
          <option value="">없음</option>
          {options.map(o => <option key={o.id} value={o.id}>{CAT_LABEL[o.category]?.label} · {o.title}</option>)}
        </select>
      </Field>
      <Field label="메모"><textarea rows={2} value={memo} onChange={e => setMemo(e.target.value)} /></Field>
    </Sheet>
  );
}

// ---------- 리서치 요청 ----------

function RequestSheet({ planId, requests, onClose, onChanged }: {
  planId: number;
  requests: TripPlanRequest[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    try { await api.createTripRequest(planId, content.trim()); setContent(''); onChanged(); }
    catch (e: any) { alert(e?.message || '실패'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title="리서치 요청" onClose={onClose}>
      <p className={styles.sheetDesc}>
        조사하고 싶은 내용을 남겨두면 Claude가 읽고 후보·견적을 채워넣습니다.
        (예: "3월 셋째 주 오사카 3박, 2인+아기, 예산 300만원. 직항 위주로")
      </p>
      <Field label="새 요청">
        <textarea rows={3} value={content} onChange={e => setContent(e.target.value)} placeholder="조사할 내용을 적어주세요" />
      </Field>
      <button className={styles.primaryBtn} onClick={add} disabled={busy || !content.trim()}>{busy ? '등록 중...' : '요청 등록'}</button>

      <div className={styles.requestList}>
        {requests.length === 0 && <span className={styles.fieldHint}>아직 요청이 없어요</span>}
        {requests.map(r => (
          <div key={r.id} className={`${styles.request} ${r.status === 'done' ? styles.requestDone : ''}`}>
            <div className={styles.requestHead}>
              <span className={styles.requestStatus}>{r.status === 'done' ? '완료' : '대기중'}</span>
              <span className={styles.requestDate}>{r.createdAt?.slice(5, 16)}</span>
            </div>
            <p className={styles.requestContent}>{r.content}</p>
            {r.resultNote && <p className={styles.requestResult}>🤖 {r.resultNote}</p>}
            <div className={styles.rowActions}>
              <button onClick={async () => { await api.updateTripRequest(r.id, { status: r.status === 'done' ? 'open' : 'done' }); onChanged(); }}>
                {r.status === 'done' ? '다시 대기' : '완료 처리'}
              </button>
              <button className={styles.dangerText} onClick={async () => { if (confirm('요청을 삭제할까요?')) { await api.deleteTripRequest(r.id); onChanged(); } }}>삭제</button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
