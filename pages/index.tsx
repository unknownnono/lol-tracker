import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { PLATFORMS } from '@/lib/riot';
import {
  getOrCreateSyncCode,
  setSyncCode,
  pushToServer,
  pullFromServer,
  RECENT_KEY,
  FAVORITES_KEY,
} from '@/lib/clientSync';

interface SavedEntry {
  platform: string;
  gameName: string;
  tagLine: string;
}

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
  const [syncCode, setSyncCodeState] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [syncing, setSyncing] = useState(false);

  function loadFromLocalStorage() {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'));
      setFavorites(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
    } catch {
      // localStorage 접근 불가 시 무시
    }
  }

  useEffect(() => {
    loadFromLocalStorage();
    setSyncCodeState(getOrCreateSyncCode());
    // 서버에 저장된 데이터가 있으면 가져와서 최신 상태로 맞춥니다 (실패해도 로컬 데이터 그대로 사용).
    pullFromServer().then((data) => {
      if (data) loadFromLocalStorage();
    });
  }, []);

  function saveRecent(entry: SavedEntry) {
    const next = [entry, ...recent.filter((r) => !(r.platform === entry.platform && r.gameName === entry.gameName && r.tagLine === entry.tagLine))].slice(0, 6);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      pushToServer();
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

  async function handleLinkCode(e: FormEvent) {
    e.preventDefault();
    if (!codeInput.trim()) return;
    setSyncing(true);
    setSyncCode(codeInput);
    setSyncCodeState(codeInput.trim().toUpperCase());
    await pullFromServer();
    loadFromLocalStorage();
    setSyncing(false);
    setCodeInput('');
  }

  return (
    <div className="container">
      <Head>
        <title>LoL 전적 검색</title>
        <meta name="description" content="이름#태그로 랭크, 최근 전적, 매치 상세까지 확인하는 롤 전적 검색 사이트" />
        <meta property="og:title" content="LoL 전적 검색" />
        <meta property="og:description" content="이름#태그로 랭크, 최근 전적, 매치 상세까지 확인하세요." />
        <meta property="og:image" content="https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ahri_0.jpg" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
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

      <div className="sync-box">
        <div className="section-label">기기 간 동기화</div>
        <p className="sync-desc">
          이 코드를 적어두면 다른 기기/브라우저에서도 같은 즐겨찾기·최근검색을 볼 수 있어요.
          내 코드: <strong className="sync-code">{syncCode}</strong>
        </p>
        <form className="sync-form" onSubmit={handleLinkCode}>
          <input
            type="text"
            placeholder="다른 기기의 코드 입력"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
          />
          <button type="submit" disabled={syncing}>{syncing ? '불러오는 중...' : '연결'}</button>
        </form>
      </div>
    </div>
  );
}
