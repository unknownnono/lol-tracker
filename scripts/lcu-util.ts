// 스크립트용 LCU 접속 도우미 (127.0.0.1, 롤 클라이언트 자체 서명 인증서). 토큰은 출력하지 않습니다.
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { parseLcuCredentials } from '@/lib/aram/lcu';

export interface LcuCreds { port: number; token: string }

export function readLcuCredentials(): LcuCreds {
  const cmd = execFileSync('powershell', [
    '-NoProfile', '-Command',
    "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine",
  ]).toString();
  const creds = parseLcuCredentials(cmd);
  if (!creds) throw new Error('롤 클라이언트가 실행 중이 아닙니다.');
  return creds;
}

const agent = new https.Agent({ rejectUnauthorized: false }); // LCU 전용 (127.0.0.1)

export function lcuGet<T>(creds: LcuCreds, path: string): Promise<T> {
  const auth = 'Basic ' + Buffer.from(`riot:${creds.token}`).toString('base64');
  return new Promise((resolve, reject) => {
    https
      .get({ host: '127.0.0.1', port: creds.port, path, agent, headers: { Authorization: auth } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`LCU ${res.statusCode} ${path.split('?')[0]}`));
          resolve(JSON.parse(body) as T);
        });
      })
      .on('error', reject);
  });
}
