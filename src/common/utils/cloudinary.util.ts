import { createHash } from 'node:crypto';

/**
 * Photo uploads go straight from the app to Cloudinary. The backend only hands out short-lived SIGNED
 * upload permissions (so the API secret never leaves the server) and later checks that a photo link it
 * is given really belongs to our own Cloudinary account.
 *
 * Settings (backend .env): CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 */

export const UPLOAD_FOLDER = 'aslikaata/pickup-photos';
export const UPLOAD_ALLOWED_FORMATS = 'jpg,jpeg,png,webp,heic';
export const MAX_PICKUP_PHOTOS = 3;
export const MAX_PHOTO_MB = 5;

interface CloudinaryEnv {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function readEnv(): CloudinaryEnv | null {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

export function isCloudinaryConfigured(): boolean {
  return readEnv() !== null;
}

/** Everything the app needs to upload one image directly to Cloudinary (no secret included). */
export interface SignedUpload {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
}

/** Cloudinary signature: SHA-1 of the sorted "key=value" pairs joined by "&", followed by the API secret. */
export function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(toSign + apiSecret).digest('hex');
}

export function signPhotoUpload(now: number = Date.now()): SignedUpload | null {
  const env = readEnv();
  if (!env) return null;
  const timestamp = Math.floor(now / 1000);
  const params = { allowed_formats: UPLOAD_ALLOWED_FORMATS, folder: UPLOAD_FOLDER, timestamp };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudName}/image/upload`,
    apiKey: env.apiKey,
    timestamp,
    folder: UPLOAD_FOLDER,
    allowedFormats: UPLOAD_ALLOWED_FORMATS,
    signature: signParams(params, env.apiSecret),
  };
}

/**
 * True only for an https image link on OUR Cloudinary account. Without this check a customer could attach
 * any web address to a pickup and have the picker's phone open it.
 */
export function isTrustedPhotoUrl(url: unknown): url is string {
  const env = readEnv();
  if (!env || typeof url !== 'string' || url.length > 500) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'res.cloudinary.com' &&
      parsed.pathname.startsWith(`/${env.cloudName}/image/upload/`)
    );
  } catch {
    return false;
  }
}
