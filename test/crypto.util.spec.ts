import { describe, it, expect } from 'vitest';
import { CryptoUtil } from '../src/common/utils/crypto.util.js';

describe('CryptoUtil', () => {
  it('should generate a 6-digit numeric OTP', () => {
    const otp = CryptoUtil.generateOtp(6);
    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });

  it('should generate matching SHA-256 hashes with salt', () => {
    const hash1 = CryptoUtil.hashSha256('123456', '9876543210');
    const hash2 = CryptoUtil.hashSha256('123456', '9876543210');
    const different = CryptoUtil.hashSha256('654321', '9876543210');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(different);
  });

  it('should correctly encrypt and decrypt text with AES-256-GCM', () => {
    const rawAadhaar = '123456789012';
    const encrypted = CryptoUtil.encryptAes256(rawAadhaar);
    expect(encrypted).not.toBe(rawAadhaar);
    expect(encrypted.split(':')).toHaveLength(3); // iv:ciphertext:tag

    const decrypted = CryptoUtil.decryptAes256(encrypted);
    expect(decrypted).toBe(rawAadhaar);
  });

  it('should mask identifiers safely for display', () => {
    // Aadhaar (12 digits)
    expect(CryptoUtil.maskIdentifier('123456789012')).toBe('XXXX-XXXX-9012');
    expect(CryptoUtil.maskIdentifier('1234-5678-9012')).toBe('XXXX-XXXX-9012');

    // Phone / PAN (10 digits/chars)
    expect(CryptoUtil.maskIdentifier('9876543210')).toBe('XXXXXX3210');
    expect(CryptoUtil.maskIdentifier('ABCDE1234F')).toBe('XXXXXX234F');
  });
});
