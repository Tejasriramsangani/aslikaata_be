import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { User, UserSchema } from './schemas/user.schema.js';
import { Session, SessionSchema } from './schemas/session.schema.js';
import { OtpChallenge, OtpChallengeSchema } from './schemas/otp-challenge.schema.js';
import { AdminCredential, AdminCredentialSchema } from './schemas/admin-credential.schema.js';
import { IdentityService } from './identity.service.js';
import { IdentityController } from './identity.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { ConfigService } from '@nestjs/config';
import { Fast2SmsService } from './sms/fast2sms.service.js';
import { SMS_SERVICE } from './sms/sms.interface.js';
import { MockSmsService } from './sms/mock-sms.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
      { name: OtpChallenge.name, schema: OtpChallengeSchema },
      { name: AdminCredential.name, schema: AdminCredentialSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [IdentityController, AdminUsersController],
  providers: [
    IdentityService,
    JwtStrategy,
    {
      provide: SMS_SERVICE,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('SMS_PROVIDER', 'mock');
        if (provider === 'fast2sms') {
          return new Fast2SmsService(configService);
        }
        return new MockSmsService();
      },
      inject: [ConfigService],
    },
  ],
  exports: [IdentityService, JwtStrategy, PassportModule, JwtModule, MongooseModule],
})
export class IdentityModule {}
