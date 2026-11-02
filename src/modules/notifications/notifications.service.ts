import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  AppNotification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { PushService } from './push.service.js';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(AppNotification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly pushService: PushService,
  ) {}

  private toView(n: NotificationDocument) {
    return {
      id: n._id.toString(),
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data || {},
      readAt: n.readAt ?? null,
      createdAt: (n as any).createdAt as Date,
    };
  }

  /** Stores the notification and pushes it live to the user's open apps. Never throws. */
  async notify(input: NewNotification) {
    try {
      if (!isValidObjectId(input.userId)) return null;
      const doc = await this.notificationModel.create({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data || {},
      });
      const view = this.toView(doc);
      this.realtimeGateway.emitToUser(input.userId, 'notification.new', view);
      // Push covers users whose app is closed; it is best-effort and never throws.
      await this.pushService.sendToUser(input.userId, {
        title: input.title,
        body: input.body,
        data: { ...input.data, notificationId: view.id },
      });
      return view;
    } catch (err: any) {
      this.logger.error(`Could not create notification for ${input.userId}: ${err.message}`);
      return null;
    }
  }

  async list(userId: string, opts: { limit?: number; unreadOnly?: boolean } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 100);
    const filter: Record<string, any> = { userId };
    if (opts.unreadOnly) filter.readAt = null;
    const [items, unreadCount] = await Promise.all([
      this.notificationModel.find(filter).sort({ createdAt: -1 }).limit(limit),
      this.notificationModel.countDocuments({ userId, readAt: null }),
    ]);
    return { items: items.map((n) => this.toView(n)), unreadCount };
  }

  async unreadCount(userId: string) {
    return { unreadCount: await this.notificationModel.countDocuments({ userId, readAt: null }) };
  }

  async markRead(userId: string, id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('Notification not found');
    const n = await this.notificationModel.findOneAndUpdate(
      { _id: id, userId, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!n) {
      // Already read (or not theirs): only 404 when it does not exist for this user at all.
      const exists = await this.notificationModel.exists({ _id: id, userId });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return this.unreadCount(userId);
  }

  async markAllRead(userId: string) {
    await this.notificationModel.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
    return { unreadCount: 0 };
  }
}
