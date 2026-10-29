/**
 * Backblaze B2 through its S3-compatible API (AWS Signature V4).
 * Required Worker bindings:
 *   B2_KEY_ID          - standard Backblaze application key ID
 *   B2_APPLICATION_KEY - standard Backblaze application key secret
 *   B2_BUCKET          - actual bucket NAME (not its ID)
 * Optional:
 *   B2_ENDPOINT         - e.g. s3.us-east-005.backblazeb2.com
 *   B2_REGION           - e.g. us-east-005
 *
 * Backblaze's Master Application Key cannot authenticate to the S3-compatible
 * API. Create a standard application key scoped to the target bucket instead.
 */

const textEncoder = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(data) {
  const bytes = typeof data === 'string' ? textEncoder.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmac(key, data) {
  const raw = typeof key === 'string' ? textEncoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(data)));
}

function amzDate(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function encodePath(path) {
  return String(path).split('/').map(awsEncode).join('/');
}

function canonicalQuery(params) {
  const entries = params instanceof URLSearchParams ? [...params.entries()] : [...new URLSearchParams(params || '').entries()];
  return entries
    .map(([k, v]) => [awsEncode(k), awsEncode(v)])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function b2Config(env) {
  const keyId = String(env.B2_KEY_ID || '').trim();
  const appKey = String(env.B2_APPLICATION_KEY || '').trim();
  const bucket = String(env.B2_BUCKET || env.B2_BUCKET_NAME || '').trim();
  const endpoint = String(env.B2_ENDPOINT || 's3.us-east-005.backblazeb2.com')
    .trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const regionFromEndpoint = endpoint.match(/^s3\.([^.]+)\.backblazeb2\.com$/i)?.[1];
  const region = String(env.B2_REGION || regionFromEndpoint || 'us-east-005').trim();
  const bucketLooksLikePlaceholder = !bucket || bucket === '-' || /replace|your[-_ ]?bucket|bucket[-_ ]?name/i.test(bucket);
  return {
    configured: Boolean(keyId && appKey && !bucketLooksLikePlaceholder && endpoint && region),
    bucket,
    endpoint,
    region,
    keyId,
    appKey,
  };
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

async function signRequest({ method, host, path, query = '', headers = {}, body = '', env }) {
  const cfg = b2Config(env);
  const amz = amzDate();
  const date = amz.slice(0, 8);
  const payloadHash = await sha256(body == null ? '' : body);
  const allHeaders = {
    host,
    ...headers,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
  };
  const normalized = new Map();
  for (const [name, value] of Object.entries(allHeaders)) {
    normalized.set(name.toLowerCase(), normalizeHeaderValue(value));
  }
  const signedHeaderKeys = [...normalized.keys()].sort();
  const canonicalHeaders = signedHeaderKeys.map((name) => `${name}:${normalized.get(name)}\n`).join('');
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${date}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    credentialScope,
    await sha256(canonicalRequest),
  ].join('\n');
  const kDate = await hmac(`AWS4${cfg.appKey}`, date);
  const kRegion = await hmac(kDate, cfg.region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${cfg.keyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amz,
    payloadHash,
  };
}

async function s3Fetch(env, { method, objectKey, body, contentType, params }) {
  const cfg = b2Config(env);
  if (!cfg.configured) {
    throw new Error('B2 not configured: set B2_KEY_ID, B2_APPLICATION_KEY and the actual B2_BUCKET name. Use a standard (non-Master) application key.');
  }
  const host = cfg.endpoint;
  const path = objectKey == null
    ? `/${awsEncode(cfg.bucket)}`
    : `/${awsEncode(cfg.bucket)}/${encodePath(String(objectKey).replace(/^\/+/, ''))}`;
  const query = params ? canonicalQuery(params) : '';
  const headers = {};
  if (contentType) headers['content-type'] = contentType;
  // Do not sign Content-Length: Workers may set it internally and this code
  // intentionally does not try to set a forbidden/managed request header.
  const signed = await signRequest({ method, host, path, query, headers, body: body ?? '', env });
  const url = `https://${host}${path}${query ? `?${query}` : ''}`;
  const responseHeaders = {
    Authorization: signed.authorization,
    'x-amz-content-sha256': signed.payloadHash,
    'x-amz-date': signed.amz,
  };
  if (contentType) responseHeaders['Content-Type'] = contentType;
  const res = await fetch(url, {
    method,
    headers: responseHeaders,
    body: ['GET', 'HEAD', 'DELETE'].includes(method.toUpperCase()) ? undefined : (body ?? ''),
  });
  return res;
}

async function errorText(res, operation) {
  const body = await res.text().catch(() => '');
  return `${operation} ${res.status}: ${body.slice(0, 300) || res.statusText || 'request failed'}`;
}

export async function b2Put(env, key, body, contentType = 'application/octet-stream') {
  const payload = typeof body === 'string' ? body : body;
  const res = await s3Fetch(env, {
    method: 'PUT', objectKey: key.replace(/^\/+/, ''), body: payload, contentType,
  });
  if (!res.ok) throw new Error(await errorText(res, 'B2 PUT'));
  const size = typeof payload === 'string' ? textEncoder.encode(payload).byteLength : payload.byteLength;
  return { ok: true, key, size };
}

export async function b2Get(env, key) {
  const res = await s3Fetch(env, { method: 'GET', objectKey: key.replace(/^\/+/, '') });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await errorText(res, 'B2 GET'));
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('lua') || contentType.includes('javascript') || contentType.includes('xml')) {
    return { body: await res.text(), contentType, binary: false };
  }
  return { body: await res.arrayBuffer(), contentType, binary: true };
}

export async function b2GetText(env, key) {
  const res = await s3Fetch(env, { method: 'GET', objectKey: key.replace(/^\/+/, '') });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await errorText(res, 'B2 GET'));
  return await res.text();
}

export async function b2Delete(env, key) {
  const res = await s3Fetch(env, { method: 'DELETE', objectKey: key.replace(/^\/+/, '') });
  if (!res.ok && res.status !== 404) throw new Error(await errorText(res, 'B2 DELETE'));
  return { ok: true };
}

export async function b2List(env, prefix = '', delimiter = '/') {
  const cfg = b2Config(env);
  if (!cfg.configured) {
    throw new Error('B2 not configured: set B2_KEY_ID, B2_APPLICATION_KEY and the actual B2_BUCKET name.');
  }
  const files = [];
  const folders = new Set();
  let continuationToken = '';
  let pageCount = 0;

  do {
    const params = new URLSearchParams();
    params.set('list-type', '2');
    params.set('max-keys', '1000');
    if (prefix) params.set('prefix', prefix);
    if (delimiter) params.set('delimiter', delimiter);
    if (continuationToken) params.set('continuation-token', continuationToken);

    const res = await s3Fetch(env, { method: 'GET', objectKey: null, params });
    if (!res.ok) throw new Error(await errorText(res, 'B2 LIST'));
    const xml = await res.text();

    for (const blockMatch of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = blockMatch[1];
      const key = decodeXml(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || '');
      if (!key) continue;
      const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] || 0);
      const updated = decodeXml(block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || '');
      files.push({ path: key, size, updated_at: updated || null });
    }
    for (const match of xml.matchAll(/<CommonPrefixes>\s*<Prefix>([\s\S]*?)<\/Prefix>\s*<\/CommonPrefixes>/g)) {
      const folder = decodeXml(match[1]).replace(/\/$/, '');
      if (folder && folder !== prefix) folders.add(folder);
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
    continuationToken = decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || '');
    pageCount += 1;
    if (truncated && !continuationToken) {
      throw new Error('B2 LIST returned IsTruncated=true without NextContinuationToken.');
    }
    if (pageCount > 1000) throw new Error('B2 LIST stopped after 1000 pages to prevent an unbounded request.');
  } while (continuationToken);

  return { files, folders: [...folders] };
}

export function contentTypeForPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    lua: 'text/x-lua', luau: 'text/x-lua', md: 'text/markdown', json: 'application/json', txt: 'text/plain',
    css: 'text/css', js: 'application/javascript', html: 'text/html', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
    pdf: 'application/pdf', zip: 'application/zip', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  };
  return map[ext] || 'application/octet-stream';
}

export function isBinaryPath(path) {
  return /\.(png|jpe?g|gif|webp|bmp|ico|mp3|ogg|wav|flac|m4a|aac|mp4|webm|mov|avi|mkv|pdf|zip|rar|7z|tar|gz|exe|dll|so|bin|rbxm|rbxmx|rbxl|rbxlx|mesh|anim|obj|fbx|blend|ttf|otf|woff2?)$/i.test(path);
}
