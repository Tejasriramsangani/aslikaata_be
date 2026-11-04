import { NotificationType } from './schemas/notification.schema.js';

export interface PlannedNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, any>;
}

export interface TemplateContext {
  /** Name of the picker assigned to the pickup, used in the "picker assigned" message. */
  employeeName?: string | null;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** '2026-11-05' -> '5 Nov 2026' (parsed as UTC so the day never shifts with server timezone). */
export function formatScheduledDate(ymd: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(ymd));
  if (!m) return str(ymd);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Pure mapping from an outbox domain event to the notifications (in-app inbox + push) it should produce
 * for CUSTOMERS, plus the two employee account events.
 *
 * Employee notifications for assigned / rescheduled / cancelled pickups are NOT here: OutboxService
 * already sends those from the single `pickup.status_changed` hook so every assignment path is covered.
 *
 * Actions a person took themselves produce no notification (a customer is not pushed about their own
 * cancel or reschedule).
 */
export function planNotifications(
  eventType: string,
  payload: Record<string, any>,
  ctx: TemplateContext = {},
): PlannedNotification[] {
  const customerId = str(payload.customerId);
  const code = str(payload.pickupCode);
  const link = { pickupId: str(payload.pickupId), pickupCode: code };
  const out: PlannedNotification[] = [];
  const toCustomer = (type: NotificationType, title: string, body: string) => {
    if (customerId) out.push({ userId: customerId, type, title, body, data: { ...link, type } });
  };
  const toUser = (userId: unknown, type: NotificationType, title: string, body: string) => {
    if (userId) out.push({ userId: str(userId), type, title, body, data: { type } });
  };

  switch (eventType) {
    case 'pickup.status_changed': {
      const reason = str(payload.reason).trim();

      if (payload.action === 'RESCHEDULED') {
        // Only admin-initiated moves (e.g. heavy crowd) are pushed to the customer.
        if (payload.actor === 'ADMIN') {
          const date = formatScheduledDate(payload.scheduledDate);
          const when = [date, str(payload.timeSlot)].filter(Boolean).join(', ');
          toCustomer(
            NotificationType.PICKUP_POSTPONED,
            'Your pickup has been postponed',
            `Sorry, your pickup ${code} is moved to ${when}.${reason ? ` Reason: ${reason}.` : ''}`,
          );
        }
        break;
      }

      switch (payload.toStatus) {
        case 'ASSIGNED': {
          const who = str(ctx.employeeName).trim();
          toCustomer(
            NotificationType.PICKUP_ASSIGNED,
            'Picker assigned',
            `${who || 'A picker'} is assigned to your pickup ${code} and will be ready to come soon.`,
          );
          break;
        }
        case 'SETTLED':
          toCustomer(
            NotificationType.PAYMENT_RECORDED,
            'Payment recorded',
            `Your payment for pickup ${code} is recorded. Open the app and tell the picker your completion code to finish.`,
          );
          break;
        case 'ON_THE_WAY': {
          const who = str(ctx.employeeName).trim();
          toCustomer(
            NotificationType.PICKUP_ON_THE_WAY,
            'Picker is on the way',
            `${who || 'Your picker'} has started for pickup ${code}. Please keep your scrap ready.`,
          );
          break;
        }
        case 'ARRIVED': {
          const who = str(ctx.employeeName).trim();
          toCustomer(
            NotificationType.PICKUP_ARRIVED,
            'Your pickup executive is nearby',
            `${who || 'Your pickup executive'} is here for pickup ${code}. Open the app and show your pickup QR code to continue.`,
          );
          break;
        }
        case 'COMPLETED':
          toCustomer(NotificationType.PICKUP_COMPLETED, 'Pickup completed', `Pickup ${code} is complete. Thank you!`);
          break;
        case 'FAILED':
          toCustomer(
            NotificationType.PICKUP_FAILED,
            'Pickup could not be completed',
            `We could not complete pickup ${code}.${reason ? ` Reason: ${reason}.` : ''}`,
          );
          break;
        case 'CANCELLED':
          if (payload.actorRole !== 'CUSTOMER') {
            toCustomer(
              NotificationType.PICKUP_CANCELLED,
              'Pickup cancelled',
              `Pickup ${code} was cancelled.${reason ? ` Reason: ${reason}.` : ''}`,
            );
          }
          break;
      }
      break;
    }

    case 'summary.ready': {
      const rupees = Number(payload.totalAmount) / 100;
      toCustomer(
        NotificationType.SUMMARY_READY,
        'Review your pickup summary',
        Number.isFinite(rupees)
          ? `Your pickup ${code} total is ₹${rupees.toFixed(2)}. Review it, and if you agree, share your code with the executive.`
          : `Your pickup ${code} summary is ready. Review it, and if you agree, share your code with the executive.`,
      );
      break;
    }

    case 'employee.approved':
      toUser(
        payload.employeeUserId,
        NotificationType.ACCOUNT_APPROVED,
        'Account approved',
        'Your account is approved. You can now receive pickups.',
      );
      break;

    case 'employee.document_rejected':
      toUser(
        payload.employeeUserId,
        NotificationType.GENERAL,
        'Document rejected',
        `Your ${str(payload.docType).replace(/_/g, ' ').toLowerCase()} was rejected${
          payload.rejectionReason ? `: ${str(payload.rejectionReason)}` : '.'
        } Please upload it again.`,
      );
      break;
  }

  return out;
}
