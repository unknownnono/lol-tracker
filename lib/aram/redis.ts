// 통계 기능이 쓰는 Redis 접근 인터페이스. 테스트에서는 FakeRedis로 바꿔 끼웁니다.
import { kvCommand, kvPipeline } from '@/lib/kv';

export type Cmd = (string | number)[];

export interface RedisLike {
  cmd<T = unknown>(args: Cmd): Promise<T>;
  pipe(cmds: Cmd[]): Promise<unknown[]>;
}

export const upstash: RedisLike = {
  cmd: kvCommand,
  pipe: kvPipeline,
};
