import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISmsService } from './sms.interface.js';

const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';
const REQUEST_TIMEOUT_MS = 10_000;
/** One SMS segment in the GSM-7 alphabet. Longer (or Unicode) text is billed as several SMS. */
const SINGLE_SMS_LENGTH = 160;

/**
 * Converts text to plain GSM-friendly ASCII so Quick SMS bills it as a normal (not Unicode) SMS:
 * smart quotes/dashes become plain ones, emoji and other non-ASCII characters are dropped.
 */
export function toSmsSafeText(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/₹/g, 'Rs.')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Keeps a message inside a single SMS so each send costs one credit. */
export function fitSingleSms(text: string): string {
  const safe = toSmsSafeText(text);
  return safe.length <= SINGLE_SMS_LENGTH ? safe : `${safe.slice(0, SINGLE_SMS_LENGTH - 3).trimEnd()}...`;
}

export function buildOtpMessage(otp: string, purpose: string): string {
  if (purpose === 'PICKUP_COMPLETION') {
    return `${otp} is your ASLI KAATA pickup completion code. Share it with the picker only after you receive your payment. Valid for 5 minutes.`;
  }
  return `${otp} is your ASLI KAATA login code. Valid for 5 minutes. Do not share it with anyone.`;
}

/**
 * Fast2SMS sender. Defaults to the Quick SMS route ('q'): plain text, no DLT registration needed.
 * Set FAST2SMS_ROUTE=otp to use Fast2SMS's OTP route instead (once it is enabled on the account).
 */
@Injectable()
export class Fast2SmsService implements ISmsService {
  private readonly logger = new Logger(Fast2SmsService.name);
  private readonly apiKey: string;
  private readonly route: 'q' | 'otp';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FAST2SMS_API_KEY') || '';
    this.route = this.configService.get<string>('FAST2SMS_ROUTE', 'q') === 'otp' ? 'otp' : 'q';
  }

  async sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean> {
    const payload: Record<string, string> =
      this.route === 'otp'
        ? { route: 'otp', variables_values: otp }
        : { route: 'q', message: fitSingleSms(buildOtpMessage(otp, purpose)) };

    const ok = await this.dispatch(mobile, payload, `OTP (${purpose})`);
    if (!ok && process.env.NODE_ENV !== 'production') {
      this.logger.warn('[Fast2SMS] Delivery failed; no development OTP fallback is enabled for this provider.');
    }
    return ok;
  }

  async sendText(mobile: string, message: string): Promise<boolean> {
    // Plain texts always use Quick SMS: the OTP route only accepts a numeric code.
    return this.dispatch(mobile, { route: 'q', message: fitSingleSms(message) }, 'text');
  }

  /** Fast2SMS expects 10-digit Indian numbers without +91 or a leading 0. */
  private cleanMobile(mobile: string): string {
    return mobile.replace(/\D/g, '').slice(-10);
  }

  private async dispatch(mobile: string, payload: Record<string, string>, label: string): Promise<boolean> {
    const numbers = this.cleanMobile(mobile);
    const masked = `${numbers.slice(0, 2)}XXXXXX${numbers.slice(-2)}`;

    if (!this.apiKey) {
      this.logger.warn(`FAST2SMS_API_KEY not configured. ${label} SMS to ${masked} not sent.`);
      return false;
    }
    if (numbers.length !== 10) {
      this.logger.error(`[Fast2SMS] Invalid mobile number for ${label} SMS: "${mobile}"`);
      return false;
    }

    try {
      const response = await fetch(FAST2SMS_URL, {
        method: 'POST',
        headers: { authorization: this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, numbers }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data: any = await response.json().catch(() => null);

      if (response.status >= 200 && response.status < 300 && data?.return === true) {
        this.logger.log(`[Fast2SMS] ${label} SMS sent to ${masked} (route ${payload.route}, request ${data.request_id})`);
        return true;
      }
      // Typical causes: low wallet balance, route not enabled, invalid key. Fast2SMS explains it in `message`.
      const reason = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
      this.logger.error(
        `[Fast2SMS] ${label} SMS to ${masked} rejected (HTTP ${response.status}, code ${data?.status_code ?? '-'}): ${reason ?? 'no details'}`,
      );
      return false;
    } catch (err: any) {
      const why = err?.name === 'TimeoutError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err?.message;
      this.logger.error(`[Fast2SMS] ${label} SMS to ${masked} failed: ${why}`);
      return false;
    }
  }
}
