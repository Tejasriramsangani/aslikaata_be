import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISmsService } from './sms.interface.js';

@Injectable()
export class Fast2SmsService implements ISmsService {
  private readonly logger = new Logger(Fast2SmsService.name);
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FAST2SMS_API_KEY') || '';
  }

  async sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean> {
    // Fast2SMS expects 10-digit Indian phone numbers without +91 or leading 0
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);

    if (!this.apiKey) {
      this.logger.warn(
        `FAST2SMS_API_KEY not configured. Falling back: OTP for ${cleanMobile} is ${otp}`,
      );
      return false;
    }

    try {
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          variables_values: otp,
          route: 'otp',
          numbers: cleanMobile,
        }),
      });

      const data = await response.json();

      if (data && data.return === true) {
        this.logger.log(
          `[Fast2SMS] Successfully dispatched real SMS OTP to +91 ${cleanMobile} for ${purpose} (Request ID: ${data.request_id})`,
        );
        return true;
      } else {
        this.logger.error(`[Fast2SMS] Failed to dispatch SMS: ${JSON.stringify(data)}`);
        return false;
      }
    } catch (err: any) {
      this.logger.error(`[Fast2SMS] Network error: ${err.message}`);
      return false;
    }
  }
}
