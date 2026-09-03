import type { AuthResult, RgsClient, Round } from './types';

export interface HttpRgsConfig {
  baseUrl: string;
  sessionToken?: string;
}

export function createHttpRgs(config: HttpRgsConfig): RgsClient {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.sessionToken) headers.Authorization = `Bearer ${config.sessionToken}`;

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`RGS ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  };

  return {
    authenticate(): Promise<AuthResult> {
      return post<AuthResult>('/authenticate', {});
    },
    play(bet: number): Promise<Round> {
      return post<Round>('/play', { bet });
    },
  };
}
