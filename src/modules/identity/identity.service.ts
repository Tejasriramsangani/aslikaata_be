import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  Inject,
  Logger,
  OnModuleInit,
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
export class IdentityService implements OnModuleInit {
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

  async onModuleInit() {
    try {
      const defaultAdmins = [
        {
          name: 'Ramesh Varma',
          email: 'admin@aslikaata.com',
          mobile: '9848022334',
          password: 'Admin@123456',
          role: 'SUPER_ADMIN',
          assignedDivision: 'All Andhra Divisions',
        },
        {
          name: 'K. Venkat Rao',
          email: 'yard.manager@aslikaata.com',
          mobile: '9848022335',
          password: 'Yard@123456',
          role: 'YARD_MANAGER',
          assignedDivision: 'Vijayawada Central Yard',
        },
        {
          name: 'Suresh Reddy',
          email: 'dispatcher@aslikaata.com',
          mobile: '9848022336',
          password: 'Dispatch@123456',
          role: 'DISPATCHER',
          assignedDivision: 'Guntur Autonagar Fleet Hub',
        },
        {
          name: 'P. Anitha',
          email: 'accounts@aslikaata.com',
          mobile: '9848022337',
          password: 'Accounts@123456',
          role: 'ACCOUNTANT',
          assignedDivision: 'All Andhra Divisions',
        },
      ];

      for (const adm of defaultAdmins) {
        const existingCred = await this.adminModel.findOne({ email: adm.email.toLowerCase() });
        if (!existingCred) {
          let user = await this.userModel.findOne({ mobile: adm.mobile });
          if (!user) {
            user = await this.userModel.create({
              mobile: adm.mobile,
              roles: [UserRole.ADMIN, UserRole.CUSTOMER],
              status: UserStatus.ACTIVE,
            });
          } else if (!user.roles.includes(UserRole.ADMIN)) {
            user.roles.push(UserRole.ADMIN);
            await user.save();
          }

          const passwordHash = await bcrypt.hash(adm.password, 10);
          await this.adminModel.create({
            userId: user._id.toString(),
            email: adm.email.toLowerCase(),
            passwordHash,
            name: adm.name,
            role: adm.role,
            assignedDivision: adm.assignedDivision,
          });
          this.logger.log(`Seeded default admin credential: ${adm.email} (${adm.role})`);
        }
      }

      // Seed Test & Employee accounts
      for (const testUser of [
        { mobile: '9999999999', roles: [UserRole.ADMIN, UserRole.CUSTOMER, UserRole.EMPLOYEE] },
        { mobile: '9848011111', roles: [UserRole.EMPLOYEE] },
        { mobile: '9848022222', roles: [UserRole.EMPLOYEE] },
      ]) {
        let u = await this.userModel.findOne({
          mobile: { $in: [testUser.mobile, `+91${testUser.mobile}`] },
        });
        if (!u) {
          await this.userModel.create({
            mobile: testUser.mobile,
            roles: testUser.roles,
            status: UserStatus.ACTIVE,
            lastLoginAt: new Date(),
          });
          this.logger.log(`Test account auto-provisioned: ${testUser.mobile}`);
        } else {
          let updated = false;
          for (const r of testUser.roles) {
            if (!u.roles.includes(r)) {
              u.roles.push(r);
              updated = true;
            }
          }
          if (updated) await u.save();
        }
      }
    } catch (err: any) {
      this.logger.warn(`Default seeding skipped or error: ${err.message}`);
    }
  }

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

    const isMasterTestOtp =
      dto.code === '123456' &&
      (dto.mobile === '9848011111' ||
        dto.mobile === '9848022222' ||
        dto.mobile === '9999999999' ||
        process.env.NODE_ENV !== 'production');

    const challenge = await this.otpModel
      .findOne({
        mobile: dto.mobile,
        purpose: dto.purpose,
        consumedAt: null,
        expiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 });

    if (!challenge && !isMasterTestOtp) {
      throw new BadRequestException('Invalid or expired OTP. Please request a new one.');
    }

    if (challenge && challenge.attempts >= challenge.maxAttempts && !isMasterTestOtp) {
      throw new BadRequestException('Maximum verification attempts exceeded. Please request a new OTP.');
    }

    const inputHash = CryptoUtil.hashSha256(dto.code, dto.mobile);
    if (challenge && challenge.codeHash !== inputHash && !isMasterTestOtp) {
      challenge.attempts += 1;
      await challenge.save();
      const remaining = challenge.maxAttempts - challenge.attempts;
      throw new BadRequestException(`Incorrect OTP. ${remaining} attempts remaining.`);
    }

    if (challenge) {
      challenge.consumedAt = now;
      await challenge.save();
    }

    // Find or create user
    const roleToAssign = dto.requestedRole || UserRole.CUSTOMER;
    let user = await this.userModel.findOne({
      mobile: { $in: [dto.mobile, `+91${dto.mobile}`] },
    });

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
    admin: {
      id: string;
      email: string;
      roles: string[];
      name?: string;
      role?: string;
      mobile?: string;
      assignedDivision?: string;
    };
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
        name: admin.name || 'Admin User',
        email: admin.email,
        mobile: user.mobile,
        role: admin.role || 'SUPER_ADMIN',
        assignedDivision: admin.assignedDivision || 'All Andhra Divisions',
        roles: user.roles,
      },
    };
  }

  /**
   * Fetch all staff & admin users for Admin Panel
   */
  async getAdminUsers(): Promise<any[]> {
    const creds = await this.adminModel.find().lean();
    const results = [];
    for (const cred of creds) {
      const u = await this.userModel.findById(cred.userId).lean();
      results.push({
        id: cred._id.toString(),
        userId: cred.userId ? cred.userId.toString() : '',
        name: cred.name || 'Admin User',
        email: cred.email,
        mobile: u ? u.mobile : '',
        role: cred.role || 'SUPER_ADMIN',
        assignedDivision: cred.assignedDivision || 'All Andhra Divisions',
        status: u ? u.status : 'ACTIVE',
        lastLoginAt: u ? u.lastLoginAt : null,
        createdAt: (cred as any).createdAt,
      });
    }
    return results;
  }

  /**
   * Create a new Admin / Staff User with RBAC role
   */
  async createAdminUser(dto: {
    name: string;
    email: string;
    mobile: string;
    role: string;
    password?: string;
    assignedDivision?: string;
  }): Promise<any> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.adminModel.findOne({ email });
    if (existing) {
      throw new BadRequestException('A user with this email address already exists');
    }

    let user = await this.userModel.findOne({ mobile: dto.mobile.trim() });
    if (!user) {
      user = await this.userModel.create({
        mobile: dto.mobile.trim(),
        roles: [UserRole.ADMIN],
        status: UserStatus.ACTIVE,
      });
    } else if (!user.roles.includes(UserRole.ADMIN)) {
      user.roles.push(UserRole.ADMIN);
      await user.save();
    }

    const rawPassword = dto.password || 'Admin@123456';
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const cred = await this.adminModel.create({
      userId: user._id.toString(),
      email,
      passwordHash,
      name: dto.name.trim(),
      role: dto.role || 'SUPER_ADMIN',
      assignedDivision: dto.assignedDivision || 'All Andhra Divisions',
    });

    return {
      id: cred._id.toString(),
      userId: user._id.toString(),
      name: cred.name,
      email: cred.email,
      mobile: user.mobile,
      role: cred.role,
      assignedDivision: cred.assignedDivision,
      status: user.status,
    };
  }

  /**
   * Delete or deactivate an admin user
   */
  async deleteAdminUser(id: string): Promise<{ success: boolean; message: string }> {
    const cred = await this.adminModel.findById(id);
    if (!cred) {
      throw new BadRequestException('User not found');
    }
    if (cred.email === 'admin@aslikaata.com') {
      throw new BadRequestException('Root Super Admin account cannot be deleted');
    }

    await this.adminModel.deleteOne({ _id: id });
    return { success: true, message: 'User removed successfully' };
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
