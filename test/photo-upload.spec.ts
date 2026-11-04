import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UPLOAD_ALLOWED_FORMATS,
  UPLOAD_FOLDER,
  isCloudinaryConfigured,
  isTrustedPhotoUrl,
  signParams,
  signPhotoUpload,
} from '../src/common/utils/cloudinary.util.js';
import { UploadsController } from '../src/modules/uploads/uploads.controller.js';
import { ServiceUnavailableException } from '@nestjs/common';

const KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.CLOUDINARY_CLOUD_NAME = 'democloud';
  process.env.CLOUDINARY_API_KEY = '123456789012345';
  process.env.CLOUDINARY_API_SECRET = 'topsecretvalue';
});
afterEach(() => {
  KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
});

describe('Cloudinary signed upload', () => {
  it('signs exactly the way Cloudinary documents (their published example)', () => {
    // From Cloudinary's "Generating authentication signatures" docs.
    const signature = signParams(
      { timestamp: 1315060510, public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' },
      'abcd',
    );
    expect(signature).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('hands the app a signed permission and never the secret', () => {
    const signed = signPhotoUpload(1_700_000_000_000)!;
    expect(signed).toMatchObject({
      uploadUrl: 'https://api.cloudinary.com/v1_1/democloud/image/upload',
      apiKey: '123456789012345',
      timestamp: 1_700_000_000,
      folder: UPLOAD_FOLDER,
      allowedFormats: UPLOAD_ALLOWED_FORMATS,
    });
    expect(signed.signature).toBe(
      signParams({ allowed_formats: UPLOAD_ALLOWED_FORMATS, folder: UPLOAD_FOLDER, timestamp: 1_700_000_000 }, 'topsecretvalue'),
    );
    expect(JSON.stringify(signed)).not.toContain('topsecretvalue');
  });

  it('reports not configured, and refuses to sign, when a key is missing', () => {
    delete process.env.CLOUDINARY_API_SECRET;
    expect(isCloudinaryConfigured()).toBe(false);
    expect(signPhotoUpload()).toBeNull();

    const controller = new UploadsController();
    expect(controller.config()).toMatchObject({ enabled: false });
    expect(() => controller.sign()).toThrow(ServiceUnavailableException);
  });

  it('the config endpoint tells the apps the limits', () => {
    expect(new UploadsController().config()).toEqual({ enabled: true, maxPhotos: 3, maxMb: 5 });
  });
});

describe('Only our own Cloudinary photos are accepted on a pickup', () => {
  it('accepts an image link from our account', () => {
    expect(isTrustedPhotoUrl('https://res.cloudinary.com/democloud/image/upload/v1/aslikaata/pickup-photos/a.jpg')).toBe(true);
  });

  it('rejects other accounts, other hosts, other schemes and junk', () => {
    expect(isTrustedPhotoUrl('https://res.cloudinary.com/someoneelse/image/upload/v1/a.jpg')).toBe(false);
    expect(isTrustedPhotoUrl('https://evil.example.com/democloud/image/upload/a.jpg')).toBe(false);
    expect(isTrustedPhotoUrl('http://res.cloudinary.com/democloud/image/upload/a.jpg')).toBe(false);
    expect(isTrustedPhotoUrl('https://res.cloudinary.com.evil.example/democloud/image/upload/a.jpg')).toBe(false);
    expect(isTrustedPhotoUrl('https://res.cloudinary.com/democloud/video/upload/a.mp4')).toBe(false);
    expect(isTrustedPhotoUrl('javascript:alert(1)')).toBe(false);
    expect(isTrustedPhotoUrl('not a url')).toBe(false);
    expect(isTrustedPhotoUrl(42)).toBe(false);
    expect(isTrustedPhotoUrl('https://res.cloudinary.com/democloud/image/upload/' + 'a'.repeat(600))).toBe(false);
  });

  it('accepts nothing when Cloudinary is not configured', () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    expect(isTrustedPhotoUrl('https://res.cloudinary.com/democloud/image/upload/a.jpg')).toBe(false);
  });
});
