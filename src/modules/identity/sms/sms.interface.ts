/**
 * Named message types for non-OTP texts. Channels that need pre-approved templates
 * (WhatsApp) map each one to a template; plain SMS just sends the text.
 */
export type TextTemplateKey = 'PICKER_APPROVED' | 'PICKER_REJECTED' |
  'PICKUP_REQUEST_RECEIVED' | 'PICKUP_CONFIRMED' | 'EMPLOYEE_ASSIGNED' | 'PICKUP_CANCELLED' | 'PICKUP_COMPLETED_PAYMENT';

export interface WhatsAppDeliveryResult {
  accepted: boolean;
  requestId?: string;
  httpStatus?: number;
  errorCode?: 'CONFIGURATION' | 'VALIDATION' | 'AUTHORIZATION' | 'RATE_LIMIT' | 'PROVIDER' | 'TIMEOUT' | 'NETWORK';
  /** A lost response can mean the provider accepted the message. Never automatically resend. */
  ambiguous?: boolean;
}

export interface TextTemplate {
  key: TextTemplateKey;
  /** Values for the template's {{1}}, {{2}}, ... placeholders, in order. */
  variables: string[];
  /** Opaque existing outbox ID, echoed by delivery webhooks; never a mobile or OTP. */
  correlationId?: string;
}

export interface ISmsService {
  sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean>;
  /** Plain transactional text (e.g. "your request was approved"). Best effort. */
  sendText(mobile: string, message: string, template?: TextTemplate): Promise<boolean>;
  sendTemplate?(mobile: string, template: TextTemplate): Promise<WhatsAppDeliveryResult>;
}

export const SMS_SERVICE = 'SMS_SERVICE';
