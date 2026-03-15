import styles from './UserBadges.module.css';

interface UserInfo {
  userId: number;
  name: string;
  profileImage: string | null;
}

interface Props {
  viewers: UserInfo[];
  downloaders: UserInfo[];
}

export default function UserBadges({ viewers, downloaders }: Props) {
  // 뷰어 + 다운로더를 합쳐서 유니크하게
  const all = [...viewers, ...downloaders];
  const unique = all.filter((u, i, arr) => arr.findIndex(v => v.userId === u.userId) === i);
  const show = unique.slice(0, 3);
  const extra = unique.length - 3;

  if (unique.length === 0) return null;

  return (
    <div className={styles.badges}>
      {show.map((u, i) => (
        <div
          key={u.userId}
          className={styles.badge}
          style={{ zIndex: 3 - i }}
          title={u.name}
        >
          {u.profileImage
            ? <img src={u.profileImage} alt="" />
            : <span>{u.name[0]}</span>
          }
        </div>
      ))}
      {extra > 0 && <span className={styles.extra}>+{extra}</span>}
    </div>
  );
}
