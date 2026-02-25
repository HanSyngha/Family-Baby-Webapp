import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';

interface ProcessingStatus {
  current: { filename: string; originalName: string; startedAt: number } | null;
  queueCount: number;
  recentErrors: { filename: string; originalName: string; error?: string }[];
  isProcessing: boolean;
}

export function useProcessingStatus(active: boolean) {
  const [status, setStatus] = useState<ProcessingStatus>({
    current: null,
    queueCount: 0,
    recentErrors: [],
    isProcessing: false,
  });
  const seenErrorsRef = useRef<Set<string>>(new Set());
  const prevProcessingRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const data = await api.getProcessingStatus();
      const isProcessing = !!(data.current || data.queue.length > 0);

      // 새 에러만 추출 (이미 본 것 제외)
      const newErrors = data.recentResults
        .filter(r => r.status === 'error' && !seenErrorsRef.current.has(r.filename))
        .map(r => ({ filename: r.filename, originalName: r.originalName, error: r.error }));
      for (const e of newErrors) seenErrorsRef.current.add(e.filename);

      setStatus(prev => ({
        current: data.current,
        queueCount: data.queue.length,
        recentErrors: [...prev.recentErrors, ...newErrors],
        isProcessing,
      }));

      return isProcessing;
    } catch {
      return false;
    }
  }, []);

  // 처리 완료 감지
  const wasProcessing = prevProcessingRef.current;
  prevProcessingRef.current = status.isProcessing;
  const justFinished = wasProcessing && !status.isProcessing;

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const loop = async () => {
      const stillProcessing = await poll();
      if (cancelled) return;
      // 처리 중이면 3초, 아니면 폴링 중지
      if (stillProcessing) {
        timer = setTimeout(loop, 3000);
      }
    };

    loop();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, poll]);

  const dismissError = useCallback((filename: string) => {
    setStatus(prev => ({
      ...prev,
      recentErrors: prev.recentErrors.filter(e => e.filename !== filename),
    }));
  }, []);

  const dismissAllErrors = useCallback(() => {
    setStatus(prev => ({ ...prev, recentErrors: [] }));
  }, []);

  return { ...status, justFinished, dismissError, dismissAllErrors };
}
