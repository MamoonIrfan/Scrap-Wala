const ACCESS_KEY = 'scrapwala_access_token';
const REFRESH_KEY = 'scrapwala_refresh_token';

export function getStoredTokens(): { accessToken: string | null; refreshToken: string | null } {
  return {
    accessToken: localStorage.getItem(ACCESS_KEY),
    refreshToken: localStorage.getItem(REFRESH_KEY),
  };
}

export function setStoredTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearStoredTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

async function attemptRefresh(): Promise<string | null> {
  const { refreshToken } = getStoredTokens();
  if (!refreshToken) return null;

  try {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearStoredTokens();
      return null;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    setStoredTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

export async function apiFetch<T = Record<string, unknown>>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    formData?: FormData;
    skipAuth?: boolean;
  } = {}
): Promise<T> {
  const { accessToken } = getStoredTokens();
  const headers: Record<string, string> = {};
  if (!options.formData && options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options.skipAuth && accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.formData
      ? options.formData
      : options.body !== undefined
      ? JSON.stringify(options.body)
      : undefined,
  });

  if (res.status === 401 && !options.skipAuth) {
    const newAccess = await attemptRefresh();
    if (newAccess) {
      headers['Authorization'] = `Bearer ${newAccess}`;
      res = await fetch(path, {
        method: options.method || 'GET',
        headers,
        body: options.formData
          ? options.formData
          : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
      });
    }
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/csv')) {
    const text = await res.text();
    if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
    return text as unknown as T;
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { error: text };
  }

  if (!res.ok) {
    throw new Error(String(json.error || `Request failed with status ${res.status}`));
  }

  return json as T;
}

export function getPrivateMediaUrl(apiUrl: string): string {
  const { accessToken } = getStoredTokens();
  if (!accessToken) return apiUrl;
  const sep = apiUrl.includes('?') ? '&' : '?';
  return `${apiUrl}${sep}access_token=${encodeURIComponent(accessToken)}`;
}
