import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppNotification, AppNotificationSchema } from './schemas/notification.schema.js';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { DevicesController } from './devices.controller.js';
import { PushService } from './push.service.js';

@Module({
  // RealtimeModule is @Global, so RealtimeGateway is injectable here. ConfigModule is global too.
  imports: [
    MongooseModule.forFeature([
      { name: AppNotification.name, schema: AppNotificationSchema },
      { name: DeviceToken.name, schema: DeviceTokenSchema },
    ]),
  ],
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService, PushService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
