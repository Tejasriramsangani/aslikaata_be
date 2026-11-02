import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { DeviceToken, DeviceTokenDocument } from './schemas/device-token.schema.js';

/** Android notification channel created by the customer app. Must match the app's channel id. */
export const PICKUP_CHANNEL_ID = 'pickup_updates';

/** Tokens FCM reports as permanently dead (app uninstalled, token rotated). Safe to delete. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link data. FCM only accepts string values, so everything is stringified. */
  data?: Record<string, unknown>;
}

/**
 * Sends Firebase Cloud Messaging pushes to every device a user has registered.
 *
 * Credentials (first match wins):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  raw service-account JSON, or the same JSON base64-encoded
 *   GOOGLE_APPLICATION_CREDENTIALS path to the service-account file
 * With neither set, push is disabled and sends are logged and skipped (like the mock SMS provider),
 * so local development works without a Firebase project.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private messaging: Messaging | null | undefined;

  constructor(
    @InjectModel(DeviceToken.name)
    private readonly deviceModel: Model<DeviceTokenDocument>,
    private readonly config: ConfigService,
  ) {}

  private getMessaging(): Messaging | null {
    if (this.messaging !== undefined) return this.messaging;
    try {
      const app = this.initFirebase();
      this.messaging = app ? getMessaging(app) : null;
    } catch (err: any) {
      this.logger.error(`Firebase init failed, push disabled: ${err.message}`);
      this.messaging = null;
    }
    if (!this.messaging) {
      this.logger.warn('Push notifications disabled: no Firebase credentials configured.');
    }
    return this.messaging;
  }

  private initFirebase(): App | null {
    const existing = getApps()[0];
    if (existing) return existing;

    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (raw) {
      const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      return initializeApp({ credential: cert(JSON.parse(json)) });
    }
    if (this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS')) {
      // Application-default credentials are picked up from that file path.
      return initializeApp();
    }
    return null;
  }

  async registerToken(
    userId: string,
    input: { token: string; platform?: DeviceToken['platform']; appVersion?: string },
  ) {
    await this.deviceModel.findOneAndUpdate(
      { token: input.token },
      {
        $set: {
          userId,
          platform: input.platform,
          appVersion: input.appVersion ?? null,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    return { registered: true };
  }

  /** Only removes the token if it belongs to the caller, so one user cannot unregister another's device. */
  async unregisterToken(userId: string, token: string) {
    await this.deviceModel.deleteOne({ token, userId });
    return { unregistered: true };
  }

  /** Best-effort: never throws, so a push failure cannot break a business flow or retry an outbox event. */
  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    try {
      const messaging = this.getMessaging();
      if (!messaging) return;

      const devices = await this.deviceModel.find({ userId }).select('token');
      if (devices.length === 0) return;
      const tokens = devices.map((d) => d.token);

      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(message.data ?? {})) {
        if (v !== undefined && v !== null) data[k] = String(v);
      }

      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data,
        android: {
          priority: 'high',
          notification: { channelId: PICKUP_CHANNEL_ID },
        },
      });

      const dead: string[] = [];
      res.responses.forEach((r, i) => {
        if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) dead.push(tokens[i]);
      });
      if (dead.length) await this.deviceModel.deleteMany({ token: { $in: dead } });
      if (res.failureCount > dead.length) {
        this.logger.warn(`Push to ${userId}: ${res.failureCount - dead.length} send(s) failed`);
      }
    } catch (err: any) {
      this.logger.error(`Push to ${userId} failed: ${err.message}`);
    }
  }
}
