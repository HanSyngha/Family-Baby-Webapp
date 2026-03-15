import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type User, type Baby, type Feeding, type Sleep, type Diaper, type BabySummary, type BabyObservation, type BabyChatMessage, type VaccineItem, type VaccinationCompletion, type GrowthRecord, type WHOStandards } from '../api';
import styles from './Parenting.module.css';

interface Props {
  user: User;
}

type SubTab = 'feeding' | 'sleep' | 'diaper' | 'vaccination' | 'growth' | 'observations' | 'chat';
type FeedingType = 'formula' | 'breast';
type Side = 'left' | 'right';
type DiaperType = 'pee' | 'poop' | 'both';

const SUB_TABS: { value: SubTab; label: string; icon: string }[] = [
  { value: 'feeding', label: '수유', icon: '🍼' },
  { value: 'sleep', label: '수면', icon: '💤' },
  { value: 'diaper', label: '기저귀', icon: '🧷' },
  { value: 'vaccination', label: '접종', icon: '💉' },
  { value: 'growth', label: '성장', icon: '📏' },
  { value: 'observations', label: '특이사항', icon: '📋' },
  { value: 'chat', label: '상담', icon: '💬' },
];

function pad(n: number) { return n.toString().padStart(2, '0'); }

function nowKST(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTime(dateStr: string): string {
  const parts = dateStr.split(' ');
  if (parts.length < 2) return dateStr;
  const timeParts = parts[1].split(':');
  return `${timeParts[0]}:${timeParts[1]}`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${pad(s)}초`;
  return `${s}초`;
}

function formatTimerDisplay(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad(m)}:${pad(s)}`;
}

// LocalStorage keys
const LS_BREAST_TIMER = 'peanut_breast_timer';

interface TimerState {
  startedAt: number; // unix ms (original start, for record)
  side?: Side;
  isPaused?: boolean;
  accumulatedMs?: number; // total elapsed ms from previous running periods
  lastResumedAt?: number; // unix ms when last resumed
}

function toDatetimeLocal(d?: Date): string {
  const now = d || new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function datetimeLocalToKST(v: string): string {
  return v.replace('T', ' ') + ':00';
}

export default function Parenting({ user }: Props) {
  const [babies, setBabies] = useState<Baby[]>([]);
  const [selectedBabyId, setSelectedBabyId] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<SubTab>('feeding');
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [sleeps, setSleeps] = useState<Sleep[]>([]);
  const [autoSleepEnabled, setAutoSleepEnabled] = useState(false);
  const [summary, setSummary] = useState<BabySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);

  // Formula modal
  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [formulaAmount, setFormulaAmount] = useState(120);

  // Breast feeding
  const [breastTimer, setBreastTimer] = useState<TimerState | null>(null);
  const [breastElapsed, setBreastElapsed] = useState(0);
  const [showBreastModal, setShowBreastModal] = useState(false);
  const [breastMode, setBreastMode] = useState<'choose' | 'now' | 'past'>('choose');
  const [breastSide, setBreastSide] = useState<Side>('left');

  // Sleep record modal
  const [showSleepModal, setShowSleepModal] = useState<'sleep' | 'wake' | null>(null);
  const [sleepDateTime, setSleepDateTime] = useState(toDatetimeLocal());

  // Past feeding record modal
  const [showPastFeedingModal, setShowPastFeedingModal] = useState(false);
  const [pastFeeding, setPastFeeding] = useState({ type: 'formula' as FeedingType, dateTime: toDatetimeLocal(), amountMl: 120, side: 'left' as Side, durationMin: 10 });

  // Diapers
  const [diapers, setDiapers] = useState<Diaper[]>([]);
  const [showDiaperConditionModal, setShowDiaperConditionModal] = useState(false);
  const [pendingDiaperType, setPendingDiaperType] = useState<DiaperType>('poop');
  const [diaperColor, setDiaperColor] = useState('yellow');
  const [diaperConsistency, setDiaperConsistency] = useState('soft');

  // Edit modal
  const [editItem, setEditItem] = useState<{ type: 'feeding' | 'sleep' | 'diaper'; item: any } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'feeding' | 'sleep' | 'diaper'; id: number } | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  // Baby management
  const [showBabyModal, setShowBabyModal] = useState(false);
  const [babyForm, setBabyForm] = useState({ name: '', birthDate: '', gender: '' as '' | 'M' | 'F' });
  const [editingBabyId, setEditingBabyId] = useState<number | null>(null);
  const [showBabyMenu, setShowBabyMenu] = useState<number | null>(null);

  // Observations
  const [observations, setObservations] = useState<BabyObservation[]>([]);
  const [obsInput, setObsInput] = useState('');
  const [obsLoading, setObsLoading] = useState(false);

  // Vaccination
  const [vaccSchedule, setVaccSchedule] = useState<VaccineItem[]>([]);
  const [vaccCompletions, setVaccCompletions] = useState<VaccinationCompletion[]>([]);
  const [vaccChoices, setVaccChoices] = useState({ combo: 'hexa', rota: 'rv5', je: 'ijev' });
  const [vaccLoading, setVaccLoading] = useState(false);
  const [vaccCompleteModal, setVaccCompleteModal] = useState<VaccineItem | null>(null);
  const [vaccCompleteDate, setVaccCompleteDate] = useState(toDatetimeLocal().split('T')[0]);
  const [vaccHospital, setVaccHospital] = useState('');

  // Growth records
  const [growthRecords, setGrowthRecords] = useState<GrowthRecord[]>([]);
  const [growthStandards, setGrowthStandards] = useState<WHOStandards | null>(null);
  const [growthGender, setGrowthGender] = useState<'M' | 'F'>('F');
  const [growthLoading, setGrowthLoading] = useState(false);
  const [growthChartType, setGrowthChartType] = useState<'weight' | 'height' | 'head'>('weight');
  const [showGrowthModal, setShowGrowthModal] = useState(false);
  const [growthForm, setGrowthForm] = useState({ date: '', weightKg: '', heightCm: '', headCm: '', memo: '' });
  const [growthDetailRecord, setGrowthDetailRecord] = useState<GrowthRecord | null>(null);

  // Worry chat
  const [chatMessages, setChatMessages] = useState<BabyChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================================
  // Data loading
  // ============================================================

  const loadBabies = useCallback(async () => {
    try {
      const data = await api.getBabies();
      setBabies(data);
      if (data.length > 0 && !data.find(b => b.id === selectedBabyId)) {
        setSelectedBabyId(data[0].id);
      }
    } catch (err) {
      console.error('[Parenting] Load babies error:', err);
    }
  }, [selectedBabyId]);

  const handleAddBaby = async () => {
    if (!babyForm.name.trim()) return;
    try {
      const newBaby = await api.createBaby({
        name: babyForm.name.trim(),
        birthDate: babyForm.birthDate || undefined,
        gender: babyForm.gender || undefined
      });
      setBabies(prev => [...prev, newBaby]);
      setSelectedBabyId(newBaby.id);
      setShowBabyModal(false);
      setBabyForm({ name: '', birthDate: '', gender: '' });
    } catch (err) {
      console.error('[Parenting] Add baby error:', err);
    }
  };

  const handleEditBaby = async () => {
    if (!editingBabyId || !babyForm.name.trim()) return;
    try {
      const updated = await api.updateBaby(editingBabyId, {
        name: babyForm.name.trim(),
        birthDate: babyForm.birthDate || undefined,
        gender: babyForm.gender || undefined
      });
      setBabies(prev => prev.map(b => b.id === editingBabyId ? updated : b));
      setShowBabyModal(false);
      setBabyForm({ name: '', birthDate: '', gender: '' });
      setEditingBabyId(null);
    } catch (err) {
      console.error('[Parenting] Edit baby error:', err);
    }
  };

  const handleDeleteBaby = async (id: number) => {
    if (babies.length <= 1) return;
    try {
      await api.deleteBaby(id);
      setBabies(prev => prev.filter(b => b.id !== id));
      if (selectedBabyId === id) {
        const remaining = babies.filter(b => b.id !== id);
        if (remaining.length > 0) setSelectedBabyId(remaining[0].id);
      }
      setShowBabyMenu(null);
    } catch (err) {
      console.error('[Parenting] Delete baby error:', err);
    }
  };

  const openBabyEdit = (baby: Baby) => {
    setEditingBabyId(baby.id);
    setBabyForm({ name: baby.name, birthDate: baby.birthDate || '', gender: baby.gender || '' });
    setShowBabyModal(true);
    setShowBabyMenu(null);
  };

  const openBabyAdd = () => {
    setEditingBabyId(null);
    setBabyForm({ name: '', birthDate: '', gender: '' });
    setShowBabyModal(true);
  };

  const loadData = useCallback(async () => {
    try {
      const [feedingData, sleepData, diaperData, summaryData] = await Promise.all([
        api.getFeedings(selectedBabyId),
        api.getSleeps(selectedBabyId),
        api.getDiapers(selectedBabyId),
        api.getBabySummary(selectedBabyId),
      ]);
      setFeedings(feedingData);
      setSleeps(sleepData);
      setDiapers(diaperData);
      setSummary(summaryData);

      // 분유 기본값: 가장 최근 분유 기록의 amountMl
      const lastFormula = feedingData.find(f => f.type === 'formula');
      if (lastFormula?.amountMl) {
        setFormulaAmount(lastFormula.amountMl);
      }
    } catch (err) {
      console.error('[Parenting] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBabyId]);

  const loadObservations = useCallback(async () => {
    try {
      const data = await api.getObservations(selectedBabyId);
      setObservations(data);
    } catch (err) {
      console.error('[Parenting] Observations load error:', err);
    }
  }, [selectedBabyId]);

  const loadChat = useCallback(async () => {
    try {
      const data = await api.getChatMessages(selectedBabyId);
      setChatMessages(data);
    } catch (err) {
      console.error('[Parenting] Chat load error:', err);
    }
  }, [selectedBabyId]);

  useEffect(() => {
    loadBabies();
  }, [loadBabies]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // 자동 수면 설정 로드
  useEffect(() => {
    api.getBabySettings().then(settings => {
      const s = settings.find(s => s.key === 'auto_sleep_enabled');
      setAutoSleepEnabled(s?.value === 'true');
    }).catch(() => {});
  }, []);

  const loadVaccinations = useCallback(async () => {
    setVaccLoading(true);
    try {
      const data = await api.getVaccinations(selectedBabyId);
      setVaccSchedule(data.schedule);
      setVaccCompletions(data.completions);
      setVaccChoices(data.choices);
    } catch (err) {
      console.error('[Parenting] Vaccination load error:', err);
    } finally {
      setVaccLoading(false);
    }
  }, [selectedBabyId]);

  const loadGrowth = useCallback(async () => {
    setGrowthLoading(true);
    try {
      const data = await api.getGrowthRecords(selectedBabyId);
      setGrowthRecords(data.records);
      setGrowthStandards(data.standards);
      setGrowthGender(data.gender);
    } catch (err) {
      console.error('[Parenting] Growth load error:', err);
    } finally {
      setGrowthLoading(false);
    }
  }, [selectedBabyId]);

  // Load observations/chat/vaccination/growth when tab switches
  useEffect(() => {
    if (activeTab === 'observations') loadObservations();
    if (activeTab === 'chat') loadChat();
    if (activeTab === 'vaccination') loadVaccinations();
    if (activeTab === 'growth') loadGrowth();
  }, [activeTab, loadObservations, loadChat, loadVaccinations, loadGrowth]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ============================================================
  // Timer restoration from localStorage
  // ============================================================

  useEffect(() => {
    const savedBreast = localStorage.getItem(LS_BREAST_TIMER);
    if (savedBreast) {
      try {
        const parsed = JSON.parse(savedBreast) as TimerState;
        setBreastTimer(parsed);
        setBreastSide(parsed.side || 'left');
      } catch {}
    }

  }, []);

  // Timer tick (breast only)
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (breastTimer) {
      if (breastTimer.isPaused) {
        // Paused: show accumulated elapsed, no ticking
        setBreastElapsed(Math.floor((breastTimer.accumulatedMs || 0) / 1000));
      } else {
        timerRef.current = setInterval(() => {
          const acc = breastTimer.accumulatedMs || 0;
          const resumedAt = breastTimer.lastResumedAt || breastTimer.startedAt;
          setBreastElapsed(Math.floor((acc + Date.now() - resumedAt) / 1000));
        }, 1000);
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [breastTimer]);

  // ============================================================
  // Feeding - Formula
  // ============================================================

  const openFormulaModal = useCallback(() => {
    setShowFormulaModal(true);
    history.pushState({ modal: 'formula' }, '');
  }, []);

  const closeFormulaModal = useCallback(() => {
    setShowFormulaModal(false);
  }, []);

  const recordFormula = useCallback(async () => {
    closeFormulaModal();
    try {
      const created = await api.createFeeding({
        babyId: selectedBabyId,
        type: 'formula',
        amountMl: formulaAmount,
        startedAt: nowKST(),
      });
      setFeedings(prev => [created, ...prev]);
      loadData();
    } catch (err) {
      console.error('[Parenting] Formula record error:', err);
    }
  }, [selectedBabyId, formulaAmount, closeFormulaModal, loadData]);

  // ============================================================
  // Feeding - Breast
  // ============================================================

  const openBreastModal = useCallback(() => {
    if (breastTimer) return;
    setBreastMode('choose');
    setShowBreastModal(true);
    history.pushState({ modal: 'breast' }, '');
  }, [breastTimer]);

  const closeBreastModal = useCallback(() => {
    setShowBreastModal(false);
  }, []);

  const startBreastTimer = useCallback(() => {
    closeBreastModal();
    const now = Date.now();
    const timer: TimerState = { startedAt: now, side: breastSide, isPaused: false, accumulatedMs: 0, lastResumedAt: now };
    setBreastTimer(timer);
    setBreastElapsed(0);
    localStorage.setItem(LS_BREAST_TIMER, JSON.stringify(timer));
  }, [breastSide, closeBreastModal]);

  const pauseBreastTimer = useCallback(() => {
    if (!breastTimer || breastTimer.isPaused) return;
    const acc = (breastTimer.accumulatedMs || 0) + (Date.now() - (breastTimer.lastResumedAt || breastTimer.startedAt));
    const updated: TimerState = { ...breastTimer, isPaused: true, accumulatedMs: acc };
    setBreastTimer(updated);
    localStorage.setItem(LS_BREAST_TIMER, JSON.stringify(updated));
  }, [breastTimer]);

  const resumeBreastTimer = useCallback(() => {
    if (!breastTimer || !breastTimer.isPaused) return;
    const updated: TimerState = { ...breastTimer, isPaused: false, lastResumedAt: Date.now() };
    setBreastTimer(updated);
    localStorage.setItem(LS_BREAST_TIMER, JSON.stringify(updated));
  }, [breastTimer]);

  const cancelBreastTimer = useCallback(() => {
    setBreastTimer(null);
    setBreastElapsed(0);
    localStorage.removeItem(LS_BREAST_TIMER);
  }, []);

  const stopBreastTimer = useCallback(async () => {
    if (!breastTimer) return;
    const acc = breastTimer.accumulatedMs || 0;
    const durationSec = breastTimer.isPaused
      ? Math.floor(acc / 1000)
      : Math.floor((acc + Date.now() - (breastTimer.lastResumedAt || breastTimer.startedAt)) / 1000);
    const startDate = new Date(breastTimer.startedAt);
    const startedAt = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())} ${pad(startDate.getHours())}:${pad(startDate.getMinutes())}:${pad(startDate.getSeconds())}`;

    setBreastTimer(null);
    setBreastElapsed(0);
    localStorage.removeItem(LS_BREAST_TIMER);

    try {
      const created = await api.createFeeding({
        babyId: selectedBabyId,
        type: 'breast',
        side: breastTimer.side || 'left',
        durationSec,
        startedAt,
        endedAt: nowKST(),
      });
      setFeedings(prev => [created, ...prev]);
      loadData();
    } catch (err) {
      console.error('[Parenting] Breast record error:', err);
    }
  }, [breastTimer, selectedBabyId, loadData]);

  // ============================================================
  // Feeding - 지난 수유 기록
  // ============================================================

  const openPastFeedingModal = useCallback(() => {
    const lastFormula = feedings.find(f => f.type === 'formula');
    setPastFeeding({
      type: 'formula',
      dateTime: toDatetimeLocal(),
      amountMl: lastFormula?.amountMl || 120,
      side: 'left',
      durationMin: 10,
    });
    setShowPastFeedingModal(true);
    history.pushState({ modal: 'pastFeeding' }, '');
  }, [feedings]);

  const recordPastFeeding = useCallback(async () => {
    setShowPastFeedingModal(false);
    const kst = datetimeLocalToKST(pastFeeding.dateTime);
    try {
      const data: any = {
        babyId: selectedBabyId,
        type: pastFeeding.type,
        startedAt: kst,
      };
      if (pastFeeding.type === 'formula') {
        data.amountMl = pastFeeding.amountMl;
      } else {
        data.side = pastFeeding.side;
        data.durationSec = pastFeeding.durationMin * 60;
        // endedAt 계산
        const start = new Date(pastFeeding.dateTime);
        start.setMinutes(start.getMinutes() + pastFeeding.durationMin);
        data.endedAt = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}:00`;
      }
      const created = await api.createFeeding(data);
      setFeedings(prev => [created, ...prev].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
      loadData();
    } catch (err) {
      console.error('[Parenting] Past feeding record error:', err);
    }
  }, [selectedBabyId, pastFeeding, loadData]);

  // ============================================================
  // Sleep — 잠든 시간 / 깬 시간 기록
  // ============================================================

  const toggleAutoSleep = useCallback(async () => {
    const newVal = !autoSleepEnabled;
    setAutoSleepEnabled(newVal);
    try {
      await api.updateBabySetting('auto_sleep_enabled', String(newVal));
    } catch {
      setAutoSleepEnabled(!newVal);
    }
  }, [autoSleepEnabled]);

  const openSleepModal = useCallback((type: 'sleep' | 'wake') => {
    setSleepDateTime(toDatetimeLocal());
    setShowSleepModal(type);
    history.pushState({ modal: 'sleep' }, '');
  }, []);

  const closeSleepModal = useCallback(() => {
    setShowSleepModal(null);
  }, []);

  const recordSleep = useCallback(async () => {
    const kst = datetimeLocalToKST(sleepDateTime);
    closeSleepModal();
    try {
      const created = await api.createSleep({ babyId: selectedBabyId, startedAt: kst });
      setSleeps(prev => [created, ...prev]);
      loadData();
    } catch (err) {
      console.error('[Parenting] Sleep record error:', err);
    }
  }, [selectedBabyId, sleepDateTime, closeSleepModal, loadData]);

  const recordWake = useCallback(async () => {
    const kst = datetimeLocalToKST(sleepDateTime);
    closeSleepModal();
    try {
      const updated = await api.wakeSleep({ babyId: selectedBabyId, endedAt: kst });
      setSleeps(prev => prev.map(s => s.id === updated.id ? updated : s));
      loadData();
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('404') || msg.includes('연결할 수면')) {
        alert('24시간 내 연결할 잠든 기록이 없습니다.');
      } else {
        console.error('[Parenting] Wake record error:', err);
      }
    }
  }, [selectedBabyId, sleepDateTime, closeSleepModal, loadData]);

  // ============================================================
  // Edit / Delete
  // ============================================================

  const handleDelete = useCallback(async (type: 'feeding' | 'sleep' | 'diaper', id: number) => {
    const key = `${type}-${id}`;
    setRemovingIds(prev => new Set(prev).add(key));
    setConfirmDelete(null);
    setEditItem(null);

    // 즉시 로컬 상태에서 제거 (애니메이션 후)
    setTimeout(async () => {
      if (type === 'feeding') {
        setFeedings(prev => prev.filter(f => f.id !== id));
      } else if (type === 'sleep') {
        setSleeps(prev => prev.filter(s => s.id !== id));
      } else {
        setDiapers(prev => prev.filter(d => d.id !== id));
      }
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });

      try {
        if (type === 'feeding') {
          await api.deleteFeeding(id);
        } else if (type === 'sleep') {
          await api.deleteSleep(id);
        } else {
          await api.deleteDiaper(id);
        }
        loadData();
      } catch (err) {
        console.error('[Parenting] Delete error:', err);
        loadData();
      }
    }, 300);
  }, [loadData]);

  const handleEditSave = useCallback(async () => {
    if (!editItem) return;
    const savedItem = editItem;
    setEditItem(null);

    // 즉시 로컬 반영
    if (savedItem.type === 'feeding') {
      setFeedings(prev => prev.map(f => f.id === savedItem.item.id ? { ...f, ...savedItem.item } : f));
    } else if (savedItem.type === 'sleep') {
      setSleeps(prev => prev.map(s => s.id === savedItem.item.id ? { ...s, ...savedItem.item } : s));
    } else {
      setDiapers(prev => prev.map(d => d.id === savedItem.item.id ? { ...d, ...savedItem.item } : d));
    }

    try {
      if (savedItem.type === 'feeding') {
        await api.updateFeeding(savedItem.item.id, savedItem.item);
      } else if (savedItem.type === 'sleep') {
        await api.updateSleep(savedItem.item.id, savedItem.item);
      } else {
        await api.updateDiaper(savedItem.item.id, savedItem.item);
      }
      loadData();
    } catch (err) {
      console.error('[Parenting] Edit error:', err);
      loadData();
    }
  }, [editItem, loadData]);

  // ============================================================
  // Popstate (modal back button)
  // ============================================================

  useEffect(() => {
    const onPop = () => {
      setShowFormulaModal(false);
      setShowBreastModal(false);
      setShowPastFeedingModal(false);
      setShowSleepModal(null);
      setShowDiaperConditionModal(false);
      setEditItem(null);
      setConfirmDelete(null);
      setShowBabyModal(false);
      setShowBabyMenu(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ============================================================
  // Render: Summary Card
  // ============================================================

  const handleRefreshPrediction = useCallback(async () => {
    if (predicting) return;
    setPredicting(true);
    try {
      const type = activeTab === 'feeding' ? 'feeding' : activeTab === 'diaper' ? 'diaper' : 'sleep';
      await api.triggerPrediction(selectedBabyId, type as 'feeding' | 'sleep' | 'diaper');
      // 예측은 비동기라 잠시 후 summary 다시 로드
      setTimeout(() => loadData(), 10000);
    } catch (err) {
      console.error('[Parenting] Prediction trigger error:', err);
    } finally {
      setTimeout(() => setPredicting(false), 10000);
    }
  }, [predicting, activeTab, selectedBabyId, loadData]);

  const renderSummary = () => {
    if (!summary) return null;
    const { today, prediction } = summary;
    const activePrediction = activeTab === 'feeding' ? prediction.feeding : activeTab === 'diaper' ? prediction.diaper : prediction.sleep;
    const predIcon = activeTab === 'feeding' ? '🍼' : activeTab === 'diaper' ? '🧷' : '💤';
    const predLabel = activeTab === 'feeding' ? '수유' : activeTab === 'diaper' ? '기저귀' : '수면';

    const summaryItems = activeTab === 'diaper' ? (
      <>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{today.diaperCount}</div>
          <div className={styles.summaryLabel}>기저귀 총</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{today.peeCount}</div>
          <div className={styles.summaryLabel}>소변</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{today.poopCount}</div>
          <div className={styles.summaryLabel}>대변</div>
        </div>
      </>
    ) : (
      <>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{today.feedingCount}</div>
          <div className={styles.summaryLabel}>수유 횟수</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{today.totalFormulaMl}<span style={{ fontSize: 13, fontWeight: 500 }}>ml</span></div>
          <div className={styles.summaryLabel}>분유 총량</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{today.totalSleepMin}<span style={{ fontSize: 13, fontWeight: 500 }}>분</span></div>
          <div className={styles.summaryLabel}>수면 시간</div>
        </div>
      </>
    );

    return (
      <div className={styles.summaryCard}>
        <div className={styles.summaryGrid}>
          {summaryItems}
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.predictionRow}>
          <span className={styles.predictionIcon}>{predIcon}</span>
          {activePrediction ? (
            <span className={styles.predictionText}>
              다음 {predLabel} 예상:{' '}
              <span className={styles.predictionTime}>{activePrediction.predictedAt.split(' ')[1] || activePrediction.predictedAt}</span>
              {' '}{activePrediction.reasoning}
            </span>
          ) : (
            <span className={styles.predictionText}>예측 데이터 없음</span>
          )}
          <button
            className={`${styles.predictionRefresh} ${predicting ? styles.predictionRefreshSpin : ''}`}
            onClick={handleRefreshPrediction}
            disabled={predicting}
            title="예측 새로고침"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // ============================================================
  // Render: Feeding Tab
  // ============================================================

  const renderFeedingTab = () => {
    // 모유 타이머 실행 중이면 타이머 표시
    if (breastTimer) {
      return (
        <>
          <div className={styles.timerDisplay}>
            <div className={styles.timerLabel}>
              {breastTimer.side === 'left' ? '왼쪽' : '오른쪽'} 모유 수유 {breastTimer.isPaused ? '일시정지' : '중'}
            </div>
            <div className={`${styles.timerCircle} ${styles.timerCircleFeeding} ${breastTimer.isPaused ? styles.timerCirclePaused : ''}`}>
              <span className={styles.timerTime}>{formatTimerDisplay(breastElapsed)}</span>
            </div>
            <div className={styles.timerSide}>🤱 {breastTimer.side === 'left' ? '왼쪽' : '오른쪽'}</div>
            <div className={styles.timerBtnGroup}>
              {breastTimer.isPaused ? (
                <button className={styles.timerResumeBtn} onClick={resumeBreastTimer}>재개</button>
              ) : (
                <button className={styles.timerPauseBtn} onClick={pauseBreastTimer}>일시정지</button>
              )}
              <button className={styles.timerStopBtn} onClick={stopBreastTimer}>완료</button>
            </div>
            <button className={styles.timerCancelBtn} onClick={cancelBreastTimer}>취소</button>
          </div>
          {renderFeedingList()}
        </>
      );
    }

    return (
      <>
        <div className={styles.quickActions}>
          <button className={styles.actionBtn} onClick={openFormulaModal}>
            <span className={styles.actionBtnIcon}>🍼</span>
            <span className={styles.actionBtnLabel}>분유</span>
            <span className={styles.actionBtnSub}>{formulaAmount}ml</span>
          </button>
          <button className={styles.actionBtn} onClick={openBreastModal}>
            <span className={styles.actionBtnIcon}>🤱</span>
            <span className={styles.actionBtnLabel}>모유</span>
            <span className={styles.actionBtnSub}>수유 기록</span>
          </button>
        </div>
        {renderFeedingList()}
      </>
    );
  };

  const renderFeedingList = () => {
    if (feedings.length === 0) {
      return (
        <>
          <div className={styles.sectionTitle}>수유 기록</div>
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>🍼</div>
            <div className={styles.emptyStateText}>아직 수유 기록이 없어요</div>
          </div>
        </>
      );
    }

    // Group feedings by date (newest first)
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const groups: { date: string; label: string; items: typeof feedings }[] = [];
    for (const f of feedings) {
      const dateStr = f.startedAt.split(' ')[0];
      const existing = groups.find(g => g.date === dateStr);
      if (existing) {
        existing.items.push(f);
      } else {
        const d = new Date(dateStr);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        let label: string;
        if (d.getTime() >= today.getTime()) label = '오늘';
        else if (d.getTime() >= yesterday.getTime()) label = '어제';
        else label = `${d.getMonth() + 1}/${d.getDate()} (${dayNames[d.getDay()]})`;
        groups.push({ date: dateStr, label, items: [f] });
      }
    }

    // Calculate gap between consecutive feedings in same group
    function getGapPx(prevTime: string, curTime: string): number {
      const prev = new Date(prevTime.replace(' ', 'T'));
      const cur = new Date(curTime.replace(' ', 'T'));
      const gapMin = Math.abs(prev.getTime() - cur.getTime()) / 60000;
      // 1 hour = 28px, min 6px, max 64px
      return Math.min(Math.max(Math.round(gapMin * 0.47), 6), 64);
    }

    function formatGap(prevTime: string, curTime: string): string {
      const prev = new Date(prevTime.replace(' ', 'T'));
      const cur = new Date(curTime.replace(' ', 'T'));
      const gapMin = Math.round(Math.abs(prev.getTime() - cur.getTime()) / 60000);
      if (gapMin < 60) return `${gapMin}분`;
      const h = Math.floor(gapMin / 60);
      const m = gapMin % 60;
      return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
    }

    return (
      <>
        <div className={styles.sectionTitle}>최근 5일 수유 기록</div>
        <div className={styles.timeline}>
          {groups.map((group) => (
            <div key={group.date} className={styles.timelineGroup}>
              <div className={styles.timelineDateLabel}>{group.label}</div>
              <div className={styles.timelineItems}>
                {group.items.map((f, i) => {
                  const key = `feeding-${f.id}`;
                  const isRemoving = removingIds.has(key);
                  const gapPx = i > 0 ? getGapPx(group.items[i - 1].startedAt, f.startedAt) : 0;
                  const gapLabel = i > 0 ? formatGap(group.items[i - 1].startedAt, f.startedAt) : '';
                  return (
                    <div key={key}>
                      {i > 0 && (
                        <div className={styles.timelineGap} style={{ '--gap': `${gapPx}px` } as React.CSSProperties}>
                          <div className={styles.timelineGapLine} />
                          {gapPx >= 20 && <span className={styles.timelineGapLabel}>{gapLabel}</span>}
                        </div>
                      )}
                      <div
                        className={`${styles.timelineNode} ${isRemoving ? styles.recordRemoving : ''}`}
                        onClick={() => {
                          setEditItem({ type: 'feeding', item: { ...f } });
                          history.pushState({ modal: 'edit' }, '');
                        }}
                      >
                        <div className={styles.timelineTime}>{formatTime(f.startedAt)}</div>
                        <div className={styles.timelineDot}>
                          <div className={`${styles.timelineDotInner} ${f.type === 'formula' ? styles.timelineDotFormula : styles.timelineDotBreast}`} />
                        </div>
                        <div className={styles.timelineContent}>
                          <div className={styles.timelineTitle}>
                            {f.type === 'formula' ? `🍼 분유 ${f.amountMl}ml` : `🤱 모유 (${f.side === 'left' ? '왼쪽' : '오른쪽'})`}
                          </div>
                          <div className={styles.timelineDetail}>
                            {f.type === 'breast' && f.durationSec ? formatDuration(f.durationSec) + ' · ' : ''}
                            {f.recorderName}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

  // ============================================================
  // Diaper handlers
  // ============================================================

  const recordQuickDiaper = useCallback(async (type: DiaperType) => {
    try {
      const created = await api.createDiaper({
        babyId: selectedBabyId,
        type,
        changedAt: nowKST(),
      });
      setDiapers(prev => [created, ...prev]);
      loadData();
    } catch (err) {
      console.error('[Parenting] Diaper record error:', err);
    }
  }, [selectedBabyId, loadData]);

  const openDiaperConditionModal = useCallback((type: DiaperType) => {
    setPendingDiaperType(type);
    setDiaperColor('yellow');
    setDiaperConsistency('soft');
    setShowDiaperConditionModal(true);
    history.pushState({ modal: 'diaper' }, '');
  }, []);

  const recordDiaperWithCondition = useCallback(async () => {
    setShowDiaperConditionModal(false);
    try {
      const created = await api.createDiaper({
        babyId: selectedBabyId,
        type: pendingDiaperType,
        changedAt: nowKST(),
        color: diaperColor,
        consistency: diaperConsistency,
      });
      setDiapers(prev => [created, ...prev]);
      loadData();
    } catch (err) {
      console.error('[Parenting] Diaper record error:', err);
    }
  }, [selectedBabyId, pendingDiaperType, diaperColor, diaperConsistency, loadData]);

  // ============================================================
  // Render: Diaper Tab
  // ============================================================

  const DIAPER_COLORS = [
    { value: 'yellow', label: '노란색', emoji: '🟡' },
    { value: 'green', label: '녹색', emoji: '🟢' },
    { value: 'brown', label: '갈색', emoji: '🟤' },
    { value: 'black', label: '검정', emoji: '⚫' },
    { value: 'red', label: '빨강', emoji: '🔴' },
    { value: 'white', label: '흰색', emoji: '⚪' },
  ];
  const DIAPER_CONSISTENCIES = [
    { value: 'watery', label: '묽음' },
    { value: 'soft', label: '보통' },
    { value: 'hard', label: '딱딱함' },
  ];

  const renderDiaperTab = () => (
    <>
      <div className={styles.quickActions} style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <button className={styles.actionBtn} onClick={() => recordQuickDiaper('pee')}>
          <span className={styles.actionBtnIcon}>💧</span>
          <span className={styles.actionBtnLabel}>소변</span>
          <span className={styles.actionBtnSub}>쉬했어요</span>
        </button>
        <button className={styles.actionBtn} onClick={() => openDiaperConditionModal('poop')}>
          <span className={styles.actionBtnIcon}>💩</span>
          <span className={styles.actionBtnLabel}>대변</span>
          <span className={styles.actionBtnSub}>응가했어요</span>
        </button>
        <button className={styles.actionBtn} onClick={() => openDiaperConditionModal('both')}>
          <span className={styles.actionBtnIcon}>🧷</span>
          <span className={styles.actionBtnLabel}>둘 다</span>
          <span className={styles.actionBtnSub}>쉬+응가</span>
        </button>
      </div>
      {renderDiaperList()}
    </>
  );

  const renderDiaperConditionModal = () => {
    if (!showDiaperConditionModal) return null;
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={() => setShowDiaperConditionModal(false)} />
        <div className={styles.modal}>
          <div className={styles.modalTitle}>
            {pendingDiaperType === 'both' ? '기저귀 (소변+대변)' : '대변 상태'}
          </div>
          <div className={styles.editField}>
            <div className={styles.editLabel}>색상</div>
            <div className={styles.diaperColorGrid}>
              {DIAPER_COLORS.map(c => (
                <button
                  key={c.value}
                  className={`${styles.diaperColorBtn} ${diaperColor === c.value ? styles.diaperColorBtnActive : ''}`}
                  onClick={() => setDiaperColor(c.value)}
                >
                  <span>{c.emoji}</span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.editField}>
            <div className={styles.editLabel}>상태</div>
            <div className={styles.editToggleRow}>
              {DIAPER_CONSISTENCIES.map(c => (
                <button
                  key={c.value}
                  className={`${styles.editToggle} ${diaperConsistency === c.value ? styles.editToggleActive : ''}`}
                  onClick={() => setDiaperConsistency(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} onClick={() => setShowDiaperConditionModal(false)}>취소</button>
            <button className={styles.modalConfirmBtn} onClick={recordDiaperWithCondition}>기록</button>
          </div>
        </div>
      </div>
    );
  };

  const renderDiaperList = () => {
    if (diapers.length === 0) {
      return (
        <>
          <div className={styles.sectionTitle}>기저귀 기록</div>
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>🧷</div>
            <div className={styles.emptyStateText}>아직 기저귀 기록이 없어요</div>
          </div>
        </>
      );
    }

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const groups: { date: string; label: string; items: typeof diapers }[] = [];
    for (const d of diapers) {
      const dateStr = d.changedAt.split(' ')[0];
      const existing = groups.find(g => g.date === dateStr);
      if (existing) {
        existing.items.push(d);
      } else {
        const dt = new Date(dateStr);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        let label: string;
        if (dt.getTime() >= today.getTime()) label = '오늘';
        else if (dt.getTime() >= yesterday.getTime()) label = '어제';
        else label = `${dt.getMonth() + 1}/${dt.getDate()} (${dayNames[dt.getDay()]})`;
        groups.push({ date: dateStr, label, items: [d] });
      }
    }

    function getGapPx(prevTime: string, curTime: string): number {
      const prev = new Date(prevTime.replace(' ', 'T'));
      const cur = new Date(curTime.replace(' ', 'T'));
      const gapMin = Math.abs(prev.getTime() - cur.getTime()) / 60000;
      return Math.min(Math.max(Math.round(gapMin * 0.47), 6), 64);
    }

    function formatGap(prevTime: string, curTime: string): string {
      const prev = new Date(prevTime.replace(' ', 'T'));
      const cur = new Date(curTime.replace(' ', 'T'));
      const gapMin = Math.round(Math.abs(prev.getTime() - cur.getTime()) / 60000);
      if (gapMin < 60) return `${gapMin}분`;
      const h = Math.floor(gapMin / 60);
      const m = gapMin % 60;
      return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
    }

    const colorLabel = (c: string | null) => {
      if (!c) return '';
      const found = DIAPER_COLORS.find(x => x.value === c);
      return found ? found.label : c;
    };
    const consistencyLabel = (c: string | null) => {
      if (!c) return '';
      const found = DIAPER_CONSISTENCIES.find(x => x.value === c);
      return found ? found.label : c;
    };

    return (
      <>
        <div className={styles.sectionTitle}>최근 5일 기저귀 기록</div>
        <div className={styles.timeline}>
          {groups.map((group) => (
            <div key={group.date} className={styles.timelineGroup}>
              <div className={styles.timelineDateLabel}>{group.label}</div>
              <div className={styles.timelineItems}>
                {group.items.map((d, i) => {
                  const key = `diaper-${d.id}`;
                  const isRemoving = removingIds.has(key);
                  const gapPx = i > 0 ? getGapPx(group.items[i - 1].changedAt, d.changedAt) : 0;
                  const gapLbl = i > 0 ? formatGap(group.items[i - 1].changedAt, d.changedAt) : '';
                  const typeIcon = d.type === 'pee' ? '💧' : d.type === 'poop' ? '💩' : '🧷';
                  const typeText = d.type === 'pee' ? '소변' : d.type === 'poop' ? '대변' : '소변+대변';
                  const conditionParts: string[] = [];
                  if (d.color) conditionParts.push(colorLabel(d.color));
                  if (d.consistency) conditionParts.push(consistencyLabel(d.consistency));
                  const conditionText = conditionParts.length > 0 ? ` (${conditionParts.join(', ')})` : '';

                  return (
                    <div key={key}>
                      {i > 0 && (
                        <div className={styles.timelineGap} style={{ '--gap': `${gapPx}px` } as React.CSSProperties}>
                          <div className={styles.timelineGapLine} />
                          {gapPx >= 20 && <span className={styles.timelineGapLabel}>{gapLbl}</span>}
                        </div>
                      )}
                      <div
                        className={`${styles.timelineNode} ${isRemoving ? styles.recordRemoving : ''}`}
                        onClick={() => {
                          setEditItem({ type: 'diaper', item: { ...d } });
                          history.pushState({ modal: 'edit' }, '');
                        }}
                      >
                        <div className={styles.timelineTime}>{formatTime(d.changedAt)}</div>
                        <div className={styles.timelineDot}>
                          <div className={`${styles.timelineDotInner} ${styles.timelineDotDiaper}`} />
                        </div>
                        <div className={styles.timelineContent}>
                          <div className={styles.timelineTitle}>
                            {typeIcon} {typeText}{conditionText}
                          </div>
                          <div className={styles.timelineDetail}>
                            {d.recorderName}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

  // ============================================================
  // Render: Sleep Tab
  // ============================================================

  const unmatchedSleep = sleeps.find(s => !s.endedAt);

  const renderSleepTab = () => {
    return (
      <>
        <div className={styles.quickActions}>
          <button className={styles.actionBtn} onClick={() => openSleepModal('sleep')}>
            <span className={styles.actionBtnIcon}>😴</span>
            <span className={styles.actionBtnLabel}>잠들었어요</span>
            <span className={styles.actionBtnSub}>잠든 시간 기록</span>
          </button>
          <button
            className={`${styles.actionBtn} ${!unmatchedSleep ? styles.actionBtnDisabled : ''}`}
            onClick={() => unmatchedSleep ? openSleepModal('wake') : alert('먼저 잠든 시간을 기록해주세요.')}
          >
            <span className={styles.actionBtnIcon}>☀️</span>
            <span className={styles.actionBtnLabel}>깨어났어요</span>
            <span className={styles.actionBtnSub}>{unmatchedSleep ? `${formatTime(unmatchedSleep.startedAt)}부터 수면 중` : '연결할 기록 없음'}</span>
          </button>
        </div>
        <div className={styles.autoSleepToggle}>
          <div className={styles.autoSleepInfo}>
            <span className={styles.autoSleepLabel}>자동 수면 기록</span>
            <span className={styles.autoSleepDesc}>부모 모두 30분 미접속 시 자동 기록</span>
          </div>
          <button
            className={`${styles.toggleSwitch} ${autoSleepEnabled ? styles.toggleOn : ''}`}
            onClick={toggleAutoSleep}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
        {renderSleepList()}
      </>
    );
  };

  const renderSleepList = () => (
    <>
      <div className={styles.sectionTitle}>오늘 수면 기록</div>
      {sleeps.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>💤</div>
          <div className={styles.emptyStateText}>아직 수면 기록이 없어요</div>
        </div>
      ) : (
        <div className={styles.recordList}>
          {sleeps.map((s, i) => {
            const key = `sleep-${s.id}`;
            const isRemoving = removingIds.has(key);
            const staggerClass = (styles as any)[`recordCardStagger${Math.min(i + 1, 8)}`] || '';
            return (
              <div
                key={key}
                className={`${styles.recordCard} ${staggerClass} ${isRemoving ? styles.recordRemoving : ''}`}
                onClick={() => {
                  setEditItem({ type: 'sleep', item: { ...s } });
                  history.pushState({ modal: 'edit' }, '');
                }}
              >
                <div className={`${styles.recordIcon} ${styles.recordIconSleep}`}>😴</div>
                <div className={styles.recordInfo}>
                  <div className={styles.recordTitle}>
                    {s.endedAt ? formatDuration(s.durationSec || 0) : '수면 중...'}
                    {s.isAutoSleep ? <span className={styles.autoSleepBadge}>자동</span> : null}
                  </div>
                  <div className={styles.recordDetail}>
                    {s.endedAt ? `${formatTime(s.startedAt)} ~ ${formatTime(s.endedAt)}` : formatTime(s.startedAt)}
                    {s.recorderName && ` · ${s.recorderName}`}
                  </div>
                </div>
                <div className={styles.recordTime}>{formatTime(s.startedAt)}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // ============================================================
  // Observations handlers
  // ============================================================

  const handleAddObservation = useCallback(async () => {
    if (!obsInput.trim()) return;
    setObsLoading(true);
    const babyIdAtCall = selectedBabyId;
    try {
      const obs = await api.createObservation(selectedBabyId, obsInput.trim());
      setObservations(prev => [obs, ...prev]);
      setObsInput('');
      // Reload after a delay to get LLM evaluation (guard against baby switch)
      setTimeout(async () => {
        try {
          const data = await api.getObservations(babyIdAtCall);
          setObservations(prev => {
            // Only update if still viewing the same baby
            if (prev.some(o => o.babyId === babyIdAtCall) || prev.length === 0) return data;
            return prev;
          });
        } catch {}
      }, 8000);
    } catch (err) {
      console.error('[Parenting] Observation create error:', err);
    } finally {
      setObsLoading(false);
    }
  }, [obsInput, selectedBabyId]);

  const handleToggleObservation = useCallback(async (id: number) => {
    try {
      const updated = await api.toggleObservation(id);
      setObservations(prev => prev.map(o => o.id === id ? updated : o));
    } catch (err) {
      console.error('[Parenting] Observation toggle error:', err);
    }
  }, []);

  const handleDeleteObservation = useCallback(async (id: number) => {
    try {
      await api.deleteObservation(id);
      setObservations(prev => prev.filter(o => o.id !== id));
    } catch (err) {
      console.error('[Parenting] Observation delete error:', err);
    }
  }, []);

  // ============================================================
  // Chat handlers
  // ============================================================

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const text = chatInput.trim();
    setChatInput('');
    setChatLoading(true);

    // Optimistic: add user message
    const tempUserMsg: BabyChatMessage = {
      id: -Date.now(),
      babyId: selectedBabyId,
      role: 'user',
      content: text,
      userId: null,
      userName: '나',
      userImage: null,
      createdAt: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, tempUserMsg]);

    try {
      const { userMessage, assistantMessage } = await api.sendChatMessage(selectedBabyId, text);
      setChatMessages(prev => [...prev.filter(m => m.id !== tempUserMsg.id), userMessage, assistantMessage]);
    } catch (err) {
      console.error('[Parenting] Chat send error:', err);
      setChatMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
      setChatInput(text); // Restore input
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, selectedBabyId]);

  // ============================================================
  // Render: Observations Tab
  // ============================================================

  const severityConfig = {
    pending: { label: '평가 중', color: '#8E8E93', bg: '#8E8E9315' },
    common: { label: '흔한 현상', color: '#34C759', bg: '#34C75915' },
    watch: { label: '관찰 필요', color: '#FF9500', bg: '#FF950015' },
    danger: { label: '주의 필요', color: '#FF3B30', bg: '#FF3B3015' },
  };

  // ============================================================
  // Vaccination handlers & render
  // ============================================================

  const selectedBaby = babies.find(b => b.id === selectedBabyId);
  const vaccCompletedSet = new Set(vaccCompletions.map(c => c.vaccineCode));
  const vaccCompletedCount = vaccSchedule.filter(v => vaccCompletedSet.has(v.code)).length;

  const handleVaccToggle = async (vacc: VaccineItem) => {
    if (vaccCompletedSet.has(vacc.code)) {
      // Uncomplete
      try {
        await api.uncompleteVaccination(selectedBabyId, vacc.code);
        setVaccCompletions(prev => prev.filter(c => c.vaccineCode !== vacc.code));
      } catch (err) {
        console.error('[Parenting] Vaccination uncomplete error:', err);
      }
    } else {
      // Open modal to set completion date
      setVaccCompleteModal(vacc);
      setVaccCompleteDate(new Date().toISOString().split('T')[0]);
      setVaccHospital('');
    }
  };

  const handleVaccComplete = async () => {
    if (!vaccCompleteModal) return;
    try {
      await api.completeVaccination(selectedBabyId, {
        vaccineCode: vaccCompleteModal.code,
        completedDate: vaccCompleteDate,
        hospital: vaccHospital,
      });
      setVaccCompletions(prev => [...prev, { vaccineCode: vaccCompleteModal.code, completedDate: vaccCompleteDate, hospital: vaccHospital, memo: '' }]);
      setVaccCompleteModal(null);
    } catch (err) {
      console.error('[Parenting] Vaccination complete error:', err);
    }
  };

  const handleVaccChoiceChange = async (key: 'combo' | 'rota' | 'je', value: string) => {
    const newChoices = { ...vaccChoices, [key]: value };
    setVaccChoices(newChoices);
    try {
      await api.updateVaccinationChoices(selectedBabyId, { [key]: value });
      // Reload schedule with new choices
      const data = await api.getVaccinations(selectedBabyId);
      setVaccSchedule(data.schedule);
      setVaccCompletions(data.completions);
    } catch (err) {
      console.error('[Parenting] Vaccination choice error:', err);
    }
  };

  const getVaccStatus = (vacc: VaccineItem): 'done' | 'overdue' | 'upcoming' | 'future' => {
    if (vaccCompletedSet.has(vacc.code)) return 'done';
    if (!selectedBaby?.birthDate) return 'future';
    const bd = new Date(selectedBaby.birthDate);
    const scheduled = new Date(bd);
    scheduled.setMonth(scheduled.getMonth() + vacc.ageMonths);
    const now = new Date();
    const daysUntil = Math.floor((scheduled.getTime() - now.getTime()) / 86400000);
    if (daysUntil < 0) return 'overdue';
    if (daysUntil <= 14) return 'upcoming';
    return 'future';
  };

  const getVaccDaysLabel = (vacc: VaccineItem): string => {
    if (!selectedBaby?.birthDate) return '';
    const bd = new Date(selectedBaby.birthDate);
    const scheduled = new Date(bd);
    scheduled.setMonth(scheduled.getMonth() + vacc.ageMonths);
    const now = new Date();
    const daysUntil = Math.floor((scheduled.getTime() - now.getTime()) / 86400000);
    if (daysUntil === 0) return '오늘';
    if (daysUntil > 0) return `D-${daysUntil}`;
    return `D+${Math.abs(daysUntil)}`;
  };

  // ============================================================
  // Growth Handlers
  // ============================================================

  const handleAddGrowth = async () => {
    const wt = growthForm.weightKg ? parseFloat(growthForm.weightKg) : undefined;
    const ht = growthForm.heightCm ? parseFloat(growthForm.heightCm) : undefined;
    const hc = growthForm.headCm ? parseFloat(growthForm.headCm) : undefined;
    if (wt == null && ht == null && hc == null) return;
    try {
      await api.createGrowthRecord(selectedBabyId, {
        measuredDate: growthForm.date,
        weightKg: wt, heightCm: ht, headCm: hc,
        memo: growthForm.memo || undefined,
      });
      setShowGrowthModal(false);
      setGrowthForm({ date: '', weightKg: '', heightCm: '', headCm: '', memo: '' });
      loadGrowth();
    } catch (err) {
      console.error('[Parenting] Growth create error:', err);
    }
  };

  const handleDeleteGrowth = async (id: number) => {
    try {
      await api.deleteGrowthRecord(selectedBabyId, id);
      setGrowthRecords(prev => prev.filter(r => r.id !== id));
      setGrowthDetailRecord(null);
    } catch (err) {
      console.error('[Parenting] Growth delete error:', err);
    }
  };

  function getAgeMonths(birthDate: string, measuredDate: string): number {
    const birth = new Date(birthDate);
    const measured = new Date(measuredDate);
    return (measured.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
  }

  // Group schedule by ageLabel
  const vaccGroups: { label: string; items: VaccineItem[] }[] = [];
  for (const v of vaccSchedule) {
    const existing = vaccGroups.find(g => g.label === v.ageLabel);
    if (existing) existing.items.push(v);
    else vaccGroups.push({ label: v.ageLabel, items: [v] });
  }

  const renderVaccinationTab = () => (
    <div className={styles.vaccSection}>
      {/* Progress */}
      <div className={styles.vaccProgress}>
        <div className={styles.vaccProgressHeader}>
          <span className={styles.vaccProgressTitle}>💉 접종 현황</span>
          <span className={styles.vaccProgressCount}>{vaccCompletedCount}/{vaccSchedule.length} 완료</span>
        </div>
        <div className={styles.vaccProgressBar}>
          <div
            className={styles.vaccProgressFill}
            style={{ width: vaccSchedule.length ? `${(vaccCompletedCount / vaccSchedule.length) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Choices */}
      <div className={styles.vaccChoices}>
        <div className={styles.vaccChoicesTitle}>접종 유형 선택</div>
        <div className={styles.vaccChoiceRow}>
          <span className={styles.vaccChoiceLabel}>혼합주사</span>
          <div className={styles.vaccChoiceBtns}>
            <button
              className={`${styles.vaccChoiceBtn} ${vaccChoices.combo === 'hexa' ? styles.vaccChoiceBtnActive : ''}`}
              onClick={() => handleVaccChoiceChange('combo', 'hexa')}
            >헥사심(6가)</button>
            <button
              className={`${styles.vaccChoiceBtn} ${vaccChoices.combo === 'penta' ? styles.vaccChoiceBtnActive : ''}`}
              onClick={() => handleVaccChoiceChange('combo', 'penta')}
            >5가 혼합</button>
          </div>
        </div>
        <div className={styles.vaccChoiceRow}>
          <span className={styles.vaccChoiceLabel}>로타</span>
          <div className={styles.vaccChoiceBtns}>
            <button
              className={`${styles.vaccChoiceBtn} ${vaccChoices.rota === 'rv1' ? styles.vaccChoiceBtnActive : ''}`}
              onClick={() => handleVaccChoiceChange('rota', 'rv1')}
            >RV1 (2회)</button>
            <button
              className={`${styles.vaccChoiceBtn} ${vaccChoices.rota === 'rv5' ? styles.vaccChoiceBtnActive : ''}`}
              onClick={() => handleVaccChoiceChange('rota', 'rv5')}
            >RV5 (3회)</button>
          </div>
        </div>
        <div className={styles.vaccChoiceRow}>
          <span className={styles.vaccChoiceLabel}>일본뇌염</span>
          <div className={styles.vaccChoiceBtns}>
            <button
              className={`${styles.vaccChoiceBtn} ${vaccChoices.je === 'ijev' ? styles.vaccChoiceBtnActive : ''}`}
              onClick={() => handleVaccChoiceChange('je', 'ijev')}
            >사백신 (5회)</button>
            <button
              className={`${styles.vaccChoiceBtn} ${vaccChoices.je === 'ljev' ? styles.vaccChoiceBtnActive : ''}`}
              onClick={() => handleVaccChoiceChange('je', 'ljev')}
            >생백신 (2회)</button>
          </div>
        </div>
      </div>

      {/* Schedule grouped by age */}
      {vaccLoading ? (
        <div className={styles.loading}><div className={styles.loadingSpinner} /></div>
      ) : (
        vaccGroups.map(group => {
          const status = getVaccStatus(group.items[0]);
          return (
            <div key={group.label} className={styles.vaccAgeGroup}>
              <div className={styles.vaccAgeLabel}>{group.label}</div>
              {group.items.map(vacc => {
                const isDone = vaccCompletedSet.has(vacc.code);
                const vaccStatus = getVaccStatus(vacc);
                const completion = vaccCompletions.find(c => c.vaccineCode === vacc.code);
                return (
                  <div
                    key={vacc.code}
                    className={`${styles.vaccItem} ${isDone ? styles.vaccItemDone : ''}`}
                    onClick={() => handleVaccToggle(vacc)}
                  >
                    <div className={`${styles.vaccCheck} ${isDone ? styles.vaccCheckDone : ''}`}>
                      {isDone && '✓'}
                    </div>
                    <div className={styles.vaccInfo}>
                      <div className={`${styles.vaccName} ${isDone ? styles.vaccNameDone : ''}`}>
                        {vacc.name} {vacc.dose}차
                      </div>
                      <div className={styles.vaccDesc}>{vacc.description}</div>
                    </div>
                    {isDone && completion && (
                      <div className={`${styles.vaccDate} ${styles.vaccDateCompleted}`}>
                        {completion.completedDate}
                      </div>
                    )}
                    {!isDone && (
                      <span className={`${styles.vaccBadge} ${
                        vaccStatus === 'overdue' ? styles.vaccBadgeOverdue :
                        vaccStatus === 'upcoming' ? styles.vaccBadgeUpcoming :
                        styles.vaccBadgeFuture
                      }`}>
                        {getVaccDaysLabel(vacc)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {/* Complete modal */}
      {vaccCompleteModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBackdrop} onClick={() => setVaccCompleteModal(null)} />
          <div className={styles.modal}>
            <div className={styles.vaccModal}>
              <div className={styles.vaccModalTitle}>
                💉 {vaccCompleteModal.name} {vaccCompleteModal.dose}차 접종 기록
              </div>
              <div className={styles.vaccModalField}>
                <div className={styles.vaccModalLabel}>접종일</div>
                <input
                  type="date"
                  className={styles.vaccModalInput}
                  value={vaccCompleteDate}
                  onChange={e => setVaccCompleteDate(e.target.value)}
                />
              </div>
              <div className={styles.vaccModalField}>
                <div className={styles.vaccModalLabel}>병원 (선택)</div>
                <input
                  type="text"
                  className={styles.vaccModalInput}
                  placeholder="접종한 병원"
                  value={vaccHospital}
                  onChange={e => setVaccHospital(e.target.value)}
                />
              </div>
              <div className={styles.vaccModalBtns}>
                <button className={`${styles.vaccModalBtn} ${styles.vaccModalBtnCancel}`} onClick={() => setVaccCompleteModal(null)}>
                  취소
                </button>
                <button className={`${styles.vaccModalBtn} ${styles.vaccModalBtnConfirm}`} onClick={handleVaccComplete}>
                  완료
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderObservationsTab = () => (
    <>
      <div className={styles.obsInputWrap}>
        <input
          className={styles.obsInputField}
          placeholder="특이사항을 입력하세요 (예: 콘헤드 심함)"
          value={obsInput}
          onChange={e => setObsInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddObservation()}
          disabled={obsLoading}
        />
        <button
          className={styles.obsSendBtn}
          onClick={handleAddObservation}
          disabled={obsLoading || !obsInput.trim()}
        >
          {obsLoading ? '...' : '기록'}
        </button>
      </div>

      {observations.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>📋</div>
          <div className={styles.emptyStateText}>아직 기록된 특이사항이 없어요</div>
        </div>
      ) : (
        <div className={styles.obsList}>
          {observations.map(obs => {
            const sev = severityConfig[obs.severity] || severityConfig.pending;
            return (
              <div key={obs.id} className={`${styles.obsCard} ${obs.status === 'resolved' ? styles.obsResolved : ''}`}>
                <div className={styles.obsHeader}>
                  <span className={styles.obsSeverity} style={{ color: sev.color, background: sev.bg }}>
                    {sev.label}
                  </span>
                  <span
                    className={styles.obsStatus}
                    onClick={() => handleToggleObservation(obs.id)}
                  >
                    {obs.status === 'active' ? '진행중' : '해소'}
                  </span>
                </div>
                <div className={styles.obsContent}>{obs.content}</div>
                {obs.llmReasoning && (
                  <div className={styles.obsReasoning}>{obs.llmReasoning}</div>
                )}
                <div className={styles.obsFooter}>
                  <span className={styles.obsRecorder}>{obs.recorderName} · {obs.createdAt.split(' ')[0]}</span>
                  <button
                    className={styles.obsDeleteBtn}
                    onClick={() => handleDeleteObservation(obs.id)}
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // ============================================================
  // Render: Chat Tab
  // ============================================================

  const renderChatTab = () => (
    <div className={styles.chatWrap}>
      <div className={styles.chatHeader}>걱정을 들어줄게요</div>
      <div className={styles.chatMessages}>
        {chatMessages.length === 0 && !chatLoading && (
          <div className={styles.chatEmpty}>
            아기에 대한 걱정이나 궁금한 점을 물어보세요.
          </div>
        )}
        {chatMessages.map(msg => (
          <div key={msg.id} className={`${styles.chatBubbleWrap} ${msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant}`}>
            <div className={styles.chatBubble}>
              {msg.content}
            </div>
          </div>
        ))}
        {chatLoading && (
          <div className={`${styles.chatBubbleWrap} ${styles.chatBubbleAssistant}`}>
            <div className={`${styles.chatBubble} ${styles.chatTyping}`}>
              <span className={styles.typingDots}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className={styles.chatInputWrap}>
        <input
          className={styles.chatInputField}
          placeholder="걱정되는 점을 말해주세요..."
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSendChat()}
          disabled={chatLoading}
        />
        <button
          className={styles.chatSendBtn}
          onClick={handleSendChat}
          disabled={chatLoading || !chatInput.trim()}
        >
          전송
        </button>
      </div>
    </div>
  );

  // ============================================================
  // Render: Modals
  // ============================================================

  const renderFormulaModal = () => {
    if (!showFormulaModal) return null;
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={closeFormulaModal} />
        <div className={styles.modal}>
          <div className={styles.modalTitle}>분유 기록</div>
          <div className={styles.amountControl}>
            <button className={styles.amountBtn} onClick={() => setFormulaAmount(prev => Math.max(10, prev - 10))}>-</button>
            <div className={styles.amountValue}>
              <div className={styles.amountNumber}>{formulaAmount}</div>
              <div className={styles.amountUnit}>ml</div>
            </div>
            <button className={styles.amountBtn} onClick={() => setFormulaAmount(prev => prev + 10)}>+</button>
          </div>
          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} onClick={closeFormulaModal}>취소</button>
            <button className={styles.modalConfirmBtn} onClick={recordFormula}>기록</button>
          </div>
        </div>
      </div>
    );
  };

  const renderBreastModal = () => {
    if (!showBreastModal) return null;

    // 선택 화면: 지금 먹어요 / 이미 먹었어요
    if (breastMode === 'choose') {
      return (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBackdrop} onClick={closeBreastModal} />
          <div className={styles.modal}>
            <div className={styles.modalTitle}>모유 수유</div>
            <div className={styles.choiceButtons}>
              <button className={styles.choiceBtn} onClick={() => setBreastMode('now')}>
                <span className={styles.choiceBtnIcon}>⏱️</span>
                <span className={styles.choiceBtnLabel}>지금 먹어요</span>
                <span className={styles.choiceBtnSub}>타이머로 기록</span>
              </button>
              <button className={styles.choiceBtn} onClick={() => {
                setPastFeeding(prev => ({ ...prev, type: 'breast', dateTime: toDatetimeLocal() }));
                setBreastMode('past');
              }}>
                <span className={styles.choiceBtnIcon}>📝</span>
                <span className={styles.choiceBtnLabel}>이미 먹었어요</span>
                <span className={styles.choiceBtnSub}>시간/시간 직접 입력</span>
              </button>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={closeBreastModal}>취소</button>
            </div>
          </div>
        </div>
      );
    }

    // 지금 먹어요: 좌/우 선택 → 타이머 시작
    if (breastMode === 'now') {
      return (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBackdrop} onClick={closeBreastModal} />
          <div className={styles.modal}>
            <div className={styles.modalTitle}>모유 수유 - 지금 먹어요</div>
            <div className={styles.sideSelector}>
              <button
                className={`${styles.sideBtn} ${breastSide === 'left' ? styles.sideBtnActive : ''}`}
                onClick={() => setBreastSide('left')}
              >
                <span className={styles.sideBtnIcon}>👈</span>
                왼쪽
              </button>
              <button
                className={`${styles.sideBtn} ${breastSide === 'right' ? styles.sideBtnActive : ''}`}
                onClick={() => setBreastSide('right')}
              >
                <span className={styles.sideBtnIcon}>👉</span>
                오른쪽
              </button>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={closeBreastModal}>취소</button>
              <button className={styles.modalConfirmBtn} onClick={startBreastTimer}>시작</button>
            </div>
          </div>
        </div>
      );
    }

    // 이미 먹었어요: 시간, 좌/우, 시간 입력
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={closeBreastModal} />
        <div className={styles.modal}>
          <div className={styles.modalTitle}>모유 수유 - 이미 먹었어요</div>
          <div className={styles.editField}>
            <div className={styles.editLabel}>수유 시간</div>
            <input
              type="datetime-local"
              className={styles.editInput}
              value={pastFeeding.dateTime}
              onChange={(e) => setPastFeeding(prev => ({ ...prev, dateTime: e.target.value }))}
            />
          </div>
          <div className={styles.sideSelector}>
            <button
              className={`${styles.sideBtn} ${pastFeeding.side === 'left' ? styles.sideBtnActive : ''}`}
              onClick={() => setPastFeeding(prev => ({ ...prev, side: 'left' }))}
            >👈 왼쪽</button>
            <button
              className={`${styles.sideBtn} ${pastFeeding.side === 'right' ? styles.sideBtnActive : ''}`}
              onClick={() => setPastFeeding(prev => ({ ...prev, side: 'right' }))}
            >👉 오른쪽</button>
          </div>
          <div className={styles.amountControl}>
            <button className={styles.amountBtn} onClick={() => setPastFeeding(prev => ({ ...prev, durationMin: Math.max(1, prev.durationMin - 1) }))}>-</button>
            <div className={styles.amountValue}>
              <div className={styles.amountNumber}>{pastFeeding.durationMin}</div>
              <div className={styles.amountUnit}>분</div>
            </div>
            <button className={styles.amountBtn} onClick={() => setPastFeeding(prev => ({ ...prev, durationMin: prev.durationMin + 1 }))}>+</button>
          </div>
          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} onClick={closeBreastModal}>취소</button>
            <button className={styles.modalConfirmBtn} onClick={() => { closeBreastModal(); recordPastFeeding(); }}>기록</button>
          </div>
        </div>
      </div>
    );
  };

  const renderPastFeedingModal = () => {
    if (!showPastFeedingModal) return null;
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={() => setShowPastFeedingModal(false)} />
        <div className={styles.modal}>
          <div className={styles.modalTitle}>지난 수유 기록</div>

          <div className={styles.editField}>
            <div className={styles.editLabel}>수유 시간</div>
            <input
              type="datetime-local"
              className={styles.editInput}
              value={pastFeeding.dateTime}
              onChange={(e) => setPastFeeding(prev => ({ ...prev, dateTime: e.target.value }))}
            />
          </div>

          <div className={styles.sideSelector}>
            <button
              className={`${styles.sideBtn} ${pastFeeding.type === 'formula' ? styles.sideBtnActive : ''}`}
              onClick={() => setPastFeeding(prev => ({ ...prev, type: 'formula' }))}
            >🍼 분유</button>
            <button
              className={`${styles.sideBtn} ${pastFeeding.type === 'breast' ? styles.sideBtnActive : ''}`}
              onClick={() => setPastFeeding(prev => ({ ...prev, type: 'breast' }))}
            >🤱 모유</button>
          </div>

          {pastFeeding.type === 'formula' ? (
            <div className={styles.amountControl}>
              <button className={styles.amountBtn} onClick={() => setPastFeeding(prev => ({ ...prev, amountMl: Math.max(10, prev.amountMl - 10) }))}>-</button>
              <div className={styles.amountValue}>
                <div className={styles.amountNumber}>{pastFeeding.amountMl}</div>
                <div className={styles.amountUnit}>ml</div>
              </div>
              <button className={styles.amountBtn} onClick={() => setPastFeeding(prev => ({ ...prev, amountMl: prev.amountMl + 10 }))}>+</button>
            </div>
          ) : (
            <>
              <div className={styles.sideSelector}>
                <button
                  className={`${styles.sideBtn} ${pastFeeding.side === 'left' ? styles.sideBtnActive : ''}`}
                  onClick={() => setPastFeeding(prev => ({ ...prev, side: 'left' }))}
                >👈 왼쪽</button>
                <button
                  className={`${styles.sideBtn} ${pastFeeding.side === 'right' ? styles.sideBtnActive : ''}`}
                  onClick={() => setPastFeeding(prev => ({ ...prev, side: 'right' }))}
                >👉 오른쪽</button>
              </div>
              <div className={styles.amountControl}>
                <button className={styles.amountBtn} onClick={() => setPastFeeding(prev => ({ ...prev, durationMin: Math.max(1, prev.durationMin - 1) }))}>-</button>
                <div className={styles.amountValue}>
                  <div className={styles.amountNumber}>{pastFeeding.durationMin}</div>
                  <div className={styles.amountUnit}>분</div>
                </div>
                <button className={styles.amountBtn} onClick={() => setPastFeeding(prev => ({ ...prev, durationMin: prev.durationMin + 1 }))}>+</button>
              </div>
            </>
          )}

          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} onClick={() => setShowPastFeedingModal(false)}>취소</button>
            <button className={styles.modalConfirmBtn} onClick={recordPastFeeding}>기록</button>
          </div>
        </div>
      </div>
    );
  };

  const renderSleepModal = () => {
    if (!showSleepModal) return null;
    const isSleep = showSleepModal === 'sleep';
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={closeSleepModal} />
        <div className={styles.modal}>
          <div className={styles.modalTitle}>{isSleep ? '잠든 시간 기록' : '깬 시간 기록'}</div>
          <div className={styles.editField}>
            <div className={styles.editLabel}>{isSleep ? '잠든 시간' : '깬 시간'}</div>
            <input
              type="datetime-local"
              className={styles.editInput}
              value={sleepDateTime}
              onChange={(e) => setSleepDateTime(e.target.value)}
            />
          </div>
          {!isSleep && unmatchedSleep && (
            <div className={styles.sleepConnectInfo}>
              😴 {formatTime(unmatchedSleep.startedAt)}에 잠든 기록과 연결됩니다
            </div>
          )}
          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} onClick={closeSleepModal}>취소</button>
            <button className={styles.modalConfirmBtn} onClick={isSleep ? recordSleep : recordWake}>기록</button>
          </div>
        </div>
      </div>
    );
  };

  const renderEditModal = () => {
    if (!editItem) return null;
    const isFeeding = editItem.type === 'feeding';
    const isFormula = isFeeding && editItem.item.type === 'formula';
    const isBreast = isFeeding && editItem.item.type === 'breast';
    const isSleep = editItem.type === 'sleep';
    const isDiaper = editItem.type === 'diaper';
    const isDiaperPoop = isDiaper && (editItem.item.type === 'poop' || editItem.item.type === 'both');
    const update = (patch: Record<string, any>) => setEditItem({ ...editItem, item: { ...editItem.item, ...patch } });

    const modalTitle = isFormula ? '분유 수정' : isBreast ? '모유 수정' : isSleep ? '수면 수정' : '기저귀 수정';

    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={() => setEditItem(null)} />
        <div className={styles.modal}>
          <div className={styles.modalTitle}>{modalTitle}</div>

          {isFormula && (
            <div className={styles.editField}>
              <div className={styles.editLabel}>수유량 (ml)</div>
              <input
                type="number"
                className={styles.editInput}
                value={editItem.item.amountMl || ''}
                onChange={(e) => update({ amountMl: Number(e.target.value) })}
              />
            </div>
          )}

          {isBreast && (
            <>
              <div className={styles.editField}>
                <div className={styles.editLabel}>방향</div>
                <div className={styles.editToggleRow}>
                  <button
                    className={`${styles.editToggle} ${editItem.item.side === 'left' ? styles.editToggleActive : ''}`}
                    onClick={() => update({ side: 'left' })}
                  >왼쪽</button>
                  <button
                    className={`${styles.editToggle} ${editItem.item.side === 'right' ? styles.editToggleActive : ''}`}
                    onClick={() => update({ side: 'right' })}
                  >오른쪽</button>
                </div>
              </div>
              <div className={styles.editField}>
                <div className={styles.editLabel}>수유 시간 (분)</div>
                <input
                  type="number"
                  className={styles.editInput}
                  value={editItem.item.durationSec ? Math.round(editItem.item.durationSec / 60) : ''}
                  onChange={(e) => update({ durationSec: Number(e.target.value) * 60 })}
                />
              </div>
            </>
          )}

          {isDiaper && (
            <>
              <div className={styles.editField}>
                <div className={styles.editLabel}>종류</div>
                <div className={styles.editToggleRow}>
                  {[{ v: 'pee', l: '💧 소변' }, { v: 'poop', l: '💩 대변' }, { v: 'both', l: '🧷 둘 다' }].map(t => (
                    <button
                      key={t.v}
                      className={`${styles.editToggle} ${editItem.item.type === t.v ? styles.editToggleActive : ''}`}
                      onClick={() => update({ type: t.v })}
                    >{t.l}</button>
                  ))}
                </div>
              </div>
              {isDiaperPoop && (
                <>
                  <div className={styles.editField}>
                    <div className={styles.editLabel}>색상</div>
                    <div className={styles.diaperColorGrid}>
                      {DIAPER_COLORS.map(c => (
                        <button
                          key={c.value}
                          className={`${styles.diaperColorBtn} ${editItem.item.color === c.value ? styles.diaperColorBtnActive : ''}`}
                          onClick={() => update({ color: c.value })}
                        >
                          <span>{c.emoji}</span>
                          <span>{c.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.editField}>
                    <div className={styles.editLabel}>상태</div>
                    <div className={styles.editToggleRow}>
                      {DIAPER_CONSISTENCIES.map(c => (
                        <button
                          key={c.value}
                          className={`${styles.editToggle} ${editItem.item.consistency === c.value ? styles.editToggleActive : ''}`}
                          onClick={() => update({ consistency: c.value })}
                        >{c.label}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {!isDiaper && (
            <div className={styles.editField}>
              <div className={styles.editLabel}>시작 시각</div>
              <input
                type="text"
                className={styles.editInput}
                value={editItem.item.startedAt || ''}
                onChange={(e) => update({ startedAt: e.target.value })}
                placeholder="YYYY-MM-DD HH:mm:ss"
              />
            </div>
          )}

          {isDiaper && (
            <div className={styles.editField}>
              <div className={styles.editLabel}>기저귀 교체 시각</div>
              <input
                type="text"
                className={styles.editInput}
                value={editItem.item.changedAt || ''}
                onChange={(e) => update({ changedAt: e.target.value })}
                placeholder="YYYY-MM-DD HH:mm:ss"
              />
            </div>
          )}

          {(isBreast || isSleep) && (
            <div className={styles.editField}>
              <div className={styles.editLabel}>종료 시각</div>
              <input
                type="text"
                className={styles.editInput}
                value={editItem.item.endedAt || ''}
                onChange={(e) => update({ endedAt: e.target.value })}
                placeholder="YYYY-MM-DD HH:mm:ss"
              />
            </div>
          )}

          <div className={styles.editField}>
            <div className={styles.editLabel}>메모</div>
            <input
              type="text"
              className={styles.editInput}
              value={editItem.item.memo || ''}
              onChange={(e) => update({ memo: e.target.value })}
              placeholder="메모 입력..."
            />
          </div>

          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} onClick={() => setEditItem(null)}>취소</button>
            <button className={styles.modalConfirmBtn} onClick={handleEditSave}>저장</button>
          </div>

          <button
            className={styles.deleteBtn}
            onClick={() => {
              setConfirmDelete({ type: editItem.type, id: editItem.item.id });
            }}
          >
            삭제
          </button>
        </div>
      </div>
    );
  };

  const renderConfirmDeleteModal = () => {
    if (!confirmDelete) return null;
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={() => setConfirmDelete(null)} />
        <div className={styles.modal}>
          <div className={styles.modalTitle}>정말 삭제할까요?</div>
          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} onClick={() => setConfirmDelete(null)}>취소</button>
            <button
              className={styles.modalConfirmBtn}
              style={{ background: 'var(--color-danger, #FF3B30)' }}
              onClick={() => handleDelete(confirmDelete.type, confirmDelete.id)}
            >
              삭제
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // Render: Growth Tab
  // ============================================================

  const renderGrowthTab = () => {
    if (growthLoading) {
      return <div className={styles.loading}><div className={styles.loadingSpinner} /></div>;
    }
    if (!growthStandards) return null;

    const selectedBaby = babies.find(b => b.id === selectedBabyId);
    const birthDate = selectedBaby?.birthDate;

    const chartData = growthStandards[growthChartType];
    const W = 400, H = 280;
    const margin = { top: 15, right: 28, bottom: 28, left: 38 };
    const plotW = W - margin.left - margin.right;
    const plotH = H - margin.top - margin.bottom;
    const maxMonth = 24;

    const allVals = [...chartData.P3, ...chartData.P97];
    const yDataMin = Math.floor(Math.min(...allVals) * 10) / 10;
    const yDataMax = Math.ceil(Math.max(...allVals) * 10) / 10;
    const yPad = (yDataMax - yDataMin) * 0.06;
    const yMin = yDataMin - yPad;
    const yMax = yDataMax + yPad;

    const sx = (m: number) => margin.left + (m / maxMonth) * plotW;
    const sy = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const fieldKey = growthChartType === 'weight' ? 'weightKg' : growthChartType === 'height' ? 'heightCm' : 'headCm';

    const dataPoints = birthDate
      ? growthRecords
          .filter(r => r[fieldKey] != null)
          .map(r => ({ record: r, ageMonths: getAgeMonths(birthDate, r.measuredDate), value: r[fieldKey]! }))
          .filter(p => p.ageMonths >= 0 && p.ageMonths <= 24)
          .sort((a, b) => a.ageMonths - b.ageMonths)
      : [];

    const buildLine = (vals: number[]) =>
      chartData.months.map((m, i) => `${i === 0 ? 'M' : 'L'}${sx(m).toFixed(1)},${sy(vals[i]).toFixed(1)}`).join(' ');

    const buildBand = (upper: number[], lower: number[]) => {
      const forward = chartData.months.map((m, i) => `${i === 0 ? 'M' : 'L'}${sx(m).toFixed(1)},${sy(upper[i]).toFixed(1)}`).join(' ');
      const backward = [...chartData.months].reverse().map((m, i) => `L${sx(m).toFixed(1)},${sy([...lower].reverse()[i]).toFixed(1)}`).join(' ');
      return `${forward} ${backward} Z`;
    };

    const yUnit = growthChartType === 'weight' ? 2 : growthChartType === 'height' ? 10 : 2;
    const yGridValues: number[] = [];
    for (let v = Math.ceil(yMin / yUnit) * yUnit; v <= yMax; v += yUnit) yGridValues.push(v);

    const latestRecord = growthRecords.length > 0 ? growthRecords[growthRecords.length - 1] : null;

    const chartTypeOptions = [
      { value: 'weight' as const, label: '체중(kg)' },
      { value: 'height' as const, label: '신장(cm)' },
      { value: 'head' as const, label: '머리둘레(cm)' },
    ];

    const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();

    return (
      <div className={styles.growthSection}>
        {/* Chart Type Selector */}
        <div className={styles.growthChartTypeSelector}>
          {chartTypeOptions.map(t => (
            <button
              key={t.value}
              className={`${styles.growthChartTypeBtn} ${growthChartType === t.value ? styles.growthChartTypeBtnActive : ''}`}
              onClick={() => setGrowthChartType(t.value)}
            >{t.label}</button>
          ))}
        </div>

        {/* Latest Measurement Card */}
        {latestRecord && (
          <div className={styles.growthLatestCard}>
            {latestRecord.weightKg != null && (
              <div className={styles.growthLatestItem}>
                <div className={styles.growthLatestValue}>{latestRecord.weightKg}<span className={styles.growthLatestUnit}>kg</span></div>
                <div className={styles.growthLatestLabel}>체중</div>
              </div>
            )}
            {latestRecord.heightCm != null && (
              <div className={styles.growthLatestItem}>
                <div className={styles.growthLatestValue}>{latestRecord.heightCm}<span className={styles.growthLatestUnit}>cm</span></div>
                <div className={styles.growthLatestLabel}>신장</div>
              </div>
            )}
            {latestRecord.headCm != null && (
              <div className={styles.growthLatestItem}>
                <div className={styles.growthLatestValue}>{latestRecord.headCm}<span className={styles.growthLatestUnit}>cm</span></div>
                <div className={styles.growthLatestLabel}>머리둘레</div>
              </div>
            )}
            {birthDate && (
              <div className={styles.growthLatestItem}>
                <div className={styles.growthLatestValue}>{Math.floor(getAgeMonths(birthDate, latestRecord.measuredDate))}<span className={styles.growthLatestUnit}>개월</span></div>
                <div className={styles.growthLatestLabel}>측정 시</div>
              </div>
            )}
          </div>
        )}

        {/* SVG Growth Chart */}
        <div className={styles.growthChartWrap}>
          {!birthDate ? (
            <div className={styles.growthNoBirth}>생년월일을 설정하면 성장 차트를 볼 수 있어요</div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className={styles.growthChartSvg} preserveAspectRatio="xMidYMid meet">
              <defs>
                <clipPath id="growthPlot">
                  <rect x={margin.left} y={margin.top} width={plotW} height={plotH} />
                </clipPath>
              </defs>

              {/* Percentile bands */}
              <g clipPath="url(#growthPlot)">
                <path d={buildBand(chartData.P97, chartData.P85)} fill="rgba(99,102,241,0.06)" />
                <path d={buildBand(chartData.P85, chartData.P50)} fill="rgba(99,102,241,0.10)" />
                <path d={buildBand(chartData.P50, chartData.P15)} fill="rgba(99,102,241,0.10)" />
                <path d={buildBand(chartData.P15, chartData.P3)} fill="rgba(99,102,241,0.06)" />
              </g>

              {/* Grid */}
              {yGridValues.map(v => (
                <line key={v} x1={margin.left} x2={W - margin.right} y1={sy(v)} y2={sy(v)} stroke="#e8e8ed" strokeWidth="0.5" />
              ))}
              {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(m => (
                <line key={m} x1={sx(m)} x2={sx(m)} y1={margin.top} y2={H - margin.bottom} stroke="#e8e8ed" strokeWidth="0.5" />
              ))}

              {/* Percentile lines */}
              {(['P3', 'P15', 'P50', 'P85', 'P97'] as const).map(pKey => (
                <path key={pKey} d={buildLine(chartData[pKey])} fill="none"
                  stroke={pKey === 'P50' ? 'rgba(99,102,241,0.5)' : 'rgba(99,102,241,0.2)'}
                  strokeWidth={pKey === 'P50' ? '1' : '0.5'}
                  strokeDasharray={pKey === 'P50' ? 'none' : '3 2'}
                  clipPath="url(#growthPlot)" />
              ))}

              {/* Percentile labels */}
              {(['P3', 'P15', 'P50', 'P85', 'P97'] as const).map(pKey => (
                <text key={pKey} x={W - margin.right + 2} y={sy(chartData[pKey][24])}
                  fontSize="6" fill="#aeaeb2" dominantBaseline="middle">{pKey.replace('P', '')}%</text>
              ))}

              {/* X-axis */}
              {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(m => (
                <text key={m} x={sx(m)} y={H - margin.bottom + 12} fontSize="7" fill="#86868b" textAnchor="middle">{m}</text>
              ))}
              <text x={W / 2} y={H - 3} fontSize="7" fill="#aeaeb2" textAnchor="middle">개월</text>

              {/* Y-axis */}
              {yGridValues.map(v => (
                <text key={v} x={margin.left - 3} y={sy(v)} fontSize="7" fill="#86868b" textAnchor="end" dominantBaseline="middle">{v}</text>
              ))}

              {/* Baby data line */}
              {dataPoints.length > 1 && (
                <path
                  d={dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.ageMonths).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ')}
                  fill="none" stroke="var(--color-primary, #6366f1)" strokeWidth="2" strokeLinejoin="round"
                  clipPath="url(#growthPlot)" />
              )}

              {/* Baby data points */}
              {dataPoints.map((p, i) => (
                <g key={p.record.id}>
                  {/* Invisible larger hit area */}
                  <circle cx={sx(p.ageMonths)} cy={sy(p.value)} r="12" fill="transparent"
                    style={{ cursor: 'pointer' }} onClick={() => setGrowthDetailRecord(p.record)} />
                  <circle cx={sx(p.ageMonths)} cy={sy(p.value)}
                    r={i === dataPoints.length - 1 ? 4.5 : 3} fill="var(--color-primary, #6366f1)"
                    stroke="white" strokeWidth="1.5" pointerEvents="none" />
                </g>
              ))}

              {/* Gender indicator */}
              <text x={margin.left + 4} y={margin.top + 10} fontSize="8" fill="#aeaeb2">
                {growthGender === 'M' ? '남아' : '여아'} · WHO 2006
              </text>
            </svg>
          )}
        </div>

        {/* Add Record Button */}
        <button className={styles.growthAddBtn} onClick={() => {
          setGrowthForm({ date: todayStr, weightKg: '', heightCm: '', headCm: '', memo: '' });
          setShowGrowthModal(true);
        }}>+ 성장 기록 추가</button>

        {/* Record List */}
        {growthRecords.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📏</div>
            <div className={styles.emptyText}>아직 성장 기록이 없어요</div>
            <div className={styles.emptySubtext}>소아과 방문 시 키/몸무게를 기록해보세요</div>
          </div>
        ) : (
          <div className={styles.growthRecordList}>
            {[...growthRecords].reverse().map(r => (
              <div key={r.id} className={styles.growthRecordCard} onClick={() => setGrowthDetailRecord(r)}>
                <div className={styles.growthRecordLeft}>
                  <div className={styles.growthRecordDate}>{r.measuredDate}</div>
                  {birthDate && (
                    <div className={styles.growthRecordAge}>{Math.floor(getAgeMonths(birthDate, r.measuredDate))}개월</div>
                  )}
                </div>
                <div className={styles.growthRecordValues}>
                  {r.weightKg != null && <span>{r.weightKg}kg</span>}
                  {r.heightCm != null && <span>{r.heightCm}cm</span>}
                  {r.headCm != null && <span>머리 {r.headCm}cm</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Record Modal */}
        {showGrowthModal && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalBackdrop} onClick={() => setShowGrowthModal(false)} />
            <div className={styles.modal}>
              <div className={styles.modalTitle}>성장 기록</div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>측정일</label>
                <input type="date" className={styles.formInput}
                  value={growthForm.date} onChange={e => setGrowthForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className={styles.growthModalRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>체중(kg)</label>
                  <input type="number" step="0.1" inputMode="decimal" className={styles.formInput} placeholder="0.0"
                    value={growthForm.weightKg} onChange={e => setGrowthForm(f => ({ ...f, weightKg: e.target.value }))} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>신장(cm)</label>
                  <input type="number" step="0.1" inputMode="decimal" className={styles.formInput} placeholder="0.0"
                    value={growthForm.heightCm} onChange={e => setGrowthForm(f => ({ ...f, heightCm: e.target.value }))} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>머리둘레(cm)</label>
                  <input type="number" step="0.1" inputMode="decimal" className={styles.formInput} placeholder="0.0"
                    value={growthForm.headCm} onChange={e => setGrowthForm(f => ({ ...f, headCm: e.target.value }))} />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>메모 (선택)</label>
                <input type="text" className={styles.formInput} placeholder="병원 방문, 건강검진 등"
                  value={growthForm.memo} onChange={e => setGrowthForm(f => ({ ...f, memo: e.target.value }))} />
              </div>
              <div className={styles.modalActions}>
                <button className={styles.modalCancelBtn} onClick={() => setShowGrowthModal(false)}>취소</button>
                <button className={styles.modalConfirmBtn} onClick={handleAddGrowth}>기록</button>
              </div>
            </div>
          </div>
        )}

        {/* Detail Modal */}
        {growthDetailRecord && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalBackdrop} onClick={() => setGrowthDetailRecord(null)} />
            <div className={styles.modal}>
              <div className={styles.modalTitle}>
                {growthDetailRecord.measuredDate}
                {birthDate && ` (${Math.floor(getAgeMonths(birthDate, growthDetailRecord.measuredDate))}개월)`}
              </div>
              <div className={styles.growthDetailGrid}>
                {growthDetailRecord.weightKg != null && (
                  <div className={styles.growthDetailItem}>
                    <div className={styles.growthDetailValue}>{growthDetailRecord.weightKg}</div>
                    <div className={styles.growthDetailLabel}>체중 (kg)</div>
                  </div>
                )}
                {growthDetailRecord.heightCm != null && (
                  <div className={styles.growthDetailItem}>
                    <div className={styles.growthDetailValue}>{growthDetailRecord.heightCm}</div>
                    <div className={styles.growthDetailLabel}>신장 (cm)</div>
                  </div>
                )}
                {growthDetailRecord.headCm != null && (
                  <div className={styles.growthDetailItem}>
                    <div className={styles.growthDetailValue}>{growthDetailRecord.headCm}</div>
                    <div className={styles.growthDetailLabel}>머리둘레 (cm)</div>
                  </div>
                )}
              </div>
              {growthDetailRecord.memo && (
                <div className={styles.growthDetailMemo}>{growthDetailRecord.memo}</div>
              )}
              <div className={styles.modalActions}>
                <button className={styles.modalCancelBtn} onClick={() => setGrowthDetailRecord(null)}>닫기</button>
                <button className={styles.growthDeleteBtn} onClick={() => handleDeleteGrowth(growthDetailRecord.id)}>삭제</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ============================================================
  // Render: Baby Modal
  // ============================================================

  const renderBabyModal = () => {
    if (!showBabyModal) return null;
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modalBackdrop} onClick={() => { setShowBabyModal(false); setEditingBabyId(null); }} />
        <div className={styles.modal}>
          <div className={styles.modalTitle}>{editingBabyId ? '아이 수정' : '아이 추가'}</div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>이름</label>
            <input
              className={styles.formInput}
              value={babyForm.name}
              onChange={e => setBabyForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="아이 이름"
              autoFocus
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>생년월일 (선택)</label>
            <input
              className={styles.formInput}
              type="date"
              value={babyForm.birthDate}
              onChange={e => setBabyForm(prev => ({ ...prev, birthDate: e.target.value }))}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>성별</label>
            <div className={styles.genderSelector}>
              {([['F', '여아 👧'], ['M', '남아 👦']] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={`${styles.genderBtn} ${babyForm.gender === val ? styles.genderBtnActive : ''}`}
                  onClick={() => setBabyForm(prev => ({ ...prev, gender: prev.gender === val ? '' : val }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} onClick={() => { setShowBabyModal(false); setEditingBabyId(null); }}>취소</button>
            <button className={styles.modalConfirmBtn} onClick={editingBabyId ? handleEditBaby : handleAddBaby}>
              {editingBabyId ? '수정' : '추가'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // Main Render
  // ============================================================

  if (loading) {
    return (
      <div className={styles.layout}>
        <div className={styles.loading}><div className={styles.loadingSpinner} /></div>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div className={styles.brand}>
          <div className={styles.brandBlock}>
            <img src="/icons/logo-web.png" alt="" className={styles.pageLogo} />
            <span className={styles.brandName}>땅콩패밀리</span>
          </div>
          <h1 className={styles.pageTitle}>육아</h1>
        </div>
      </div>

      {/* Baby selector - always visible */}
      <div className={styles.babySelector}>
        {babies.map(baby => (
          <div key={baby.id} style={{ position: 'relative' }}>
            <button
              className={`${styles.babyChip} ${selectedBabyId === baby.id ? styles.babyChipActive : ''}`}
              onClick={() => {
                if (selectedBabyId === baby.id) {
                  openBabyEdit(baby);
                } else {
                  setSelectedBabyId(baby.id);
                }
              }}
            >
              {baby.name}
              {selectedBabyId === baby.id && <span className={styles.babyChipEdit}>✎</span>}
            </button>
          </div>
        ))}
        <button className={styles.babyAddBtn} onClick={openBabyAdd}>+</button>
      </div>

      {/* Sub-tabs */}
      <div className={styles.subTabs}>
        <div className={styles.subTabTrack}>
          {SUB_TABS.map(({ value, label, icon }) => (
            <button
              key={value}
              className={`${styles.subTab} ${activeTab === value ? styles.subTabActive : ''}`}
              onClick={() => setActiveTab(value)}
            >
              <span className={styles.subTabIcon}>{icon}</span>
              <span className={styles.subTabLabel}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Summary (feeding/sleep only) */}
      {(activeTab === 'feeding' || activeTab === 'sleep' || activeTab === 'diaper') && renderSummary()}

      {/* Tab Content */}
      {activeTab === 'feeding' && renderFeedingTab()}
      {activeTab === 'sleep' && renderSleepTab()}
      {activeTab === 'diaper' && renderDiaperTab()}
      {activeTab === 'vaccination' && renderVaccinationTab()}
      {activeTab === 'growth' && renderGrowthTab()}
      {activeTab === 'observations' && renderObservationsTab()}
      {activeTab === 'chat' && renderChatTab()}

      {/* Modals */}
      {renderFormulaModal()}
      {renderBreastModal()}
      {renderSleepModal()}
      {renderDiaperConditionModal()}
      {renderEditModal()}
      {renderConfirmDeleteModal()}
      {renderBabyModal()}
    </div>
  );
}
