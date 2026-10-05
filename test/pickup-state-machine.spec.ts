import { describe, it, expect, vi } from 'vitest';
import { PickupStateMachineService } from '../src/modules/pickups/pickup-state-machine.service.js';
import { PickupStatus } from '../src/modules/pickups/schemas/pickup-status.enum.js';
import { UserRole } from '../src/common/decorators/roles.decorator.js';

describe('PickupStateMachineService', () => {
  const mockEventModel = {
    create: vi.fn().mockResolvedValue({}),
  };

  const stateMachine = new PickupStateMachineService(mockEventModel as any);

  const createMockPickup = (status: PickupStatus, assignment?: any) =>
    ({
      _id: 'pickup123',
      pickupCode: 'AK-10001',
      status,
      assignment: assignment || null,
      timestamps: {},
      save: vi.fn().mockResolvedValue(true),
    }) as any;

  it('should allow valid transitions: REQUESTED -> SCHEDULED by ADMIN or SYSTEM', () => {
    const pickup = createMockPickup(PickupStatus.REQUESTED);

    expect(() =>
      stateMachine.validateTransition({
        pickup,
        toStatus: PickupStatus.SCHEDULED,
        actor: { userId: 'admin1', role: UserRole.ADMIN },
      }),
    ).not.toThrow();
  });

  it('should reject invalid jumps: REQUESTED -> COMPLETED', () => {
    const pickup = createMockPickup(PickupStatus.REQUESTED);

    expect(() =>
      stateMachine.validateTransition({
        pickup,
        toStatus: PickupStatus.COMPLETED,
        actor: { userId: 'admin1', role: UserRole.ADMIN },
      }),
    ).toThrow('Invalid status transition');
  });

  it('should reject non-admin from assigning an employee', () => {
    const pickup = createMockPickup(PickupStatus.SCHEDULED);

    expect(() =>
      stateMachine.validateTransition({
        pickup,
        toStatus: PickupStatus.ASSIGNED,
        actor: { userId: 'cust1', role: UserRole.CUSTOMER },
      }),
    ).toThrow('Only operations admin can assign employees');
  });

  it('should allow customer cancellation before ON_THE_WAY with reason', () => {
    const pickup = createMockPickup(PickupStatus.SCHEDULED);

    expect(() =>
      stateMachine.validateTransition({
        pickup,
        toStatus: PickupStatus.CANCELLED,
        actor: { userId: 'cust1', role: UserRole.CUSTOMER },
        reason: 'Change of plans',
      }),
    ).not.toThrow();
  });

  it('should reject cancellation without a reason', () => {
    const pickup = createMockPickup(PickupStatus.SCHEDULED);

    expect(() =>
      stateMachine.validateTransition({
        pickup,
        toStatus: PickupStatus.CANCELLED,
        actor: { userId: 'cust1', role: UserRole.CUSTOMER },
      }),
    ).toThrow('A reason is required to cancel a pickup');
  });

  it('should prevent customer from cancelling once employee is ON_THE_WAY', () => {
    const pickup = createMockPickup(PickupStatus.ON_THE_WAY);

    expect(() =>
      stateMachine.validateTransition({
        pickup,
        toStatus: PickupStatus.CANCELLED,
        actor: { userId: 'cust1', role: UserRole.CUSTOMER },
        reason: 'Cancel please',
      }),
    ).toThrow('Pickup cannot be cancelled by customer once the employee is on the way');
  });

  it('should allow admin to cancel even if employee is ON_THE_WAY with reason', () => {
    const pickup = createMockPickup(PickupStatus.ON_THE_WAY);

    expect(() =>
      stateMachine.validateTransition({
        pickup,
        toStatus: PickupStatus.CANCELLED,
        actor: { userId: 'admin1', role: UserRole.ADMIN },
        reason: 'Customer emergency reported via hotline',
      }),
    ).not.toThrow();
  });
});
