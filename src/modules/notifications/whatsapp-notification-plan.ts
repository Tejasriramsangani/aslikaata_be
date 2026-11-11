import type { TextTemplateKey } from '../identity/sms/sms.interface.js';

export type CustomerWhatsappKey = Exclude<TextTemplateKey, 'PICKER_APPROVED' | 'PICKER_REJECTED'>;
/** Only canonical persisted domain transitions. Never use duplicate pickup.assigned side events. */
export function whatsappKeysForEvent(type: string, payload: Record<string, unknown>): CustomerWhatsappKey[] {
  if (type === 'pickup.requested') return ['PICKUP_REQUEST_RECEIVED'];
  if (type === 'pickup.completed' || type === 'settlement.completed') return ['PICKUP_COMPLETED_PAYMENT'];
  if (type !== 'pickup.status_changed' || !payload.fromStatus || payload.fromStatus === payload.toStatus) return [];
  if (payload.toStatus === 'ASSIGNED') return ['PICKUP_CONFIRMED', 'EMPLOYEE_ASSIGNED'];
  if (payload.toStatus === 'CANCELLED') return ['PICKUP_CANCELLED'];
  if (payload.toStatus === 'COMPLETED' || payload.toStatus === 'SETTLED') return ['PICKUP_COMPLETED_PAYMENT'];
  // SCHEDULED is automatic during request creation; CUSTOMER_CONFIRMED approves weighing, not a booking.
  return [];
}

export function whatsappVariables(key: CustomerWhatsappKey, pickup: any, name: string, settlement?: any): string[] | null {
  const base = [name, pickup.pickupCode];
  if (base.some(value => typeof value !== 'string' || !value.trim() || value.length > 500)) return null;
  const terminal = ['CANCELLED', 'FAILED', 'COMPLETED'];
  switch (key) {
    case 'PICKUP_REQUEST_RECEIVED':
      return terminal.includes(pickup.status) ? null : base;
    case 'PICKUP_CONFIRMED': {
      if (!pickup.assignment || terminal.includes(pickup.status)) return null;
      const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pickup.scheduledDate || '');
      const time = pickup.timeSlotSnapshot?.displayLabel;
      return date && typeof time === 'string' && time.trim() ? [...base, `${date[3]}/${date[2]}/${date[1]}`, time] : null;
    }
    case 'EMPLOYEE_ASSIGNED': {
      const employee = pickup.assignment?.employeeName;
      return !terminal.includes(pickup.status) && typeof employee === 'string' && employee.trim() ? [...base, employee] : null;
    }
    case 'PICKUP_CANCELLED':
      return pickup.status === 'CANCELLED' ? base : null;
    case 'PICKUP_COMPLETED_PAYMENT': {
      const weight = pickup.totals?.netWeightGrams, amount = settlement?.amount;
      if (pickup.status !== 'COMPLETED' || settlement?.status !== 'COMPLETED' ||
          !['CASH', 'UPI'].includes(settlement.type) || !Number.isFinite(weight) || weight <= 0 ||
          !Number.isSafeInteger(amount) || amount < 0 || amount !== pickup.totals?.totalAmount) return null;
      // The approved template already prints the units: "Scrap Weight: {{3}} kg" and "Amount Paid: Rs. {{4}}".
      // So send plain numbers here, or the customer would read "12.500 kg kg" and "Rs. INR 250.50".
      return [...base, (weight / 1000).toFixed(3), (amount / 100).toFixed(2), settlement.type];
    }
  }
}
