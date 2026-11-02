import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AdminCredential, AdminCredentialDocument } from '../schemas/admin-credential.schema.js';
import { isStaffRole } from '../../../common/decorators/staff-access.decorator.js';
import { UserRole } from '../../../common/decorators/roles.decorator.js';

export interface JwtPayload {
  sub: string;
  mobile?: string;
  email?: string;
  roles: string[];
  sessionId?: string;
  staffRole?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectModel(AdminCredential.name)
    private readonly adminModel: Model<AdminCredentialDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_ACCESS_SECRET',
        'aslikaata_jwt_access_super_secret_key_2026_x98f2',
      ),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // The staff role (Super Admin / Yard Manager / ...) is read from the database on every
    // request, not trusted from the token, so changing or removing a staff member takes
    // effect immediately instead of when their token expires.
    let staffRole: string | undefined;
    if (Array.isArray(payload.roles) && payload.roles.includes(UserRole.ADMIN)) {
      const cred = await this.adminModel.findOne({ userId: payload.sub }).select('role').lean();
      if (cred && isStaffRole(cred.role)) staffRole = cred.role;
    }

    return {
      userId: payload.sub,
      mobile: payload.mobile,
      email: payload.email,
      roles: payload.roles,
      sessionId: payload.sessionId,
      staffRole,
    };
  }
}
