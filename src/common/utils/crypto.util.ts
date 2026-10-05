import * as crypto from 'crypto';

/**
 * Cryptography and Data Sanitization Utilities
 */
export class CryptoUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16;
  private static readonly TAG_LENGTH = 16;

  /**
   * Generates a 6-digit cryptographically secure numeric OTP string.
   */
  static generateOtp(digits: number = 6): string {
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits) - 1;
    return crypto.randomInt(min, max + 1).toString();
  }

  /**
   * Hashes text using SHA-256 with optional salt.
   */
  static hashSha256(text: string, salt: string = ''): string {
    return crypto.createHash('sha256').update(`${salt}:${text}`).digest('hex');
  }

  /**
   * Generates a random cryptographic token in hex.
   */
  static generateRandomToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Format: iv:ciphertext:tag (all hex encoded)
   */
  static encryptAes256(plainText: string, masterKeyHex?: string): string {
    const key = Buffer.from(
      masterKeyHex || process.env.ENCRYPTION_MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'hex'
    );
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`;
  }

  /**
   * Decrypts ciphertext previously encrypted with AES-256-GCM.
   */
  static decryptAes256(encryptedPayload: string, masterKeyHex?: string): string {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format');
    }

    const [ivHex, cipherHex, tagHex] = parts;
    const key = Buffer.from(
      masterKeyHex || process.env.ENCRYPTION_MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'hex'
    );
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Masks sensitive identifier numbers for secure UI display.
   * e.g., Aadhaar 123456781234 -> XXXX-XXXX-1234
   */
  static maskIdentifier(identifier: string): string {
    const clean = identifier.replace(/[\s-]/g, '');
    if (clean.length >= 12) {
      // Aadhaar format
      return `XXXX-XXXX-${clean.slice(-4)}`;
    }
    if (clean.length === 10) {
      // PAN or Mobile format
      return `XXXXXX${clean.slice(-4)}`;
    }
    if (clean.length > 4) {
      return `${'X'.repeat(clean.length - 4)}${clean.slice(-4)}`;
    }
    return 'XXXX';
  }
}
