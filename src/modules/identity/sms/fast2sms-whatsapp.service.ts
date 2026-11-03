import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ISmsService, TextTemplate, TextTemplateKey } from './sms.interface.js';

const FAST2SMS_WHATSAPP_URL = 'https://www.fast2sms.com/dev/whatsapp';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * WhatsApp variables cannot contain the "|" separator, newlines, tabs or long runs of spaces.
 */
export function toWhatsappVariable(value: string): string {
  return value
    .replace(/\|/g, '/')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 500);
}

/**
 * Sends OTPs and updates through Fast2SMS's WhatsApp Business API (no DLT needed).
 *
 * WhatsApp only delivers Meta-approved templates, so every message type maps to a template's
 * Fast2SMS "message_id" (set in .env). If WhatsApp fails (number not on WhatsApp, template
 * missing, etc.) and a fallback is given, the message goes out as a normal SMS instead.
 */
@Injectable()
export class Fast2SmsWhatsappService implements ISmsService {
  private readonly logger = new Logger(Fast2SmsWhatsappService.name);
  private readonly apiKey: string;
  private readonly phoneNumberId: string;
  private readonly otpTemplateId: string;
  private readonly pickupOtpTemplateId: string;
  private readonly textTemplateIds: Record<TextTemplateKey, string>;

  constructor(
    private readonly configService: ConfigService,
    private readonly smsFallback?: ISmsService,
  ) {
    const get = (key: string) => (this.configService.get<string>(key) || '').trim();
    this.apiKey = get('FAST2SMS_API_KEY');
    this.phoneNumberId = get('FAST2SMS_WA_PHONE_NUMBER_ID');
    this.otpTemplateId = get('FAST2SMS_WA_OTP_TEMPLATE_ID');
    this.pickupOtpTemplateId = get('FAST2SMS_WA_PICKUP_OTP_TEMPLATE_ID') || this.otpTemplateId;
    this.textTemplateIds = {
      PICKER_APPROVED: get('FAST2SMS_WA_PICKER_APPROVED_TEMPLATE_ID'),
      PICKER_REJECTED: get('FAST2SMS_WA_PICKER_REJECTED_TEMPLATE_ID'),
    };
  }

  async sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean> {
    const templateId = purpose === 'PICKUP_COMPLETION' ? this.pickupOtpTemplateId : this.otpTemplateId;
    const ok = await this.dispatch(mobile, templateId, [otp], `OTP (${purpose})`);
    if (ok) return true;

    if (this.smsFallback) {
      this.logger.warn(`[Fast2SMS WhatsApp] Falling back to SMS for OTP (${purpose})`);
      return this.smsFallback.sendOtp(mobile, otp, purpose);
    }
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`[DEV FALLBACK] OTP for +91 ${this.cleanMobile(mobile)}: [ ${otp} ]`);
    }
    return false;
  }

  async sendText(mobile: string, message: string, template?: TextTemplate): Promise<boolean> {
    const templateId = template ? this.textTemplateIds[template.key] : '';
    if (template && templateId) {
      const ok = await this.dispatch(mobile, templateId, template.variables, `text (${template.key})`);
      if (ok) return true;
    } else {
      this.logger.warn(
        `[Fast2SMS WhatsApp] No WhatsApp template configured for ${template?.key ?? 'this text'}; WhatsApp only sends approved templates.`,
      );
    }
    return this.smsFallback ? this.smsFallback.sendText(mobile, message, template) : false;
  }

  /** Fast2SMS expects 10-digit Indian numbers without +91 or a leading 0. */
  private cleanMobile(mobile: string): string {
    return mobile.replace(/\D/g, '').slice(-10);
  }

  private async dispatch(mobile: string, templateId: string, variables: string[], label: string): Promise<boolean> {
    const numbers = this.cleanMobile(mobile);
    const masked = `${numbers.slice(0, 2)}XXXXXX${numbers.slice(-2)}`;

    if (!this.apiKey || !this.phoneNumberId || !templateId) {
      this.logger.error(
        `[Fast2SMS WhatsApp] ${label} not sent: set FAST2SMS_API_KEY, FAST2SMS_WA_PHONE_NUMBER_ID and the template ID in .env`,
      );
      return false;
    }
    if (numbers.length !== 10) {
      this.logger.error(`[Fast2SMS WhatsApp] Invalid mobile number for ${label}: "${mobile}"`);
      return false;
    }

    const params = new URLSearchParams({
      message_id: templateId,
      phone_number_id: this.phoneNumberId,
      numbers,
    });
    if (variables.length) {
      params.set('variables_values', variables.map(toWhatsappVariable).join('|'));
    }

    try {
      const response = await fetch(`${FAST2SMS_WHATSAPP_URL}?${params.toString()}`, {
        method: 'GET',
        headers: { authorization: this.apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data: any = await response.json().catch(() => null);

      if (data?.status === true || data?.return === true) {
        this.logger.log(`[Fast2SMS WhatsApp] ${label} sent to ${masked} (request ${data.request_id})`);
        return true;
      }
      const reason = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
      this.logger.error(
        `[Fast2SMS WhatsApp] ${label} to ${masked} rejected (HTTP ${response.status}): ${reason ?? 'no details'}`,
      );
      return false;
    } catch (err: any) {
      const why = err?.name === 'TimeoutError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err?.message;
      this.logger.error(`[Fast2SMS WhatsApp] ${label} to ${masked} failed: ${why}`);
      return false;
    }
  }
}
