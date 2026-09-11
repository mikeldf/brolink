const VERCEL = Deno.env.get('VERCEL_SITE_URL') || 'https://brolink.vercel.app';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://ufcycbsrpnfrjeculmtd.supabase.co';
const SUPABASE_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || 'sb_publishable_EGDpH9JqVOFRgpM_p3UnLA_MT8TfhoX';
const EXTRA_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOWED = new Set([VERCEL, ...EXTRA_ORIGINS]);

function cors(origin: string | null) {
  const allowedOrigin = origin && ALLOWED.has(origin) ? origin : VERCEL;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-file-name,x-file-mime,x-file-size,x-file-extension,x-upload-key,x-upload-id,x-part-number',
    'Access-Control-Expose-Headers': 'etag,content-type,content-disposition,content-length',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
}

async function verifyUser(auth: string) {
  if (!auth.startsWith('Bearer ')) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_KEY },
  });
  return response.ok;
}

function errorText(value: unknown, fallback: string) {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'details', 'hint', 'code']) {
      if (object[key] !== undefined && object[key] !== value) {
        const text = errorText(object[key], '');
        if (text) return text;
      }
    }
    try {
      const text = JSON.stringify(value);
      if (text && text !== '{}') return text;
    } catch {}
  }
  return fallback;
}

async function api(path: string, auth: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', auth);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(VERCEL + path, { ...init, headers });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    throw new Error(errorText(data.error ?? data.message ?? data, `BroLink respondió ${response.status}`));
  }
  return data;
}

async function proxyJson(path: string, auth: string, request: Request, headers: Record<string, string>) {
  const body = await request.text();
  const data = await api(path, auth, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
  return Response.json(data, { status: 200, headers });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') {
    return Response.json({ error: 'Método no permitido' }, { status: 405, headers });
  }

  const auth = request.headers.get('authorization') || '';
  if (!(await verifyUser(auth))) {
    return Response.json({ error: 'Sesión no válida o caducada' }, { status: 401, headers });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'small';

  try {
    if (action === 'health') {
      return Response.json(await api('/api/drime/health', auth, { method: 'GET' }), { status: 200, headers });
    }
    if (action === 'space') {
      return Response.json(await api('/api/drime/space', auth, { method: 'GET' }), { status: 200, headers });
    }
    if (action === 'create') return proxyJson('/api/drime/multipart/create', auth, request, headers);
    if (action === 'complete') return proxyJson('/api/drime/multipart/complete', auth, request, headers);
    if (action === 'register') return proxyJson('/api/drime/register', auth, request, headers);
    if (action === 'delete') return proxyJson('/api/drime/delete', auth, request, headers);

    if (action === 'download') {
      const hash = url.searchParams.get('hash') || '';
      if (!hash) return Response.json({ error: 'Falta el identificador del archivo' }, { status: 400, headers });
      const response = await fetch(`${VERCEL}/api/drime/download/${encodeURIComponent(hash)}`, {
        headers: { Authorization: auth },
      });
      if (!response.ok) {
        const text = await response.text();
        return Response.json({ error: text || `No se pudo descargar (${response.status})` }, { status: response.status, headers });
      }
      const outputHeaders = new Headers(headers);
      for (const name of ['content-type', 'content-disposition', 'content-length']) {
        const value = response.headers.get(name);
        if (value) outputHeaders.set(name, value);
      }
      return new Response(response.body, { status: 200, headers: outputHeaders });
    }

    if (action === 'small') {
      const filename = decodeURIComponent(request.headers.get('x-file-name') || '');
      const mime = request.headers.get('x-file-mime') || 'application/octet-stream';
      const size = Number(request.headers.get('x-file-size') || 0);
      const extension = request.headers.get('x-file-extension') || '';
      if (!filename || !Number.isFinite(size) || size < 0 || size >= 5 * 1024 * 1024) {
        return Response.json({ error: 'Datos del archivo no válidos' }, { status: 400, headers });
      }
      const signed = await api('/api/drime/presign', auth, {
        method: 'POST',
        body: JSON.stringify({ filename, mime, size, extension }),
      });
      if (!signed?.url || !signed?.key) throw new Error('Drime no devolvió los datos necesarios para subir el archivo.');
      const uploaded = await fetch(signed.url, { method: 'PUT', body: request.body });
      if (!uploaded.ok) throw new Error(`Drime rechazó la subida (${uploaded.status})`);
      const registered = await api('/api/drime/register', auth, {
        method: 'POST',
        body: JSON.stringify({
          key: signed.key,
          size,
          clientName: filename,
          clientMime: mime,
          clientExtension: extension,
        }),
      });
      return Response.json(registered, { status: 200, headers });
    }

    if (action === 'part') {
      const key = decodeURIComponent(request.headers.get('x-upload-key') || '');
      const uploadId = request.headers.get('x-upload-id') || '';
      const partNumber = Number(request.headers.get('x-part-number') || 0);
      if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
        return Response.json({ error: 'Datos de parte no válidos' }, { status: 400, headers });
      }
      const signed = await api('/api/drime/multipart/sign', auth, {
        method: 'POST',
        body: JSON.stringify({ key, uploadId, partNumbers: [partNumber] }),
      });
      const row = Array.isArray(signed.urls)
        ? signed.urls.find((entry: any) => Number(entry.partNumber) === partNumber)
        : null;
      if (!row?.url) throw new Error('Drime no devolvió URL para la parte');
      const uploaded = await fetch(row.url, { method: 'PUT', body: request.body });
      if (!uploaded.ok) throw new Error(`Falló la parte ${partNumber} (${uploaded.status})`);
      const etag = uploaded.headers.get('etag');
      if (!etag) throw new Error(`Drime no devolvió ETag para la parte ${partNumber}`);
      const outputHeaders = new Headers(headers);
      outputHeaders.set('etag', etag);
      return new Response(null, { status: 200, headers: outputHeaders });
    }

    return Response.json({ error: 'Acción no encontrada' }, { status: 404, headers });
  } catch (error) {
    console.error('drime-upload', error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502, headers },
    );
  }
});

