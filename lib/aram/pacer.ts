// 로컬 수집 스크립트용 Riot API 요청 간격 조절 (Redis 없이 프로세스 안에서만).
// 개인 키 한도(초당 20, 2분당 100)보다 낮게 잡아 전적 검색 사이트가 쓸 몫을 남깁니다.
export class Pacer {
  private sent: number[] = [];

  constructor(
    private perTwoMin = 70,
    private perSec = 10,
  ) {}

  // 지금 보내도 되면 0, 아니면 기다려야 할 ms
  waitMs(now: number): number {
    this.sent = this.sent.filter((t) => now - t < 120_000);
    const lastSec = this.sent.filter((t) => now - t < 1000);
    if (this.sent.length >= this.perTwoMin) return this.sent[0] + 120_000 - now;
    if (lastSec.length >= this.perSec) return lastSec[0] + 1000 - now;
    return 0;
  }

  record(now: number): void {
    this.sent.push(now);
  }
}
