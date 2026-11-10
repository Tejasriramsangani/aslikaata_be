import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ISmsService, TextTemplate, TextTemplateKey, WhatsAppDeliveryResult } from './sms.interface.js';

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
  private readonly signupOtpTemplateId: string;
  private readonly pickupOtpTemplateId: string;
  private readonly textTemplateIds: Record<TextTemplateKey, string>;

  constructor(
    private readonly configService: ConfigService,
    private readonly smsFallback?: ISmsService,
  ) {
    const get = (key: string) => (this.configService.get<string>(key) || '').trim();
    this.apiKey = get('FAST2SMS_WA_API_KEY') || get('FAST2SMS_API_KEY');
    this.phoneNumberId = get('FAST2SMS_WA_PHONE_NUMBER_ID');
    this.otpTemplateId = get('FAST2SMS_WA_OTP_TEMPLATE_ID');
    this.signupOtpTemplateId = get('FAST2SMS_WA_SIGNUP_OTP_TEMPLATE_ID');
    this.pickupOtpTemplateId = get('FAST2SMS_WA_PICKUP_OTP_TEMPLATE_ID') || this.otpTemplateId;
    this.textTemplateIds = {
      PICKER_APPROVED: get('FAST2SMS_WA_PICKER_APPROVED_TEMPLATE_ID'),
      PICKER_REJECTED: get('FAST2SMS_WA_PICKER_REJECTED_TEMPLATE_ID'),
      PICKUP_REQUEST_RECEIVED: get('FAST2SMS_WA_PICKUP_REQUEST_RECEIVED_TEMPLATE_ID'),
      PICKUP_CONFIRMED: get('FAST2SMS_WA_PICKUP_CONFIRMED_TEMPLATE_ID'),
      EMPLOYEE_ASSIGNED: get('FAST2SMS_WA_EMPLOYEE_ASSIGNED_TEMPLATE_ID'),
      PICKUP_CANCELLED: get('FAST2SMS_WA_PICKUP_CANCELLED_TEMPLATE_ID'),
      PICKUP_COMPLETED_PAYMENT: get('FAST2SMS_WA_PICKUP_COMPLETED_PAYMENT_TEMPLATE_ID'),
    };
  }

  async sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean> {
    const templateId = purpose === 'SIGNUP' ? this.signupOtpTemplateId :
      purpose === 'PICKUP_COMPLETION' ? this.pickupOtpTemplateId : this.otpTemplateId;
    if (purpose !== 'PICKUP_COMPLETION' && !/^\d{6}$/.test(otp)) return false;
    const ok = await this.dispatch(mobile, templateId, [otp], `OTP (${purpose})`);
    if (ok) return true;

    if (this.smsFallback) {
      this.logger.warn(`[Fast2SMS WhatsApp] Falling back to SMS for OTP (${purpose})`);
      return this.smsFallback.sendOtp(mobile, otp, purpose);
    }
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn('[Fast2SMS WhatsApp] Delivery failed; no development OTP fallback is enabled for this provider.');
    }
    return false;
  }

  async sendText(mobile: string, message: string, template?: TextTemplate): Promise<boolean> {
    const templateId = template ? this.textTemplateIds[template.key] : '';
    if (template && templateId) {
      const ok = (await this.sendTemplate(mobile, template)).accepted;
      if (ok) return true;
    } else {
      this.logger.warn(
        `[Fast2SMS WhatsApp] No WhatsApp template configured for ${template?.key ?? 'this text'}; WhatsApp only sends approved templates.`,
      );
    }
    return this.smsFallback ? this.smsFallback.sendText(mobile, message, template) : false;
  }

  /** Structured outcomes for the existing outbox; never falls back to a different channel. */
  async sendTemplate(mobile: string, template: TextTemplate): Promise<WhatsAppDeliveryResult> {
    if (typeof mobile !== 'string' || !template || !Array.isArray(template.variables)) return { accepted: false, errorCode: 'VALIDATION' };
    const counts: Partial<Record<TextTemplateKey, number>> = {
      PICKUP_REQUEST_RECEIVED: 2, PICKUP_CONFIRMED: 4, EMPLOYEE_ASSIGNED: 3,
      PICKUP_CANCELLED: 2, PICKUP_COMPLETED_PAYMENT: 5,
    };
    if ((counts[template.key] != null && template.variables.length !== counts[template.key]) ||
        template.variables.some(value => typeof value !== 'string' || !value.trim() || value.length > 500)) {
      return { accepted: false, errorCode: 'VALIDATION' };
    }
    if (template.correlationId && !/^[a-f\d]{24}$/i.test(template.correlationId)) return { accepted: false, errorCode: 'VALIDATION' };
    return this.dispatchDetailed(mobile, this.textTemplateIds[template.key], template.variables, template.correlationId);
  }

  /** Fast2SMS expects 10-digit Indian numbers without +91 or a leading 0. */
  private cleanMobile(mobile: string): string {
    return mobile.replace(/\D/g, '').slice(-10);
  }

  private async dispatch(mobile: string, templateId: string, variables: string[], label: string): Promise<boolean> {
    const result = await this.dispatchDetailed(mobile, templateId, variables);
    if (!result.accepted) this.logger.warn(`WhatsApp ${label} rejected (${result.errorCode}; HTTP ${result.httpStatus ?? 'none'}).`);
    return result.accepted;
  }

  private async dispatchDetailed(mobile: string, templateId: string, variables: string[], correlationId?: string): Promise<WhatsAppDeliveryResult> {
    const numbers = this.cleanMobile(mobile);

    if (!this.apiKey || !this.phoneNumberId || !templateId) {
      this.logger.error(
        '[Fast2SMS WhatsApp] Missing authorization, Phone Number ID or template configuration.',
      );
      return { accepted: false, errorCode: 'CONFIGURATION' };
    }
    if (numbers.length !== 10) {
      return { accepted: false, errorCode: 'VALIDATION' };
    }

    const params = new URLSearchParams({
      message_id: templateId,
      phone_number_id: this.phoneNumberId,
      numbers,
    });
    if (correlationId) params.set('udf1', correlationId);
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

      if (response.status >= 200 && response.status < 300 && (data?.status === true || data?.return === true)) {
        const requestId = typeof data.request_id === 'string' && /^[\w-]{1,200}$/.test(data.request_id) ? data.request_id : undefined;
        return { accepted: true, requestId, httpStatus: response.status };
      }
      if (response.status === 401) {
        this.logger.error('[Fast2SMS WhatsApp] Authentication rejected (HTTP 401). Configure FAST2SMS_WA_API_KEY using the authorization key from the Fast2SMS WhatsApp API panel.');
        return { accepted: false, httpStatus: 401, errorCode: 'AUTHORIZATION' };
      }
      const reason = typeof data?.message === 'string' ? data.message : '';
      const invalidSender = response.status === 400 && /phone.number.id|not connected/i.test(reason);
      return { accepted: false, httpStatus: response.status,
        errorCode: invalidSender ? 'CONFIGURATION' : response.status === 429 ? 'RATE_LIMIT' : 'PROVIDER', ambiguous: response.status >= 500 };
    } catch (err: any) {
      return { accepted: false, errorCode: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', ambiguous: true };
    }
  }
}
