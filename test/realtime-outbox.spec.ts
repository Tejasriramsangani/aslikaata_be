import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway.js';
import { OutboxService } from '../src/modules/outbox/outbox.service.js';
import { OutboxController } from '../src/modules/outbox/outbox.controller.js';
import { OutboxStatus } from '../src/common/outbox/outbox-event.schema.js';
import { PickupStatus } from '../src/modules/pickups/schemas/pickup-status.enum.js';
import { UserRole } from '../src/common/decorators/roles.decorator.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Phase 6: Real-Time Sockets, Outbox Worker & GPS Streaming', () => {
  let mockJwtService: any;
  let mockConfigService: any;
  let gateway: RealtimeGateway;

  beforeEach(() => {
    mockJwtService = {
      verify: vi.fn(),
    };
    mockConfigService = {
      get: vi.fn().mockImplementation((key: string, defaultVal: any) => defaultVal),
    };
    gateway = new RealtimeGateway(mockJwtService, mockConfigService);
    gateway.server = {
      to: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
    } as any;
  });

  describe('6.1 RealtimeGateway & Socket Authentication', () => {
    it('Task 6.1.2: should reject socket connection if no token is provided', async () => {
      const mockSocket: any = {
        id: 'sock-1',
        handshake: { auth: {}, headers: {} },
        disconnect: vi.fn(),
      };

      await gateway.handleConnection(mockSocket);
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('Task 6.1.2 & 6.1.3: should authenticate valid JWT and join appropriate rooms based on roles', async () => {
      const mockSocket: any = {
        id: 'sock-2',
        handshake: { auth: { token: 'Bearer valid-token' } },
        data: {},
        join: vi.fn(),
        disconnect: vi.fn(),
      };

      mockJwtService.verify.mockReturnValue({
        sub: 'emp-user-123',
        roles: [UserRole.EMPLOYEE],
        sessionId: 'sess-abc',
      });

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      expect(mockSocket.join).toHaveBeenCalledWith('user:emp-user-123');
      expect(mockSocket.join).toHaveBeenCalledWith('employee:emp-user-123');
      expect(mockSocket.join).not.toHaveBeenCalledWith('admin:queue');
    });

    it('Task 6.1.3: should join admin rooms for admin role', async () => {
      const mockSocket: any = {
        id: 'sock-3',
        handshake: { auth: { token: 'Bearer admin-token' } },
        data: {},
        join: vi.fn(),
        disconnect: vi.fn(),
      };

      mockJwtService.verify.mockReturnValue({
        sub: 'admin-user-1',
        roles: [UserRole.ADMIN],
      });

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith('user:admin-user-1');
      expect(mockSocket.join).toHaveBeenCalledWith('admin:queue');
      expect(mockSocket.join).toHaveBeenCalledWith('admin:dashboard');
    });

    it('Task 6.1.3: should handle join_pickup_room', () => {
      const mockSocket: any = {
        data: { user: { userId: 'cust-1' } },
        join: vi.fn(),
      };

      const res = gateway.handleJoinPickupRoom(mockSocket, { pickupId: 'pick-100' });
      expect(res.success).toBe(true);
      expect(mockSocket.join).toHaveBeenCalledWith('pickup:pick-100');
    });
  });

  describe('6.2 GPS Streaming Guard (Section 8)', () => {
    let mockPickupModel: any;
    let mockEmployeeProfileModel: any;
    let mockOutboxService: any;
    let controller: OutboxController;

    beforeEach(() => {
      mockPickupModel = {
        findById: vi.fn(),
      };
      mockEmployeeProfileModel = {
        findOne: vi.fn(),
      };
      mockOutboxService = {
        listEvents: vi.fn(),
        processPendingEvents: vi.fn(),
      };
      controller = new OutboxController(
        mockOutboxService,
        gateway,
        mockPickupModel,
        mockEmployeeProfileModel,
      );
    });

    it('Task 6.2.1: should allow GPS stream when pickup is strictly ON_THE_WAY', async () => {
      const mockEmployee = { _id: 'emp-prof-1', fullName: 'Ramesh Patel' };
      const mockPickup = { _id: 'p-1', status: PickupStatus.ON_THE_WAY };

      mockEmployeeProfileModel.findOne.mockResolvedValue(mockEmployee);
      mockPickupModel.findById.mockResolvedValue(mockPickup);

      const emitSpy = vi.spyOn(gateway, 'emitEmployeeLocation');

      const res = await controller.reportEmployeeLocation(
        { userId: 'u-emp', roles: [UserRole.EMPLOYEE] },
        'p-1',
        { latitude: 19.076, longitude: 72.8777, speed: 25, heading: 90 },
      );

      expect(res.success).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith('p-1', expect.objectContaining({
        employeeName: 'Ramesh Patel',
        coordinates: [72.8777, 19.076],
        speed: 25,
      }));
    });

    it('Task 6.2.1: should reject GPS streaming if pickup status is NOT ON_THE_WAY', async () => {
      const mockEmployee = { _id: 'emp-prof-1', fullName: 'Ramesh Patel' };
      const mockPickup = { _id: 'p-1', status: PickupStatus.ARRIVED };

      mockEmployeeProfileModel.findOne.mockResolvedValue(mockEmployee);
      mockPickupModel.findById.mockResolvedValue(mockPickup);

      await expect(
        controller.reportEmployeeLocation(
          { userId: 'u-emp', roles: [UserRole.EMPLOYEE] },
          'p-1',
          { latitude: 19.076, longitude: 72.8777 },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('6.3 Outbox Worker & Scheduled Processing', () => {
    let mockOutboxModel: any;
    let outboxService: OutboxService;

    beforeEach(() => {
      mockOutboxModel = {
        create: vi.fn(),
        find: vi.fn(),
      };
      outboxService = new OutboxService(mockOutboxModel, gateway);
    });

    it('Task 6.3.1: should create outbox event in PENDING status', async () => {
      mockOutboxModel.create.mockResolvedValue([
        {
          _id: 'evt-1',
          eventType: 'pickup.requested',
          payload: { pickupId: 'p-1' },
          status: OutboxStatus.PENDING,
          retryCount: 0,
        },
      ]);

      const event = await outboxService.createEvent('pickup.requested', { pickupId: 'p-1' });
      expect(event.eventType).toBe('pickup.requested');
      expect(event.status).toBe(OutboxStatus.PENDING);
    });

    it('Task 6.3.1: should process pending events and mark them PUBLISHED', async () => {
      const mockEvent = {
        _id: 'evt-1',
        eventType: 'pickup.status_changed',
        payload: { pickupId: 'p-1', toStatus: 'ON_THE_WAY' },
        status: OutboxStatus.PENDING,
        retryCount: 0,
        save: vi.fn().mockResolvedValue(true),
      };

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockEvent]),
      };
      mockOutboxModel.find.mockReturnValue(mockQuery);

      const emitSpy = vi.spyOn(gateway, 'emitToPickup');

      const result = await outboxService.processPendingEvents();

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockEvent.status).toBe(OutboxStatus.PUBLISHED);
      expect(emitSpy).toHaveBeenCalledWith('p-1', 'pickup.status_changed', mockEvent.payload);
    });

    it('Task 6.3.1: should increment retryCount on processing error and retry up to 5 times', async () => {
      const failingEvent = {
        _id: 'evt-fail',
        eventType: 'unsupported.event',
        payload: null,
        status: OutboxStatus.PENDING,
        retryCount: 1,
        save: vi.fn().mockResolvedValue(true),
      };

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([failingEvent]),
      };
      mockOutboxModel.find.mockReturnValue(mockQuery);

      // Force an error inside dispatchEvent
      vi.spyOn(gateway as any, 'emitToPickup').mockImplementation(() => {
        throw new Error('Socket pipe broken');
      });

      const result = await outboxService.processPendingEvents();

      expect(result.failed).toBe(1);
      expect(failingEvent.retryCount).toBe(2);
      expect(failingEvent.status).toBe(OutboxStatus.PENDING); // Still retrying
    });

    it('Task 6.3.1: should transition to FAILED status when retryCount reaches 5', async () => {
      const maxRetryEvent = {
        _id: 'evt-fail-max',
        eventType: 'pickup.status_changed',
        payload: { pickupId: 'p-x' },
        status: OutboxStatus.PENDING,
        retryCount: 4,
        save: vi.fn().mockResolvedValue(true),
      };

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([maxRetryEvent]),
      };
      mockOutboxModel.find.mockReturnValue(mockQuery);

      vi.spyOn(gateway, 'emitToPickup').mockImplementation(() => {
        throw new Error('Persistent failure');
      });

      const result = await outboxService.processPendingEvents();

      expect(result.failed).toBe(1);
      expect(maxRetryEvent.retryCount).toBe(5);
      expect(maxRetryEvent.status).toBe(OutboxStatus.FAILED);
    });
  });
});
