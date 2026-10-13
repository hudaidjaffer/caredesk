// Small fetch wrapper for the JSON API. Cookies (HttpOnly) carry the session.
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function parse(res) {
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  return data;
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check that it is running and you are online.', 0);
  }
  return parse(res);
}

// Raw file upload (photos, spreadsheets). The custom header proves the request came from this app.
export async function uploadFile(path, blob) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-CareDesk-Upload': '1' },
      body: blob,
    });
  } catch {
    throw new ApiError('Upload failed. Check your connection.', 0);
  }
  return parse(res);
}

export const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};
