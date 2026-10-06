import type { ReactElement } from 'react';

/** [시작 ms, 진동 패턴] — 진동은 사용자가 화면을 한 번이라도 누른 뒤에만 울린다 */
export type Haptic = [number, number | number[]][];

/**
 * 말씀 구절이 언제·어디에 뜨나
 *   mid    장면 아래, 35%쯤 (짧은 장면)
 *   late   장면 아래, 56%쯤 (장면이 끝난 뒤)
 *   top    화면 위쪽 30%, 60%쯤 (화면 전체를 쓰는 장면)
 *   bottom 화면 아래쪽, 56%쯤
 *   none   말씀 대신 장면이 직접 글을 띄움 (설이 응원)
 */
export type CaptionMode = 'mid' | 'late' | 'top' | 'bottom' | 'none';

export interface SceneSpec {
  /** 사람이 읽는 이름 (탑승권을 눌러 다시 볼 때 안내용) */
  name: string;
  ms: number;
  haptic: Haptic;
  caption: CaptionMode;
  /** 오버레이 배경 (CSS background 값) */
  bg: string;
  Scene: () => ReactElement;
}
