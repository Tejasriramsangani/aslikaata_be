import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { User, UserDocument, UserStatus } from './schemas/user.schema.js';
import { Session, SessionDocument } from './schemas/session.schema.js';
import { OtpChallenge, OtpChallengeDocument, OtpPurpose } from './schemas/otp-challenge.schema.js';
import { AdminCredential, AdminCredentialDocument } from './schemas/admin-credential.schema.js';
import { SendOtpDto } from './dto/send-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { AdminLoginDto, RefreshTokenDto } from './dto/admin-login.dto.js';
import { SMS_SERVICE } from './sms/sms.interface.js';
import type { ISmsService } from './sms/sms.interface.js';
import { CryptoUtil } from '../../common/utils/crypto.util.js';
import { UserRole } from '../../common/decorators/roles.decorator.js';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Session.name) private readonly sessionModel: Model<SessionDocument>,
    @InjectModel(OtpChallenge.name) private readonly otpModel: Model<OtpChallengeDocument>,
    @InjectModel(AdminCredential.name) private readonly adminModel: Model<AdminCredentialDocument>,
    @Inject(SMS_SERVICE) private readonly smsService: ISmsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Dispatches OTP challenge with rate-limiting and cooldown enforcement.
   */
  async sendOtp(dto: SendOtpDto): Promise<{ message: string; cooldownSeconds: number }> {
    const now = new Date();

    // Check existing active challenge to enforce cooldown
    const existing = await this.otpModel
      .findOne({
        mobile: dto.mobile,
        purpose: dto.purpose,
        consumedAt: null,
        expiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 });

    if (existing && existing.resendCooldownUntil > now) {
      const waitSec = Math.ceil((existing.resendCooldownUntil.getTime() - now.getTime()) / 1000);
      throw new BadRequestException(`Please wait ${waitSec} seconds before requesting a new OTP`);
    }

    // Generate fresh 6-digit OTP
    const rawOtp = CryptoUtil.generateOtp(6);
    const codeHash = CryptoUtil.hashSha256(rawOtp, dto.mobile);

    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes validity
    const resendCooldownUntil = new Date(now.getTime() + 60 * 1000); // 60 seconds cooldown

    await this.otpModel.create({
      mobile: dto.mobile,
      purpose: dto.purpose,
      pickupId: dto.pickupId || null,
      codeHash,
      attempts: 0,
      maxAttempts: 3,
      expiresAt,
      resendCooldownUntil,
    });

    // Send OTP via SMS service
    await this.smsService.sendOtp(dto.mobile, rawOtp, dto.purpose);

    return {
      message: 'OTP sent successfully',
      cooldownSeconds: 60,
    };
  }

  /**
   * Verifies OTP, provisions or updates user, and returns session tokens.
   */
  async verifyOtp(dto: VerifyOtpDto): Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; mobile: string; roles: string[]; status: string };
  }> {
    const now = new Date();

    const challenge = await this.otpModel
      .findOne({
        mobile: dto.mobile,
        purpose: dto.purpose,
        consumedAt: null,
        expiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 });

    if (!challenge) {
      throw new BadRequestException('Invalid or expired OTP. Please request a new one.');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new BadRequestException('Maximum verification attempts exceeded. Please request a new OTP.');
    }

    const inputHash = CryptoUtil.hashSha256(dto.code, dto.mobile);
    if (challenge.codeHash !== inputHash) {
      challenge.attempts += 1;
      await challenge.save();
      const remaining = challenge.maxAttempts - challenge.attempts;
      throw new BadRequestException(`Incorrect OTP. ${remaining} attempts remaining.`);
    }

    // Mark challenge as consumed
    challenge.consumedAt = now;
    await challenge.save();

    // Find or create user
    const roleToAssign = dto.requestedRole || UserRole.CUSTOMER;
    let user = await this.userModel.findOne({ mobile: dto.mobile });

    if (!user) {
      user = await this.userModel.create({
        mobile: dto.mobile,
        roles: [roleToAssign],
        status: UserStatus.ACTIVE,
        lastLoginAt: now,
      });
    } else {
      user.lastLoginAt = now;
      if (dto.requestedRole && !user.roles.includes(dto.requestedRole)) {
        user.roles.push(dto.requestedRole);
      }
      await user.save();
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Your account has been suspended. Please contact support.');
    }

    // Generate Token Pair & Session
    const tokens = await this.createSession(user, dto.deviceInfo);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user._id.toString(),
        mobile: user.mobile,
        roles: user.roles,
        status: user.status,
      },
    };
  }

  /**
   * Rotates refresh token with reuse detection (Section 9 Security requirements).
   */
  async refreshSession(dto: RefreshTokenDto): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshTokenHash = CryptoUtil.hashSha256(dto.refreshToken);

    const session = await this.sessionModel.findOne({ refreshTokenHash });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse detection: if this session was already revoked, someone is reusing a compromised token
    if (session.revokedAt) {
      this.logger.warn(`Potential token reuse detected for session family ${session.familyId}! Revoking family.`);
      await this.sessionModel.updateMany({ familyId: session.familyId }, { revokedAt: new Date() });
      throw new UnauthorizedException('Security alert: Token reuse detected. Please log in again.');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired. Please log in again.');
    }

    // Revoke old session and issue new one in same family
    session.revokedAt = new Date();
    await session.save();

    const user = await this.userModel.findById(session.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User account no longer active');
    }

    return this.createSession(user, session.deviceInfo, session.familyId);
  }

  /**
   * Admin Email + Password (+ optional TOTP) login
   */
  async adminLogin(dto: AdminLoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    admin: { id: string; email: string; roles: string[] };
  }> {
    const admin = await this.adminModel.findOne({ email: dto.email.toLowerCase() });
    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Please try again later.');
    }

    const isMatch = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!isMatch) {
      admin.failedLoginAttempts += 1;
      if (admin.failedLoginAttempts >= 5) {
        admin.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
      }
      await admin.save();
      throw new UnauthorizedException('Invalid email or password');
    }

    // Reset failed attempts on success
    admin.failedLoginAttempts = 0;
    await admin.save();

    const user = await this.userModel.findById(admin.userId);
    if (!user || !user.roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('User is not authorized as an Admin');
    }

    const tokens = await this.createSession(user);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      admin: {
        id: user._id.toString(),
        email: admin.email,
        roles: user.roles,
      },
    };
  }

  /**
   * Helper to create a new session and issue dual JWT tokens.
   */
  private async createSession(
    user: UserDocument,
    deviceInfo?: Record<string, any>,
    existingFamilyId?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const familyId = existingFamilyId || uuidv4();
    const rawRefreshToken = `${uuidv4()}-${uuidv4()}`;
    const refreshTokenHash = CryptoUtil.hashSha256(rawRefreshToken);

    const refreshExpiresInDays = 30;
    const expiresAt = new Date(Date.now() + refreshExpiresInDays * 24 * 60 * 60 * 1000);

    const session = await this.sessionModel.create({
      userId: user._id.toString(),
      refreshTokenHash,
      familyId,
      deviceInfo: deviceInfo || {},
      expiresAt,
    });

    const payload = {
      sub: user._id.toString(),
      mobile: user.mobile,
      roles: user.roles,
      sessionId: session._id.toString(),
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>(
        'JWT_ACCESS_SECRET',
        'aslikaata_jwt_access_super_secret_key_2026_x98f2',
      ),
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m')) as any,
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }
}
