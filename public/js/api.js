// Cliente da API
export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || 'Não foi possível concluir. Tente novamente.');
    this.status = status;
    this.data = data || {};
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: 'Sem conexão com a internet.' });
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== '/api/login') onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

api.get = (p) => api(p);
api.post = (p, body) => api(p, { method: 'POST', body: body || {} });
api.put = (p, body) => api(p, { method: 'PUT', body });
api.patch = (p, body) => api(p, { method: 'PATCH', body });
api.del = (p) => api(p, { method: 'DELETE' });
