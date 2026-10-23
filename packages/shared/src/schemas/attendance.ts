import { z } from 'zod';
import { DateSchema, DayTypeSchema } from './common';

const Hours = z.number().min(0).max(24);
const Minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);

export const LeaveTypeSchema = z.enum(['sil', 'maternity', 'paternity', 'solo_parent', 'unpaid']);
export type LeaveType = z.infer<typeof LeaveTypeSchema>;

/** One DTR row: one employee, one date. Day type is derived from the holiday calendar and rest days. */
export const AttendanceEntryInputSchema = z
  .object({
    employeeId: z.uuid(),
    date: DateSchema,
    /** Override when the calendar is not enough (e.g. the employee's rest day was moved). */
    dayTypeOverride: DayTypeSchema.nullable(),
    regularHours: Hours,
    otHours: Hours,
    ndHours: Hours,
    ndOtHours: Hours,
    tardyMinutes: Minutes,
    undertimeMinutes: Minutes,
    absent: z.boolean(),
    leaveType: LeaveTypeSchema.nullable(),
    notes: z.string().max(300).nullable(),
  })
  .refine((e) => e.ndHours <= e.regularHours, {
    message: 'Night-diff hours cannot exceed regular hours',
    path: ['ndHours'],
  })
  .refine((e) => e.ndOtHours <= e.otHours, {
    message: 'Night-diff OT hours cannot exceed OT hours',
    path: ['ndOtHours'],
  })
  .refine((e) => !(e.absent && e.leaveType !== null), {
    message: 'A day is either absent or on leave, not both',
    path: ['leaveType'],
  });
export type AttendanceEntryInput = z.infer<typeof AttendanceEntryInputSchema>;

export const AttendanceEntrySchema = AttendanceEntryInputSchema.and(
  z.object({ id: z.uuid(), dayType: DayTypeSchema }),
);
export type AttendanceEntry = z.infer<typeof AttendanceEntrySchema>;

/** CSV import columns (header row required). */
export const ATTENDANCE_CSV_COLUMNS = [
  'employee_no',
  'date',
  'regular_hours',
  'ot_hours',
  'nd_hours',
  'nd_ot_hours',
  'tardy_minutes',
  'undertime_minutes',
  'absent',
  'leave_type',
  'day_type_override',
  'notes',
] as const;

export const AttendanceImportResultSchema = z.object({
  imported: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
});
export type AttendanceImportResult = z.infer<typeof AttendanceImportResultSchema>;

export const HolidayTypeSchema = z.enum(['regular', 'special_non_working', 'special_working']);
export type HolidayType = z.infer<typeof HolidayTypeSchema>;

export const HolidayInputSchema = z.object({
  date: DateSchema,
  name: z.string().trim().min(1).max(120),
  type: HolidayTypeSchema,
});
export type HolidayInput = z.infer<typeof HolidayInputSchema>;

export const HolidaySchema = HolidayInputSchema.extend({ id: z.uuid() });
export type Holiday = z.infer<typeof HolidaySchema>;
