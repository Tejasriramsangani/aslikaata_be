import { Controller, Get, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import {
  MAX_PHOTO_MB,
  MAX_PICKUP_PHOTOS,
  isCloudinaryConfigured,
  signPhotoUpload,
} from '../../common/utils/cloudinary.util.js';

@Controller('api/v1/uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER, UserRole.EMPLOYEE)
export class UploadsController {
  /** Whether photo upload is set up on the server, so the apps can hide the option when it is not. */
  @Get('config')
  config() {
    return { enabled: isCloudinaryConfigured(), maxPhotos: MAX_PICKUP_PHOTOS, maxMb: MAX_PHOTO_MB };
  }

  /** A short-lived signed permission to upload one image to Cloudinary. */
  @Post('sign')
  sign() {
    const signed = signPhotoUpload();
    if (!signed) {
      throw new ServiceUnavailableException({
        message: 'Photo upload is not set up yet.',
        details: { code: 'UPLOADS_NOT_CONFIGURED' },
      });
    }
    return signed;
  }
}
