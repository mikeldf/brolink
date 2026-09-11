const { Readable } = require('node:stream');

const DRIME_BASE = 'https://app.drime.cloud/api/v1';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ufcycbsrpnfrjeculmtd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_EGDpH9JqVOFRgpM_p3UnLA_MT8TfhoX';
const TIMEOUT = 20000;

function errorText(value, fallback = 'No se pudo comunicar con Drime.') {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === 'object') {
    for (const key of ['message', 'error', 'details', 'hint', 'code']) {
      if (value[key] !== undefined && value[key] !== value) {
        const text = errorText(value[key], '');
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

function workspaceId() {
  const n = Number(process.env.DRIME_WORKSPACE_ID || 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function jsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

async function verify(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    const e = new Error('Sesión requerida'); e.status = 401; throw e;
  }
  const token = auth.slice(7);
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
    signal: AbortSignal.timeout(TIMEOUT)
  });
  if (!r.ok) { const e = new Error('Sesión no válida o caducada'); e.status = 401; throw e; }
  return r.json();
}

function drimeHeaders(json = false) {
  if (!process.env.DRIME_ACCESS_TOKEN) {
    const e = new Error('Drime no está configurado'); e.status = 503; throw e;
  }
  return {
    Authorization: `Bearer ${process.env.DRIME_ACCESS_TOKEN}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

async function parseDrime(r) {
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!r.ok) {
    const e = new Error(errorText(data.message ?? data.error ?? data, `Drime respondió con ${r.status}`));
    e.status = r.status; e.details = data; throw e;
  }
  return data;
}

async function drime(path, options = {}) {
  const r = await fetch(`${DRIME_BASE}${path}`, {
    ...options,
    headers: { ...drimeHeaders(Boolean(options.body)), ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(TIMEOUT)
  });
  return parseDrime(r);
}

function fail(res, error) {
  const status = Number(error.status) || 502;
  if (status >= 500) console.error('BroLink Drime API:', error);
  const message = status === 401 ? errorText(error, 'Sesión requerida')
    : status === 403 ? 'Drime no permite esta operación.'
    : status === 429 ? 'Drime está limitando temporalmente las peticiones. Inténtalo de nuevo en unos segundos.'
    : errorText(error);
  return res.status(status >= 400 && status < 600 ? status : 502).json({ error: message });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    await verify(req);
    const action = String(req.query.action || '');
    const body = jsonBody(req);

    if (action === 'health' && req.method === 'GET') {
      const [loggedUser, space] = await Promise.all([
        drime('/cli/loggedUser'),
        drime(`/user/space-usage?workspaceId=${workspaceId()}`)
      ]);
      return res.status(200).json({
        ok: true,
        provider: 'Drime',
        workspaceId: workspaceId(),
        account: loggedUser?.user?.email || loggedUser?.email || null,
        used: Number(space.used || 0),
        available: Number(space.available || 0)
      });
    }

    if (action === 'space' && req.method === 'GET') {
      return res.status(200).json(await drime(`/user/space-usage?workspaceId=${workspaceId()}`));
    }

    if (action === 'list' && req.method === 'GET') {
      const perPage = Math.min(100, Math.max(1, Number(req.query.perPage || 50)));
      const page = Math.max(1, Number(req.query.page || 1));
      const params = new URLSearchParams({workspaceId:String(workspaceId()),perPage:String(perPage),page:String(page),orderBy:'created_at',orderDir:'desc'});
      return res.status(200).json(await drime(`/drive/file-entries?${params}`));
    }

    if (action === 'presign' && req.method === 'POST') {
      const { filename, mime, size, extension, parentId = null, relativePath } = body;
      if (!filename || !Number.isFinite(Number(size)) || Number(size) < 0) return res.status(400).json({error:'Faltan datos del archivo'});
      if (Number(size) >= 5*1024*1024) return res.status(400).json({error:'Los archivos de 5 MB o más deben usar subida multipart.'});
      const payload = {filename,mime:mime||'application/octet-stream',size:Number(size),extension:extension||'',workspaceId:workspaceId(),parentId,...(relativePath?{relativePath}:{})};
      return res.status(200).json(await drime('/s3/simple/presign',{method:'POST',body:JSON.stringify(payload)}));
    }

    if (action === 'create' && req.method === 'POST') {
      const { filename, mime, size, extension, parentId = null, relativePath } = body;
      if (!filename || !Number.isFinite(Number(size))) return res.status(400).json({error:'Faltan datos del archivo'});
      if (Number(size) < 5*1024*1024) return res.status(400).json({error:'Los archivos menores de 5 MB deben usar subida simple.'});
      const payload = {filename,mime:mime||'application/octet-stream',size:Number(size),extension:extension||'',workspaceId:workspaceId(),parentId,...(relativePath?{relativePath}:{})};
      return res.status(200).json(await drime('/s3/multipart/create',{method:'POST',body:JSON.stringify(payload)}));
    }

    if (action === 'sign' && req.method === 'POST') {
      const { key, uploadId, partNumbers } = body;
      if (!key || !uploadId || !Array.isArray(partNumbers) || !partNumbers.length) return res.status(400).json({error:'Datos multipart incompletos'});
      const nums = partNumbers.map(Number);
      if (nums.some(n=>!Number.isInteger(n)||n<1)) return res.status(400).json({error:'Los números de parte no son válidos'});
      return res.status(200).json(await drime('/s3/multipart/batch-sign-part-urls',{method:'POST',body:JSON.stringify({key,uploadId,partNumbers:nums})}));
    }

    if (action === 'complete' && req.method === 'POST') {
      const { key, uploadId, parts } = body;
      if (!key || !uploadId || !Array.isArray(parts) || !parts.length) return res.status(400).json({error:'Datos multipart incompletos'});
      const normalized = parts.map(p=>({PartNumber:Number(p.PartNumber),ETag:String(p.ETag||'')}));
      if (normalized.some(p=>!Number.isInteger(p.PartNumber)||p.PartNumber<1||!p.ETag)) return res.status(400).json({error:'Las partes multipart no son válidas'});
      return res.status(200).json(await drime('/s3/multipart/complete',{method:'POST',body:JSON.stringify({key,uploadId,parts:normalized})}));
    }

    if (action === 'register' && req.method === 'POST') {
      const { key, size, clientName, clientMime, clientExtension, parentId = null, relativePath } = body;
      if (!key || !clientName || !Number.isFinite(Number(size))) return res.status(400).json({error:'Faltan datos para registrar el archivo'});
      const payload = {filename:String(key).split('/').pop(),size:Number(size),clientName,clientMime:clientMime||'application/octet-stream',clientExtension:clientExtension||'',workspaceId:workspaceId(),parentId,...(relativePath?{relativePath}:{})};
      return res.status(200).json(await drime('/s3/entries',{method:'POST',body:JSON.stringify(payload)}));
    }

    if (action === 'delete' && req.method === 'POST') {
      const entryIds = (body.entryIds || []).map(Number).filter(Number.isFinite);
      if (!entryIds.length) return res.status(400).json({error:'No hay archivos para borrar'});
      return res.status(200).json(await drime('/file-entries/delete',{method:'POST',body:JSON.stringify({entryIds,deleteForever:true})}));
    }

    if (action === 'download' && req.method === 'GET') {
      const hash = encodeURIComponent(String(req.query.hash || ''));
      if (!hash) return res.status(400).json({error:'Falta el identificador del archivo'});
      const r = await fetch(`${DRIME_BASE}/file-entries/download/${hash}`, {headers:drimeHeaders(),signal:AbortSignal.timeout(60000)});
      if (!r.ok) { const e = new Error((await r.text()) || 'No se pudo descargar el archivo'); e.status=r.status; throw e; }
      for (const h of ['content-type','content-disposition','content-length']) { const v=r.headers.get(h); if(v) res.setHeader(h,v); }
      if (!r.body) return res.end();
      return Readable.fromWeb(r.body).pipe(res);
    }

    return res.status(404).json({error:'Ruta no encontrada'});
  } catch (error) {
    return fail(res, error);
  }
};
