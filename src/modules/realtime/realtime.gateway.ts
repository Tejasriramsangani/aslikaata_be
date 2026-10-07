import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

import { UserRole } from '../../common/decorators/roles.decorator.js';
import type { JwtPayload } from '../identity/strategies/jwt.strategy.js';

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: {
      userId: string;
      mobile?: string;
      email?: string;
      roles: string[];
      sessionId?: string;
    };
  };
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Initializes Redis pub/sub adapter when Redis configuration is present (Task 6.1.1).
   * Gracefully falls back to default in-memory adapter for local dev / testing.
   */
  async afterInit(server: Server) {
    const redisHost = this.configService.get<string>('REDIS_HOST');
    const redisPort = this.configService.get<number>('REDIS_PORT');
    const redisUrl = this.configService.get<string>('REDIS_URL');

    if (redisUrl || (redisHost && redisPort)) {
      let pubClient: Redis | null = null;
      let subClient: Redis | null = null;
      try {
        const redisOptions = {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null, // Do not infinite retry if Redis is offline
        };

        pubClient = redisUrl
          ? new Redis(redisUrl, redisOptions)
          : new Redis({ host: redisHost, port: Number(redisPort), ...redisOptions });
        
        // Prevent unhandled error event noise
        pubClient.on('error', () => {});

        await pubClient.connect();
        subClient = pubClient.duplicate();
        subClient.on('error', () => {});
        await subClient.connect();

        server.adapter(createAdapter(pubClient, subClient));
        this.logger.log('Redis Pub/Sub adapter successfully mounted for multi-instance Socket.IO');
      } catch (err: any) {
        pubClient?.disconnect();
        subClient?.disconnect();
        this.logger.warn(`Redis connection failed (${err.message}). Continuing with in-memory adapter.`);
      }
    } else {
      this.logger.log('No REDIS_URL or REDIS_HOST provided. RealtimeGateway using in-memory adapter.');
    }
  }

  /**
   * Sockets authenticate with the exact same JWT as the REST API (Section 8 / Task 6.1.2).
   */
  async handleConnection(client: AuthenticatedSocket) {
    try {
      const authHeader =
        client.handshake.auth?.token || client.handshake.headers?.authorization;

      if (!authHeader) {
        this.logger.warn(`Socket connection rejected: No auth token provided (socket id: ${client.id})`);
        client.disconnect();
        return;
      }

      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      const secret = this.configService.get<string>(
        'JWT_ACCESS_SECRET',
        'aslikaata_jwt_access_super_secret_key_2026_x98f2',
      );

      const decoded = this.jwtService.verify<JwtPayload>(token, { secret });
      client.data.user = {
        userId: decoded.sub,
        mobile: decoded.mobile,
        email: decoded.email,
        roles: decoded.roles,
        sessionId: decoded.sessionId,
      };

      const { userId, roles } = client.data.user;

      // Task 6.1.3: Strict room membership
      // Join default user-specific room: user:{id}
      client.join(`user:${userId}`);

      // If employee, join employee room: employee:{id}
      if (roles.includes(UserRole.EMPLOYEE)) {
        client.join(`employee:${userId}`);
      }

      // If admin, join admin queue and dashboard rooms: admin:queue, admin:dashboard
      if (roles.includes(UserRole.ADMIN)) {
        client.join('admin:queue');
        client.join('admin:dashboard');
      }

      this.logger.log(`Socket connected & authenticated: ${client.id} (User: ${userId}, Roles: ${roles.join(',')})`);
    } catch (err: any) {
      this.logger.warn(`Socket authentication failed for ${client.id}: ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  /**
   * Client requests to join a pickup room (pickup:{id}) (Task 6.1.3).
   * Verified by authentication context.
   */
  @SubscribeMessage('join_pickup_room')
  handleJoinPickupRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { pickupId: string },
  ) {
    if (!client.data.user) {
      return { success: false, error: 'Unauthorized' };
    }
    if (!data?.pickupId) {
      return { success: false, error: 'pickupId is required' };
    }

    const roomName = `pickup:${data.pickupId}`;
    client.join(roomName);
    this.logger.log(`User ${client.data.user.userId} joined room ${roomName}`);
    return { success: true, room: roomName };
  }

  @SubscribeMessage('leave_pickup_room')
  handleLeavePickupRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { pickupId: string },
  ) {
    if (data?.pickupId) {
      const roomName = `pickup:${data.pickupId}`;
      client.leave(roomName);
      return { success: true, room: roomName };
    }
    return { success: false };
  }

  // --- Task 6.2.1: Real-time Event Broadcasters ---

  emitToPickup(pickupId: string, event: string, payload: any) {
    if (this.server) {
      this.server.to(`pickup:${pickupId}`).emit(event, payload);
    }
  }

  emitToUser(userId: string, event: string, payload: any) {
    if (this.server) {
      this.server.to(`user:${userId}`).emit(event, payload);
    }
  }

  emitToEmployee(employeeUserId: string, event: string, payload: any) {
    if (this.server) {
      this.server.to(`employee:${employeeUserId}`).emit(event, payload);
    }
  }

  emitToAdminQueue(event: string, payload: any) {
    if (this.server) {
      this.server.to('admin:queue').emit(event, payload);
    }
  }

  emitToAdminDashboard(event: string, payload: any) {
    if (this.server) {
      this.server.to('admin:dashboard').emit(event, payload);
    }
  }

  /**
   * Broadcasts live employee GPS location:
   * Dispatched to customer only while ON_THE_WAY, and always to admin dashboard (Section 8).
   */
  emitEmployeeLocation(pickupId: string, locationData: any) {
    if (this.server) {
      this.server.to(`pickup:${pickupId}`).emit('employee.location', locationData);
      this.server.to('admin:dashboard').emit('employee.location', { pickupId, ...locationData });
    }
  }

  notifyPickupStatusChanged(pickupId: string, newStatus: string, message?: string) {
    if (this.server) {
      this.server.to(`pickup:${pickupId}`).emit('pickup.status_changed', { pickupId, newStatus, message });
      this.server.to('admin:dashboard').emit('pickup.status_changed', { pickupId, newStatus, message });
    }
  }

  notifyUnassignedAlert(pickupCode: string, reason: string) {
    if (this.server) {
      this.server.to('admin:queue').emit('pickup.unassigned', { pickupCode, reason, alertAt: new Date() });
      this.server.to('admin:dashboard').emit('pickup.unassigned', { pickupCode, reason, alertAt: new Date() });
    }
  }
}
