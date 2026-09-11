/**
 * 앱 전역 아이콘 세트.
 *
 * 이모지를 UI 아이콘으로 쓰면 OS마다 다르게 그려지고, 굵기·시각적 무게가 제각각이라
 * 나란히 놓았을 때 줄이 안 맞는다. 바텀탭 아이콘과 같은 언어(24px, stroke 1.75, round)로 통일한다.
 * 사용자가 직접 고르는 이모지(노트 주제 등)는 콘텐츠이므로 그대로 둔다.
 */
import type { ReactElement } from 'react';

export type IconName =
  | 'bottle' | 'breast' | 'moon' | 'sun' | 'diaper' | 'droplet' | 'stool'
  | 'syringe' | 'ruler' | 'clipboard' | 'chat' | 'baby' | 'cake'
  | 'calendar' | 'check-square' | 'note' | 'camera' | 'lock' | 'plane'
  | 'users' | 'pin' | 'alert' | 'sparkle' | 'eye' | 'map' | 'car'
  | 'wallet' | 'folder' | 'peanut' | 'home' | 'heart' | 'download' | 'plus'
  | 'arrow-left' | 'arrow-right' | 'chart' | 'bed' | 'ticket' | 'utensils' | 'bag' | 'unlock' | 'edit';

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const PATHS: Record<IconName, ReactElement> = {
  bottle: (
    <>
      <path d="M10 2h4M10.5 4.5h3l.8 2.2H9.7z" />
      <path d="M9 6.7h6a2 2 0 0 1 2 2V19a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V8.7a2 2 0 0 1 2-2z" />
      <path d="M11 10.5h4M11 14h4" />
    </>
  ),
  breast: (
    <path d="M12 20.5S4 15.9 4 10.4A4.4 4.4 0 0 1 12 7.9a4.4 4.4 0 0 1 8 2.5c0 5.5-8 10.1-8 10.1z" />
  ),
  moon: <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.6 8.6 0 1 0 20 14.2z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  diaper: (
    <>
      <path d="M4 5.5h16v4.8c0 3-2 4.6-4.4 5.6-1.6.7-2.6 1.9-3.1 3.6h-1c-.5-1.7-1.5-2.9-3.1-3.6C6 14.9 4 13.3 4 10.3z" />
      <path d="M4 8.6h16" />
      <path d="M2.6 6.6 4 5.5v3.6zM21.4 6.6 20 5.5v3.6z" />
    </>
  ),
  droplet: <path d="M12 3.2s5.5 5.6 5.5 9.4a5.5 5.5 0 0 1-11 0C6.5 8.8 12 3.2 12 3.2z" />,
  stool: (
    <>
      <path d="M9.5 8.5h5a2 2 0 0 1 0 4h1.5a2 2 0 0 1 0 4h1a2 2 0 0 1 0 4H7a2 2 0 0 1 0-4h1a2 2 0 0 1 0-4h1.5a2 2 0 0 1 0-4z" />
      <path d="M11 5.2c.7-1.3 2.4-1.3 3 0" />
    </>
  ),
  syringe: (
    <>
      <rect x="7" y="9" width="9" height="6" rx="1" />
      <path d="M16 12h2.5M18.5 10.5v3M18.5 12H22" />
      <path d="M7 12H4.5M5.8 10v4" />
      <path d="M10 9v6M12.5 9v6" />
    </>
  ),
  ruler: (
    <>
      <rect x="2.5" y="8.5" width="19" height="7" rx="1.6" />
      <path d="M7 8.5v3M11 8.5v4M15 8.5v3M19 8.5v4" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4.5H7.5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2H15" />
      <rect x="9" y="2.5" width="6" height="4" rx="1.3" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  chat: <path d="M20.5 14a3.5 3.5 0 0 1-3.5 3.5H8.5L4 21V6.5A3.5 3.5 0 0 1 7.5 3h9.5a3.5 3.5 0 0 1 3.5 3.5z" />,
  baby: (
    <>
      <circle cx="12" cy="8.5" r="5" />
      <path d="M10 8h.01M14 8h.01M10.3 10.8a2.6 2.6 0 0 0 3.4 0" />
      <path d="M6.5 21v-1.2A3.8 3.8 0 0 1 10.3 16h3.4a3.8 3.8 0 0 1 3.8 3.8V21" />
    </>
  ),
  cake: (
    <>
      <path d="M3.5 21h17" />
      <path d="M5 21v-6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V21" />
      <path d="M5 16.8c1.4.9 2.8.9 4.2 0s2.8-.9 4.2 0 2.8.9 4.2 0" />
      <path d="M12 12.5V9" />
      <circle cx="12" cy="6.6" r="1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="17" rx="2.6" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  'check-square': (
    <>
      <path d="M20.5 12v7a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 19V6A2.5 2.5 0 0 1 6 3.5h9" />
      <path d="M8.5 11.5 12 15l8.5-8.5" />
    </>
  ),
  note: (
    <>
      <path d="M13.5 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V9z" />
      <path d="M13.5 3v6h6M8.5 13h7M8.5 17h5" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.9l1.3-2.2h6.6L16.6 6h1.9A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.6" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  plane: <path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.7.7 0 0 0-.7 1.1L7.5 11l-2 2H3.5l-.8 1.6 3.3 1.4 1.4 3.3L9 18.5V16.5l2-2 3.7 3.4a.7.7 0 0 0 1.1-.7z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.6" />
      <path d="M2.8 20v-1a4.6 4.6 0 0 1 4.6-4.6h3.2A4.6 4.6 0 0 1 15.2 19v1" />
      <path d="M16.5 4.8a3.6 3.6 0 0 1 0 6.9M18 14.6a4.6 4.6 0 0 1 3.2 4.4v1" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10.2c0 5.2-7 11.3-7 11.3s-7-6.1-7-11.3a7 7 0 0 1 14 0z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.2 13.7 8.3 18.8 10 13.7 11.7 12 16.8 10.3 11.7 5.2 10 10.3 8.3z" />
      <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>
  ),
  eye: (
    <>
      <path d="M1.8 12S5.9 4.8 12 4.8 22.2 12 22.2 12 18.1 19.2 12 19.2 1.8 12 1.8 12z" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  map: (
    <>
      <path d="M9 4.2 3 6.5v13.3l6-2.3 6 2.3 6-2.3V4.2l-6 2.3z" />
      <path d="M9 4.2v13.3M15 6.5v13.3" />
    </>
  ),
  car: (
    <>
      <path d="M4.5 16.5v2.2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-6l2.3-5.3a2 2 0 0 1 1.9-1.2h10.6a2 2 0 0 1 1.9 1.2L20.5 12.7v6a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2.2" />
      <path d="M2.5 12.7h17M6 16h2M14 16h2" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 19H5.5A2.5 2.5 0 0 1 3 16.5z" />
      <path d="M3 9.5h18M16.5 13.5h.01" />
    </>
  ),
  folder: <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.2l2 2.6H18.5A2.5 2.5 0 0 1 21 9.1v8.4a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />,
  peanut: (
    <>
      <path d="M12 2.8c2.5 0 4.3 1.9 4.3 4.3 0 1.5-.7 2.4-.7 3.6 0 1.4.9 2 1.5 3.3a5.2 5.2 0 1 1-10.2 0c.6-1.3 1.5-1.9 1.5-3.3 0-1.2-.7-2.1-.7-3.6 0-2.4 1.8-4.3 4.3-4.3z" />
      <path d="M9.1 10.6h5.8" />
    </>
  ),
  home: (
    <>
      <path d="M3 9.5 12 2.5l9 7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9.5 22v-8h5v8" />
    </>
  ),
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z" />,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10.5 12 15.5 17 10.5M12 15.5V3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  'arrow-left': <path d="M19 12H5M11 18l-6-6 6-6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M6.5 20.5v-6M11 20.5V6.5M15.5 20.5v-9M20 20.5v-4" />
    </>
  ),
  bed: (
    <>
      <path d="M3 19v-9M3 13.5h18v5.5M21 19v-3.5a3 3 0 0 0-3-3h-7" />
      <circle cx="7.5" cy="10" r="2.2" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 8.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.8a2.2 2.2 0 0 0 0 4.4v1.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.8a2.2 2.2 0 0 0 0-4.4z" />
      <path d="M14 7v2M14 11.5v2M14 16v2" />
    </>
  ),
  utensils: (
    <>
      <path d="M7 3v8a2.5 2.5 0 0 0 5 0V3M9.5 11v10" />
      <path d="M17.5 3c-1.4 1.2-2 3-2 5.5 0 1.6.7 2.6 2 3V21" />
    </>
  ),
  bag: (
    <>
      <rect x="3" y="7.5" width="18" height="13" rx="2.2" />
      <path d="M8.5 7.5V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2.5M9 12.5v3.5M15 12.5v3.5" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h8" />
      <path d="M16.4 3.6a2 2 0 0 1 2.8 2.8L8.4 17.2 4 18.4l1.2-4.4z" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
    </>
  ),
};

export default function Icon({ name, size = 20, className, strokeWidth = 1.75 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
