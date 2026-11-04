import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  Inject,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { User, UserDocument, UserStatus } from './schemas/user.schema.js';
import { Session, SessionDocument } from './schemas/session.schema.js';
import { OtpChallenge, OtpChallengeDocument, OtpPurpose } from './schemas/otp-challenge.schema.js';
import { AdminCredential, AdminCredentialDocument } from './schemas/admin-credential.schema.js';
import {
  EmployeeProfile,
  EmployeeProfileDocument,
  EmployeeStatus,
} from '../employees/schemas/employee-profile.schema.js';
import { SendOtpDto } from './dto/send-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { AdminLoginDto, RefreshTokenDto } from './dto/admin-login.dto.js';
import { SMS_SERVICE } from './sms/sms.interface.js';
import type { ISmsService } from './sms/sms.interface.js';
import { CryptoUtil } from '../../common/utils/crypto.util.js';
import { UserRole } from '../../common/decorators/roles.decorator.js';
import { isStaffRole } from '../../common/decorators/staff-access.decorator.js';

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
    @InjectModel(EmployeeProfile.name) private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
  ) {}

  async onModuleInit() {
    try {
      // No built-in admin passwords. Staff accounts live in the database and are created with
      // `npm run seed:admins` (or from the Users screen). For a brand-new, empty environment
      // only, a first Super Admin can be bootstrapped from ADMIN_BOOTSTRAP_* env vars.
      await this.bootstrapFirstAdminFromEnv();

      // Demo/test accounts are opt-in (SEED_DEMO_DATA=true in .env); real accounts live in the database.
      if (process.env.SEED_DEMO_DATA !== 'true') return;

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
   * Creates the very first Super Admin from ADMIN_BOOTSTRAP_EMAIL / _PASSWORD (/_NAME, /_MOBILE)
   * but only while no admin credential exists at all. Does nothing otherwise.
   */
  private async bootstrapFirstAdminFromEnv(): Promise<void> {
    const email = this.configService.get<string>('ADMIN_BOOTSTRAP_EMAIL')?.trim();
    const password = this.configService.get<string>('ADMIN_BOOTSTRAP_PASSWORD');
    if (!email || !password) return;
    if ((await this.adminModel.estimatedDocumentCount()) > 0) return;
    if (password.length < 8) {
      this.logger.warn('ADMIN_BOOTSTRAP_PASSWORD must be at least 8 characters; skipped.');
      return;
    }
    await this.createAdminUser({
      name: this.configService.get<string>('ADMIN_BOOTSTRAP_NAME') || 'Super Admin',
      email,
      mobile: this.configService.get<string>('ADMIN_BOOTSTRAP_MOBILE') || '9000000000',
      role: 'SUPER_ADMIN',
      password,
    });
    this.logger.log(`Bootstrapped first Super Admin: ${email.toLowerCase()}`);
  }

  /**
   * Dispatches OTP challenge with rate-limiting and cooldown enforcement.
   */
  /**
   * True only for local development with SMS_PROVIDER=mock (the default) outside production.
   * In that mode no real SMS is sent, so the API hands the generated OTP back to the app.
   */
  private isMockOtpMode(): boolean {
    return (
      this.configService.get<string>('SMS_PROVIDER', 'mock') === 'mock' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  /**
   * Returns the user to log in to the employee app, or throws.
   *
   * A number counts as an employee only when it has the EMPLOYEE role AND an employee profile
   * (created when an admin approves a picker request or adds the employee). The role alone is
   * not enough: older builds handed it to anyone who signed in through the employee app.
   * The same number may be stored as "98..." and "+9198...", so every match is checked.
   */
  private async assertEmployeeAccount(mobile: string): Promise<UserDocument> {
    const users = await this.userModel.find({ mobile: { $in: [mobile, `+91${mobile}`] } });
    const withRole = users.filter((u) => u.roles.includes(UserRole.EMPLOYEE));
    const profiles = withRole.length
      ? await this.employeeProfileModel
          .find({ userId: { $in: withRole.map((u) => String(u._id)) } })
          .select('userId status')
          .lean()
      : [];
    const profileOf = (u: UserDocument) => profiles.find((p: any) => String(p.userId) === String(u._id));
    const employee = withRole.find((u) => profileOf(u));

    const profile = employee ? profileOf(employee) : undefined;
    if (!employee || !profile || profile.status === EmployeeStatus.REJECTED) {
      throw new NotFoundException({
        message: "You don't have an account on this app yet. Raise a request to become a freelance picker.",
        details: { code: 'EMPLOYEE_ACCOUNT_NOT_FOUND' },
      });
    }
    if (employee.status !== UserStatus.ACTIVE || profile.status === EmployeeStatus.SUSPENDED) {
      throw new ForbiddenException({
        message: 'Your account has been suspended. Please contact support.',
        details: { code: 'ACCOUNT_SUSPENDED' },
      });
    }
    return employee;
  }

  async sendOtp(
    dto: SendOtpDto,
  ): Promise<{ message: string; cooldownSeconds: number; devOtp?: string }> {
    const now = new Date();

    // Employee app: do not send an OTP to a number that has no field account. The app then
    // offers "become a freelancer" instead of letting anyone sign themselves up.
    if (dto.loginRole === UserRole.EMPLOYEE) {
      await this.assertEmployeeAccount(dto.mobile);
    }

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

    const challenge = await this.otpModel.create({
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
    const delivered = await this.smsService.sendOtp(dto.mobile, rawOtp, dto.purpose);
    if (!delivered && !this.isMockOtpMode()) {
      // The SMS never left (e.g. low Fast2SMS balance): drop the challenge so the user isn't
      // stuck behind the 60s resend cooldown for a code they never received.
      await this.otpModel.deleteOne({ _id: challenge._id });
      throw new ServiceUnavailableException({
        message: 'We could not send the OTP right now. Please try again in a moment.',
        details: { code: 'OTP_SMS_FAILED' },
      });
    }

    return {
      message: 'OTP sent successfully',
      cooldownSeconds: 60,
      // Never present with a real SMS provider or in production.
      ...(this.isMockOtpMode() ? { devOtp: rawOtp } : {}),
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

    // Dev-only shortcut for the mock SMS provider. It used to also accept 123456 for three
    // fixed numbers in production; it is now strictly limited to mock mode outside production.
    const isMasterTestOtp = dto.code === '123456' && this.isMockOtpMode();

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

    // Self-service OTP sign-in may only ever grant customer / employee access.
    // ADMIN staff are created through admin credentials, never by a client-supplied role.
    if (dto.requestedRole === UserRole.ADMIN) {
      throw new ForbiddenException('The admin role cannot be requested through OTP sign-in');
    }
    // Employee accounts are created by an admin (approved picker request), never by signing in.
    const employeeUser =
      dto.requestedRole === UserRole.EMPLOYEE ? await this.assertEmployeeAccount(dto.mobile) : null;
    const roleToAssign = dto.requestedRole || UserRole.CUSTOMER;
    let user =
      employeeUser ??
      (await this.userModel.findOne({
        mobile: { $in: [dto.mobile, `+91${dto.mobile}`] },
      }));

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
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('Password is required and must be at least 8 characters');
    }
    // No silent default to SUPER_ADMIN: the role must be an explicit, valid staff role.
    if (!isStaffRole(dto.role)) {
      throw new BadRequestException(
        'Role must be one of SUPER_ADMIN, YARD_MANAGER, DISPATCHER or ACCOUNTANT',
      );
    }
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

    const passwordHash = await bcrypt.hash(dto.password as string, 10);

    const cred = await this.adminModel.create({
      userId: user._id.toString(),
      email,
      passwordHash,
      name: dto.name.trim(),
      role: dto.role,
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
   * Ends this login. Revokes the whole refresh-token family of the session behind the caller's access
   * token, so the device can no longer silently sign back in and the user stops counting as logged in.
   */
  async logout(sessionId?: string): Promise<{ loggedOut: boolean }> {
    if (!sessionId || !isValidObjectId(sessionId)) return { loggedOut: true };
    const session = await this.sessionModel.findById(sessionId);
    if (session) {
      await this.sessionModel.updateMany(
        { familyId: session.familyId, revokedAt: null },
        { revokedAt: new Date() },
      );
    }
    return { loggedOut: true };
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

    // Staff role claim: used by the websocket gateway (REST re-reads it from the database).
    let staffRole: string | undefined;
    if (user.roles.includes(UserRole.ADMIN)) {
      const cred = await this.adminModel.findOne({ userId: user._id.toString() }).select('role').lean();
      if (cred && isStaffRole(cred.role)) staffRole = cred.role;
    }

    const payload = {
      sub: user._id.toString(),
      mobile: user.mobile,
      roles: user.roles,
      sessionId: session._id.toString(),
      ...(staffRole ? { staffRole } : {}),
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m')) as any,
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }
}
