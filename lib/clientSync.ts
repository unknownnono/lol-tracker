// 브라우저에서만 사용하는 헬퍼입니다. 로그인 없이도 "동기화 코드" 하나로
// 즐겨찾기/최근검색을 여러 기기에서 같이 쓸 수 있게 해줍니다.

export const SYNC_CODE_KEY = 'lol-tracker-sync-code';
export const RECENT_KEY = 'lol-tracker-recent-searches';
export const FAVORITES_KEY = 'lol-tracker-favorites';

export function getOrCreateSyncCode(): string {
  let code = localStorage.getItem(SYNC_CODE_KEY);
  if (!code) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
    localStorage.setItem(SYNC_CODE_KEY, code);
  }
  return code;
}

export function setSyncCode(code: string) {
  localStorage.setItem(SYNC_CODE_KEY, code.trim().toUpperCase());
}

// 지금 로컬(이 브라우저)에 있는 데이터를 서버로 올립니다.
export async function pushToServer() {
  try {
    const code = getOrCreateSyncCode();
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, data: { recent, favorites } }),
    });
  } catch {
    // 동기화 서버가 없거나 네트워크 문제가 있어도 로컬 데이터는 그대로 유지되므로 조용히 무시합니다.
  }
}

// 서버에 저장된 데이터를 가져와 로컬(이 브라우저)에 덮어씁니다.
export async function pullFromServer(): Promise<{ recent: any[]; favorites: any[] } | null> {
  try {
    const code = getOrCreateSyncCode();
    const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.data) {
      localStorage.setItem(RECENT_KEY, JSON.stringify(json.data.recent || []));
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(json.data.favorites || []));
    }
    return json?.data ?? null;
  } catch {
    return null;
  }
}
