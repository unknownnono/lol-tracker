// 테스트용 메모리 Redis. 이 프로젝트가 쓰는 명령만 Upstash REST와 같은 반환 형식으로 흉내 냅니다.
import type { Cmd, RedisLike } from '@/lib/aram/redis';

export class FakeRedis implements RedisLike {
  strings = new Map<string, string>();
  lists = new Map<string, string[]>();
  sets = new Map<string, Set<string>>();
  zsets = new Map<string, Map<string, number>>();
  log: Cmd[] = [];

  async cmd<T = unknown>(args: Cmd): Promise<T> {
    this.log.push(args);
    return this.exec(args) as T;
  }

  async pipe(cmds: Cmd[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const c of cmds) out.push(await this.cmd(c));
    return out;
  }

  private list(key: string) {
    const l = this.lists.get(key) ?? [];
    this.lists.set(key, l);
    return l;
  }

  private exec(args: Cmd): unknown {
    const [op, ...rest] = args.map(String);
    switch (op.toUpperCase()) {
      case 'GET':
        return this.strings.get(rest[0]) ?? null;
      case 'SET': {
        const [key, value, ...opts] = rest;
        if (opts.map((o) => o.toUpperCase()).includes('NX') && this.strings.has(key)) return null;
        this.strings.set(key, value);
        return 'OK';
      }
      case 'DEL': {
        let n = 0;
        for (const k of rest) {
          const hit = [this.strings, this.lists, this.sets, this.zsets].some((m) => m.delete(k));
          if (hit) n++;
        }
        return n;
      }
      case 'MGET':
        return rest.map((k) => this.strings.get(k) ?? null);
      case 'MSET':
        for (let i = 0; i < rest.length; i += 2) this.strings.set(rest[i], rest[i + 1]);
        return 'OK';
      case 'INCR':
      case 'INCRBY':
      case 'DECRBY': {
        const sign = op.toUpperCase() === 'DECRBY' ? -1 : 1;
        const by = op.toUpperCase() === 'INCR' ? 1 : Number(rest[1]);
        const v = Number(this.strings.get(rest[0]) ?? 0) + sign * by;
        this.strings.set(rest[0], String(v));
        return v;
      }
      case 'EXPIRE':
        return 1;
      case 'LPOP': {
        const l = this.lists.get(rest[0]);
        return l && l.length > 0 ? l.shift()! : null;
      }
      case 'LPUSH': {
        const l = this.list(rest[0]);
        l.unshift(...rest.slice(1).reverse());
        return l.length;
      }
      case 'RPUSH': {
        const l = this.list(rest[0]);
        l.push(...rest.slice(1));
        return l.length;
      }
      case 'LTRIM': {
        const l = this.list(rest[0]);
        const start = Number(rest[1]);
        const stop = Number(rest[2]);
        this.lists.set(rest[0], l.slice(start, stop === -1 ? undefined : stop + 1));
        return 'OK';
      }
      case 'LLEN':
        return this.lists.get(rest[0])?.length ?? 0;
      case 'SADD': {
        const s = this.sets.get(rest[0]) ?? new Set<string>();
        this.sets.set(rest[0], s);
        let added = 0;
        for (const m of rest.slice(1)) {
          if (!s.has(m)) {
            s.add(m);
            added++;
          }
        }
        return added;
      }
      case 'SMISMEMBER': {
        const s = this.sets.get(rest[0]);
        return rest.slice(1).map((m) => (s?.has(m) ? 1 : 0));
      }
      case 'ZADD': {
        const z = this.zsets.get(rest[0]) ?? new Map<string, number>();
        this.zsets.set(rest[0], z);
        for (let i = 1; i < rest.length; i += 2) z.set(rest[i + 1], Number(rest[i]));
        return 1;
      }
      case 'ZREVRANGE': {
        const z = this.zsets.get(rest[0]) ?? new Map<string, number>();
        const sorted = [...z.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
        return sorted.slice(Number(rest[1]), Number(rest[2]) + 1);
      }
      default:
        throw new Error(`FakeRedis: 지원하지 않는 명령 ${op}`);
    }
  }
}
