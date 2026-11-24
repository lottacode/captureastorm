import crypto from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const TOKEN_SECRET = process.env.GALLERY_TOKEN_SECRET || SERVICE_KEY;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

export function assertEnv() {
    if (!SUPABASE_URL || !SERVICE_KEY) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
    }
}

export function getPublicConfig() {
    return {
        supabaseUrl: SUPABASE_URL,
        supabasePublishableKey: PUBLISHABLE_KEY,
    };
}

export function hashPassword(password) {
    return crypto
        .createHash('sha256')
        .update('captureastorm:' + String(password || '').trim())
        .digest('hex');
}

export function signGalleryToken(galleryId) {
    const exp = Date.now() + 1000 * 60 * 60 * 4; // 4 hours
    const payload = Buffer.from(JSON.stringify({ gid: galleryId, exp })).toString('base64url');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

export function verifyGalleryToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return null;
    }
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!parsed.gid || !parsed.exp || Date.now() > parsed.exp) return null;
        return parsed.gid;
    } catch {
        return null;
    }
}

function serviceHeaders(extra = {}) {
    const headers = {
        apikey: SERVICE_KEY,
        ...extra,
    };
    // Legacy service_role JWTs require Authorization: Bearer, whereas sb_secret_ keys are NOT JWTs
    // and must only be sent in the apikey header.
    if (!SERVICE_KEY.startsWith('sb_secret_')) {
        headers.Authorization = `Bearer ${SERVICE_KEY}`;
    }
    return headers;
}

export async function supabaseRest(path, { method = 'GET', body, headers = {} } = {}) {
    assertEnv();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: serviceHeaders({
            'Content-Type': 'application/json',
            ...headers,
        }),
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) {
        const msg = (json && json.message) || text || `Supabase REST error ${res.status}`;
        throw new Error(msg);
    }
    return json;
}

export async function supabaseRestAll(path) {
    const pageSize = 1000;
    const all = [];
    let offset = 0;
    const sep = path.includes('?') ? '&' : '?';

    while (true) {
        const page = await supabaseRest(`${path}${sep}limit=${pageSize}&offset=${offset}`);
        if (!Array.isArray(page) || page.length === 0) break;
        all.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
    }
    return all;
}

export async function createSignedReadUrls(storagePaths, expiresIn = 7200) {
    assertEnv();
    if (!storagePaths.length) return {};
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/client-proofs`, {
        method: 'POST',
        headers: serviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn, paths: storagePaths }),
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error((data && data.message) || 'Failed to sign storage URLs');
    }
    const map = {};
    for (const item of data) {
        if (item.path && item.signedURL) {
            const signed = item.signedURL.startsWith('http')
                ? item.signedURL
                : `${SUPABASE_URL}/storage/v1${item.signedURL}`;
            map[item.path] = signed;
        }
    }
    return map;
}

export async function createSignedUploadUrl(storagePath) {
    assertEnv();
    const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/client-proofs/${encodedPath}`, {
        method: 'POST',
        headers: serviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error((data && data.message) || 'Failed to create signed upload URL');
    }
    const rawUrl = data.url || '';
    const fullUrl = rawUrl.startsWith('http') ? rawUrl : `${SUPABASE_URL}/storage/v1${rawUrl}`;
    return { signedUrl: fullUrl, token: data.token, path: storagePath };
}

export async function deleteStorageFile(storagePath) {
    assertEnv();
    if (!storagePath) return;
    const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
    await fetch(`${SUPABASE_URL}/storage/v1/object/client-proofs/${encodedPath}`, {
        method: 'DELETE',
        headers: serviceHeaders(),
    });
}

export async function verifyAdminUser(authHeader) {
    assertEnv();
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const jwt = authHeader.slice(7).trim();
    if (!jwt) return null;

    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${jwt}`,
        },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !user.email) return null;
    if (ADMIN_EMAIL && user.email.toLowerCase() !== ADMIN_EMAIL) {
        return null;
    }
    return user;
}
