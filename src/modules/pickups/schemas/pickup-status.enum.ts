export enum PickupStatus {
  REQUESTED = 'REQUESTED',
  SCHEDULED = 'SCHEDULED',
  ASSIGNED = 'ASSIGNED',
  ON_THE_WAY = 'ON_THE_WAY',
  ARRIVED = 'ARRIVED',
  VERIFIED = 'VERIFIED',
  IN_PROGRESS = 'IN_PROGRESS',
  MEASURED = 'MEASURED',
  SUMMARY_READY = 'SUMMARY_READY',
  CUSTOMER_CONFIRMED = 'CUSTOMER_CONFIRMED',
  SETTLED = 'SETTLED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  OTP_VERIFIED = 'OTP_VERIFIED',
  INVOICED = 'INVOICED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum SettlementPreference {
  CASH = 'CASH',
  UPI = 'UPI',
  DONATE = 'DONATE',
}

/**
 * Customer-facing stage mapping per Section 6.
 */
export function getCustomerFacingStatus(status: PickupStatus): string {
  switch (status) {
    case PickupStatus.REQUESTED:
      return 'Requested';
    case PickupStatus.SCHEDULED:
      return 'Scheduled';
    case PickupStatus.ASSIGNED:
      return 'Employee Assigned';
    case PickupStatus.ON_THE_WAY:
      return 'On the Way';
    case PickupStatus.ARRIVED:
      return 'Arrived';
    case PickupStatus.VERIFIED:
    case PickupStatus.IN_PROGRESS:
    case PickupStatus.MEASURED:
    case PickupStatus.SUMMARY_READY:
    case PickupStatus.CUSTOMER_CONFIRMED:
    case PickupStatus.SETTLED:
    case PickupStatus.PAYMENT_PENDING:
      return 'Ongoing';
    case PickupStatus.OTP_VERIFIED:
    case PickupStatus.INVOICED:
    case PickupStatus.COMPLETED:
      return 'Completed';
    case PickupStatus.CANCELLED:
      return 'Cancelled';
    case PickupStatus.FAILED:
      return 'Failed';
    default:
      return status;
  }
}
