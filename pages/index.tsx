import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { PLATFORMS } from '@/lib/riot';

interface SavedEntry {
  platform: string;
  gameName: string;
  tagLine: string;
}

const RECENT_KEY = 'lol-tracker-recent-searches';
const FAVORITES_KEY = 'lol-tracker-favorites';

function EntryChips({ title, entries, gold }: { title: string; entries: SavedEntry[]; gold?: boolean }) {
  if (entries.length === 0) return null;
  return (
    <div className="recent-searches">
      <div className="section-label">{title}</div>
      <div className="recent-chip-row">
        {entries.map((r) => (
          <Link
            key={`${r.platform}-${r.gameName}-${r.tagLine}`}
            href={`/summoner/${r.platform}/${encodeURIComponent(`${r.gameName}-${r.tagLine}`)}`}
            className={`recent-chip ${gold ? 'favorite' : ''}`}
          >
            {gold && <span className="star">★</span>}
            {r.gameName}
            <span className="tag">#{r.tagLine}</span>
            <span className="plat">{r.platform.toUpperCase()}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [platform, setPlatform] = useState('kr');
  const [riotId, setRiotId] = useState('');
  const [recent, setRecent] = useState<SavedEntry[]>([]);
  const [favorites, setFavorites] = useState<SavedEntry[]>([]);

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'));
      setFavorites(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
    } catch {
      // localStorage 접근 불가 시 무시
    }
  }, []);

  function saveRecent(entry: SavedEntry) {
    const next = [entry, ...recent.filter((r) => !(r.platform === entry.platform && r.gameName === entry.gameName && r.tagLine === entry.tagLine))].slice(0, 6);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // 저장 실패해도 검색 자체는 계속 진행
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const [gameName, tagLine] = riotId.split('#').map((s) => s.trim());
    if (!gameName || !tagLine) {
      alert('예: Hide on bush#KR1 형식으로 입력해주세요.');
      return;
    }
    saveRecent({ platform, gameName, tagLine });
    router.push(`/summoner/${platform}/${encodeURIComponent(`${gameName}-${tagLine}`)}`);
  }

  return (
    <div className="container">
      <div className="hero-bg">
        <div className="hero">
          <h1>소환사 전적 검색</h1>
          <p>이름#태그로 랭크, 최근 전적, 매치 상세까지 확인하세요.</p>
          <form className="search-box" onSubmit={handleSubmit}>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
            <input type="text" placeholder="Hide on bush#KR1" value={riotId} onChange={(e) => setRiotId(e.target.value)} />
            <button type="submit">검색</button>
          </form>
        </div>
      </div>

      <EntryChips title="즐겨찾기" entries={favorites} gold />
      <EntryChips title="최근 검색" entries={recent} />
    </div>
  );
}
