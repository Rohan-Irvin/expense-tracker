const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// File upload helper (doesn't set Content-Type — let browser set multipart boundary)
async function uploadFile<T>(path: string, file: File, extraFields?: Record<string, string>): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  if (extraFields) {
    Object.entries(extraFields).forEach(([k, v]) => form.append(k, v));
  }
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// Categories
export const categories = {
  list: () => request<any[]>('/categories'),
  create: (data: { name: string; parent_id?: number }) => request<any>('/categories', { method: 'POST', body: JSON.stringify(data) }),
  rename: (id: number, name: string) => request<any>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  delete: (id: number) => request<void>(`/categories/${id}`, { method: 'DELETE' }),
};

// Accounts
export const accounts = {
  list: () => request<any[]>('/accounts'),
  create: (data: { name: string; currency: string }) => request<any>('/accounts', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { name: string }) => request<any>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/accounts/${id}`, { method: 'DELETE' }),
};

// Settings
export const settings = {
  get: () => request<any>('/settings'),
  update: (data: Record<string, string>) => request<any>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  testLlm: () => request<{ ok: boolean; model?: string; error?: string }>('/settings/test-llm', { method: 'POST' }),
};

// Import
export const importApi = {
  parse: (file: File, accountId: number) => uploadFile<any>('/import/parse', file, { accountId: String(accountId) }),
  confirm: (file: File, accountId: number, filename: string, columnMap: any, currency: string) =>
    uploadFile<any>('/import/confirm', file, { accountId: String(accountId), filename, columnMap: JSON.stringify(columnMap), currency }),
  review: (batchId: number) => request<any>(`/import/${batchId}/review`),
  finalize: (batchId: number) => request<any>(`/import/${batchId}/finalize`, { method: 'POST' }),
  pendingBatches: () => request<any[]>('/import/batches/pending'),
  deleteBatch: (batchId: number) => request<any>(`/import/${batchId}`, { method: 'DELETE' }),
};

// Expenses
export const expenses = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/expenses${qs}`);
  },
  approve: (id: number, data: { category_id: number; subcategory_id?: number }) =>
    request<any>(`/expenses/${id}/approve`, { method: 'PATCH', body: JSON.stringify(data) }),
  skip: (id: number) => request<any>(`/expenses/${id}/skip`, { method: 'PATCH' }),
  split: (id: number, rows: any[]) => request<any>(`/expenses/${id}/split`, { method: 'POST', body: JSON.stringify(rows) }),
  unsplit: (id: number) => request<any>(`/expenses/${id}/unsplit`, { method: 'DELETE' }),
  update: (id: number, data: { date?: string; description?: string; category_id?: number | null; subcategory_id?: number | null }) =>
    request<any>(`/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  updateCategory: (id: number, data: { category_id: number | null; subcategory_id?: number | null }) =>
    request<any>(`/expenses/${id}/category`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/expenses/${id}`, { method: 'DELETE' }),
};

// Income
export const income = {
  list: () => request<any[]>('/income'),
  create: (data: any) => request<any>('/income', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) => request<any>(`/income/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/income/${id}`, { method: 'DELETE' }),
  parse: (file: File) => uploadFile<any>('/income/parse', file),
  confirm: (file: File, columnMap: any, currency: string, dateFormat: string) =>
    uploadFile<any>('/income/confirm', file, { columnMap: JSON.stringify(columnMap), currency, dateFormat }),
};

// Dashboard
export const dashboard = {
  summary: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<any>(`/dashboard/summary?${params.toString()}`);
  },
  trends: (from: string, to: string, categoryIds?: number[]) => {
    const params = new URLSearchParams();
    params.set('from', from);
    params.set('to', to);
    if (categoryIds && categoryIds.length > 0) params.set('category_ids', categoryIds.join(','));
    return request<any>(`/dashboard/trends?${params.toString()}`);
  },
};

// Amazon
export const amazon = {
  import: (file: File) => uploadFile<any>('/amazon/import', file),
  match: () => request<any[]>('/amazon/match', { method: 'POST' }),
  orders: () => request<any[]>('/amazon/orders'),
  confirmMatch: (orderId: number, expenseId: number) =>
    request<any>(`/amazon/orders/${orderId}/confirm-match`, { method: 'PATCH', body: JSON.stringify({ expense_id: expenseId }) }),
  unmatch: (orderId: number) =>
    request<any>(`/amazon/orders/${orderId}/unmatch`, { method: 'PATCH' }),
};

// Merchant Rules
export const merchantRules = {
  list: () => request<any[]>('/merchant-rules'),
  update: (id: number, data: { category_id: number; subcategory_id?: number }) =>
    request<any>(`/merchant-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/merchant-rules/${id}`, { method: 'DELETE' }),
};
