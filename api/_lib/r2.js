import crypto from 'node:crypto';

const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || '').trim();
const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = (process.env.R2_BUCKET || '').trim();

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function assertR2Env() {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
        throw new Error('Missing Cloudflare R2 environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).');
    }
}

function sha256Hex(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

function hmac(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
}

function getSigningKey(secretKey, dateStamp, region = 'auto', service = 's3') {
    const kDate = hmac(`AWS4${secretKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    return hmac(kService, 'aws4_request');
}

function encodeRfc3986(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildCanonicalUri(key) {
    const encodedKey = key.split('/').map(encodeRfc3986).join('/');
    return `/${encodeRfc3986(R2_BUCKET)}/${encodedKey}`;
}

function getAmzDates(date = new Date()) {
    const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return {
        amzDate: iso,
        dateStamp: iso.slice(0, 8),
    };
}

function presignR2Url(method, key, expiresIn = 7200) {
    assertR2Env();
    const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const canonicalUri = buildCanonicalUri(key);
    const { amzDate, dateStamp } = getAmzDates();
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

    const params = [
        ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
        ['X-Amz-Credential', `${R2_ACCESS_KEY_ID}/${credentialScope}`],
        ['X-Amz-Date', amzDate],
        ['X-Amz-Expires', String(expiresIn)],
        ['X-Amz-SignedHeaders', 'host'],
    ].sort((a, b) => a[0].localeCompare(b[0]));

    const canonicalQuery = params
        .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
        .join('&');

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQuery,
        `host:${host}\n`,
        'host',
        'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = getSigningKey(R2_SECRET_ACCESS_KEY, dateStamp);
    const signature = hmac(signingKey, stringToSign).toString('hex');

    return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export async function createR2SignedReadUrls(keys, expiresIn = 7200) {
    if (!keys.length) return {};
    const entries = keys.map(key => [key, presignR2Url('GET', key, expiresIn)]);
    return Object.fromEntries(entries);
}

export async function createR2SignedUploadUrl(key, _contentType = 'image/jpeg', expiresIn = 900) {
    return {
        signedUrl: presignR2Url('PUT', key, expiresIn),
        path: key,
    };
}

export async function deleteR2Object(key) {
    if (!key) return;
    assertR2Env();
    const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const canonicalUri = buildCanonicalUri(key);
    const { amzDate, dateStamp } = getAmzDates();
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

    const canonicalHeaders = [
        `host:${host}`,
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        `x-amz-date:${amzDate}`,
        '',
    ].join('\n');
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
        'DELETE',
        canonicalUri,
        '',
        canonicalHeaders,
        signedHeaders,
        EMPTY_SHA256,
    ].join('\n');

    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = getSigningKey(R2_SECRET_ACCESS_KEY, dateStamp);
    const signature = hmac(signingKey, stringToSign).toString('hex');

    const res = await fetch(`https://${host}${canonicalUri}`, {
        method: 'DELETE',
        headers: {
            'x-amz-content-sha256': EMPTY_SHA256,
            'x-amz-date': amzDate,
            Authorization: `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
    });
    if (!res.ok && res.status !== 204 && res.status !== 404) {
        const text = await res.text();
        throw new Error(`R2 delete failed (${res.status}): ${text}`);
    }
}
