// src/lib/api-client.ts
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? { code: "UNKNOWN", message: "요청이 실패했습니다." };
    throw new ApiError(res.status, err.code, err.message);
  }
  return body as T;
}
