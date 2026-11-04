/**
 * How many pickups one employee can be given for a single day. Beyond this the employee shows as
 * "Busy" for that date on the admin assign screen and the server refuses another assignment.
 * Override with MAX_PICKUPS_PER_EMPLOYEE_PER_DAY in .env.
 */
export const DEFAULT_MAX_PICKUPS_PER_EMPLOYEE_PER_DAY = 3;

export function maxPickupsPerEmployeePerDay(): number {
  const parsed = Number(process.env.MAX_PICKUPS_PER_EMPLOYEE_PER_DAY);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PICKUPS_PER_EMPLOYEE_PER_DAY;
}
