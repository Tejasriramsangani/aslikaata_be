import { Injectable, Logger } from '@nestjs/common';
import { ISmsService } from './sms.interface.js';

@Injectable()
export class MockSmsService implements ISmsService {
  private readonly logger = new Logger('MockSmsService');

  async sendOtp(_mobile: string, _otp: string, purpose: string): Promise<boolean> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV ONLY] Mock OTP generated for ${purpose}; delivery skipped.`);
    } else {
      this.logger.log(`Mock OTP dispatch invoked for ${purpose}.`);
    }
    return true;
  }

  async sendText(_mobile: string, _message: string): Promise<boolean> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('[DEV ONLY] Mock text delivery skipped.');
    } else {
      this.logger.log('Mock text dispatch invoked.');
    }
    return true;
  }
}
