export interface ISmsService {
  sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean>;
  /** Plain transactional text (e.g. "your request was approved"). Best effort. */
  sendText(mobile: string, message: string): Promise<boolean>;
}

export const SMS_SERVICE = 'SMS_SERVICE';
