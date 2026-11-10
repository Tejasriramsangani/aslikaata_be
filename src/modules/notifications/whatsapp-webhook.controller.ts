import { BadRequestException, Body, Controller, Headers, HttpCode, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { WhatsappNotificationsService } from './whatsapp-notifications.service.js';

@Controller('api/v1/webhooks/fast2sms/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly config: ConfigService, private readonly whatsapp: WhatsappNotificationsService) {}
  @Post()
  @HttpCode(200)
  async receive(@Headers('webhook_secret_key') supplied: string | undefined, @Body() body: Record<string, unknown>) {
    const secret = this.config.get<string>('FAST2SMS_WA_WEBHOOK_SECRET', '');
    if (this.config.get('FAST2SMS_WA_WEBHOOK_ENABLED') !== 'true' || secret.length < 32) throw new ServiceUnavailableException('Webhook disabled');
    if (typeof supplied !== 'string' || supplied.length > 512 || !timingSafeEqual(
      createHash('sha256').update(supplied).digest(), createHash('sha256').update(secret).digest())) throw new UnauthorizedException();
    if (!body || typeof body.request_id !== 'string' || !/^[\w-]{1,200}$/.test(body.request_id) ||
        !['sent', 'delivered', 'read', 'failed'].includes(String(body.status))) throw new BadRequestException('Invalid delivery callback');
    if (body.udf1 && (typeof body.udf1 !== 'string' || !/^[a-f\d]{24}$/i.test(body.udf1))) throw new BadRequestException('Invalid callback correlation');
    // Ignore sender/recipient/body fields: retain only provider correlation and delivery state.
    if (body.udf1) await this.whatsapp.recordDelivery(body.request_id, String(body.status), body.udf1 as string);
    else await this.whatsapp.recordDelivery(body.request_id, String(body.status));
    return { received: true };
  }
}
