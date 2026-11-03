/**
 * Named message types for non-OTP texts. Channels that need pre-approved templates
 * (WhatsApp) map each one to a template; plain SMS just sends the text.
 */
export type TextTemplateKey = 'PICKER_APPROVED' | 'PICKER_REJECTED';

export interface TextTemplate {
  key: TextTemplateKey;
  /** Values for the template's {{1}}, {{2}}, ... placeholders, in order. */
  variables: string[];
}

export interface ISmsService {
  sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean>;
  /** Plain transactional text (e.g. "your request was approved"). Best effort. */
  sendText(mobile: string, message: string, template?: TextTemplate): Promise<boolean>;
}

export const SMS_SERVICE = 'SMS_SERVICE';
