/**
 * What is and is not set up for WhatsApp messages, worked out from the backend .env. Used for the one-line
 * summary logged at startup so a missing template ID shows up immediately instead of messages silently not
 * being sent.
 */
export interface WhatsappSetupReport {
  /** Fast2SMS is the provider and the WhatsApp channel is selected. */
  channelOn: boolean;
  /** Login OTP can go out (key, sender and OTP template are all set). */
  otpReady: boolean;
  /** Customer updates (booked, assigned, cancelled, paid) switched on and allowed to start. */
  customerUpdatesOn: boolean;
  /** Settings that stop messages from going out, as .env variable names. */
  missing: string[];
}

/** Message type -> the .env variable holding its Fast2SMS template ID. */
export const WHATSAPP_TEMPLATE_VARIABLES: Record<string, string> = {
  'Pickup request received': 'FAST2SMS_WA_PICKUP_REQUEST_RECEIVED_TEMPLATE_ID',
  'Pickup confirmed': 'FAST2SMS_WA_PICKUP_CONFIRMED_TEMPLATE_ID',
  'Employee assigned': 'FAST2SMS_WA_EMPLOYEE_ASSIGNED_TEMPLATE_ID',
  'Pickup cancelled': 'FAST2SMS_WA_PICKUP_CANCELLED_TEMPLATE_ID',
  'Payment completed': 'FAST2SMS_WA_PICKUP_COMPLETED_PAYMENT_TEMPLATE_ID',
  'Picker approved': 'FAST2SMS_WA_PICKER_APPROVED_TEMPLATE_ID',
  'Picker rejected': 'FAST2SMS_WA_PICKER_REJECTED_TEMPLATE_ID',
};

export function whatsappSetupReport(get: (key: string) => string | undefined): WhatsappSetupReport {
  const value = (key: string) => (get(key) ?? '').trim();
  const channelOn = value('SMS_PROVIDER') === 'fast2sms' && value('FAST2SMS_CHANNEL').toLowerCase() === 'whatsapp';
  if (!channelOn) return { channelOn: false, otpReady: false, customerUpdatesOn: false, missing: [] };

  const missing: string[] = [];
  // Login OTP can use the main Fast2SMS key; customer updates insist on a dedicated WhatsApp key.
  const otpKey = value('FAST2SMS_WA_API_KEY') || value('FAST2SMS_API_KEY');
  const waKey = value('FAST2SMS_WA_API_KEY');
  if (!otpKey) missing.push('FAST2SMS_API_KEY (or FAST2SMS_WA_API_KEY)');
  if (!value('FAST2SMS_WA_PHONE_NUMBER_ID')) missing.push('FAST2SMS_WA_PHONE_NUMBER_ID');
  if (!value('FAST2SMS_WA_OTP_TEMPLATE_ID')) missing.push('FAST2SMS_WA_OTP_TEMPLATE_ID');
  const otpReady = missing.length === 0;

  const updatesFlag = value('FAST2SMS_WA_NOTIFICATIONS_ENABLED') === 'true';
  const sinceOk = Number.isFinite(Date.parse(value('FAST2SMS_WA_NOTIFICATIONS_SINCE')));
  if (!waKey) missing.push('FAST2SMS_WA_API_KEY (needed for customer updates)');
  if (!updatesFlag) missing.push('FAST2SMS_WA_NOTIFICATIONS_ENABLED=true');
  if (!sinceOk) missing.push('FAST2SMS_WA_NOTIFICATIONS_SINCE (a date like 2026-11-11T00:00:00Z)');
  for (const variable of Object.values(WHATSAPP_TEMPLATE_VARIABLES)) {
    if (!value(variable)) missing.push(variable);
  }
  return { channelOn: true, otpReady, customerUpdatesOn: updatesFlag && sinceOk && !!waKey, missing };
}
