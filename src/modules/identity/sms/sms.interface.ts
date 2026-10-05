export interface ISmsService {
  sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean>;
}

export const SMS_SERVICE = 'SMS_SERVICE';
