import { Injectable, Logger } from '@nestjs/common';
import { ISmsService } from './sms.interface.js';

@Injectable()
export class MockSmsService implements ISmsService {
  private readonly logger = new Logger('MockSmsService');

  async sendOtp(mobile: string, otp: string, purpose: string): Promise<boolean> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV ONLY] SMS dispatched to ${mobile} for ${purpose} | OTP: ${otp}`);
    } else {
      this.logger.log(`SMS dispatched to ${mobile.slice(0, 4)}XXXXXX for ${purpose}`);
    }
    return true;
  }
}
