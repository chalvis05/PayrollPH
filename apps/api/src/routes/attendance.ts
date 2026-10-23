import {
  ATTENDANCE_CSV_COLUMNS,
  AttendanceEntryInputSchema,
  AttendanceEntrySchema,
  AttendanceImportResultSchema,
  DateSchema,
  type AttendanceEntryInput,
} from '@payrollph/shared';
import { parse } from 'csv-parse/sync';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { attendance, employees, holidays } from '../db/schema';
import { writeAudit, type DbOrTx } from '../lib/audit';
import {
  badRequest,
  conflict,
  errorResponses,
  IdParamsSchema,
  notFound,
  OkSchema,
} from '../lib/http';
import { requireOwner } from '../plugins/auth';
import { dayTypeFor, isAttendanceLocked } from '../services/payrollRun';

type AttendanceRow = typeof attendance.$inferSelect;
type AttendanceEntry = z.infer<typeof AttendanceEntrySchema>;

/** Longest range a single GET may cover (a little over a year). */
const MAX_RANGE_DAYS = 400;
/** Largest CSV a single import may contain. */
const MAX_IMPORT_ROWS = 5000;

const ListQuerySchema = z.object({
  from: DateSchema,
  to: DateSchema,
  employeeId: z.uuid().optional(),
});

const lockedError = (date: string) =>
  conflict(
    'ATTENDANCE_LOCKED',
    `Attendance for ${date} is locked by an approved or paid payroll run. Reopen the run to change it.`,
    { date },
  );

/** Column values for an insert/update from a validated entry. */
function rowValues(input: AttendanceEntryInput) {
  return {
    employeeId: input.employeeId,
    date: input.date,
    dayTypeOverride: input.dayTypeOverride,
    regularHours: String(input.regularHours),
    otHours: String(input.otHours),
    ndHours: String(input.ndHours),
    ndOtHours: String(input.ndOtHours),
    tardyMinutes: input.tardyMinutes,
    undertimeMinutes: input.undertimeMinutes,
    absent: input.absent,
    leaveType: input.leaveType,
    notes: input.notes,
  };
}

/** Snapshot used for audit before/after and as the base of the DTO. */
function entrySnapshot(r: AttendanceRow): AttendanceEntryInput {
  return {
    employeeId: r.employeeId,
    date: r.date,
    dayTypeOverride: r.dayTypeOverride,
    regularHours: Number(r.regularHours),
    otHours: Number(r.otHours),
    ndHours: Number(r.ndHours),
    ndOtHours: Number(r.ndOtHours),
    tardyMinutes: r.tardyMinutes,
    undertimeMinutes: r.undertimeMinutes,
    absent: r.absent,
    leaveType: r.leaveType,
    notes: r.notes,
  };
}

/** Resolve day types for rows: override, else holiday calendar + the employee's rest days. */
async function toEntries(db: DbOrTx, rows: AttendanceRow[]): Promise<AttendanceEntry[]> {
  if (rows.length === 0) return [];
  const empIds = [...new Set(rows.map((r) => r.employeeId))];
  const dates = [...new Set(rows.map((r) => r.date))];
  const emps = await db
    .select({ id: employees.id, restDays: employees.restDays })
    .from(employees)
    .where(inArray(employees.id, empIds));
  const restById = new Map(emps.map((e) => [e.id, e.restDays]));
  const hols = await db
    .select({ date: holidays.date, type: holidays.type })
    .from(holidays)
    .where(inArray(holidays.date, dates));
  const holByDate = new Map(hols.map((h) => [h.date, h.type]));
  return rows.map((r) => ({
    id: r.id,
    ...entrySnapshot(r),
    dayType:
      r.dayTypeOverride ??
      dayTypeFor(r.date, restById.get(r.employeeId) ?? [], holByDate.get(r.date)),
  }));
}

async function upsertEntry(db: DbOrTx, input: AttendanceEntryInput): Promise<AttendanceRow> {
  const values = rowValues(input);
  const [row] = await db
    .insert(attendance)
    .values(values)
    .onConflictDoUpdate({
      target: [attendance.employeeId, attendance.date],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error('Attendance upsert returned no row');
  return row;
}

// ---------------------------------------------------------------- CSV parsing

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'x']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', '']);

type CsvColumn = (typeof ATTENDANCE_CSV_COLUMNS)[number];

function csvNumber(value: string): number {
  return value === '' ? 0 : Number(value);
}

/** Turn one CSV record into the shape AttendanceEntryInputSchema expects (validation is zod's job). */
function csvRecordToInput(rec: Record<CsvColumn, string>, employeeId: string): unknown {
  const absentRaw = rec.absent.toLowerCase();
  return {
    employeeId,
    date: rec.date,
    dayTypeOverride: rec.day_type_override === '' ? null : rec.day_type_override,
    regularHours: csvNumber(rec.regular_hours),
    otHours: csvNumber(rec.ot_hours),
    ndHours: csvNumber(rec.nd_hours),
    ndOtHours: csvNumber(rec.nd_ot_hours),
    tardyMinutes: csvNumber(rec.tardy_minutes),
    undertimeMinutes: csvNumber(rec.undertime_minutes),
    absent: TRUE_VALUES.has(absentRaw) ? true : FALSE_VALUES.has(absentRaw) ? false : rec.absent,
    leaveType: rec.leave_type === '' ? null : rec.leave_type,
    notes: rec.notes === '' ? null : rec.notes,
  };
}

function zodMessage(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

export const attendanceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['attendance'],
        summary: 'DTR rows in a date range with the resolved day type',
        querystring: ListQuerySchema,
        response: { 200: z.array(AttendanceEntrySchema), ...errorResponses },
      },
    },
    async (request) => {
      const { from, to, employeeId } = request.query;
      if (from > to) throw badRequest('BAD_RANGE', '`from` must be on or before `to`.');
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days > MAX_RANGE_DAYS) {
        throw badRequest('BAD_RANGE', `The range can cover at most ${MAX_RANGE_DAYS} days.`);
      }
      const conds = [gte(attendance.date, from), lte(attendance.date, to)];
      if (employeeId) conds.push(eq(attendance.employeeId, employeeId));
      const rows = await app.db
        .select()
        .from(attendance)
        .where(and(...conds))
        .orderBy(asc(attendance.date), asc(attendance.employeeId));
      return toEntries(app.db, rows);
    },
  );

  app.get(
    '/template.csv',
    {
      schema: {
        tags: ['attendance'],
        summary: 'Empty CSV import template (header row only)',
        produces: ['text/csv'],
      },
    },
    async (_request, reply) => {
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="attendance-template.csv"')
        .send(`${ATTENDANCE_CSV_COLUMNS.join(',')}\r\n`);
    },
  );

  app.put(
    '/',
    {
      schema: {
        tags: ['attendance'],
        summary: 'Create or replace the entry for one employee and date',
        body: AttendanceEntryInputSchema,
        response: { 200: AttendanceEntrySchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const input = request.body;
      const row = await app.db.transaction(async (tx) => {
        const [emp] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.id, input.employeeId));
        if (!emp) throw notFound('Employee');
        if (await isAttendanceLocked(tx, input.date)) throw lockedError(input.date);
        const [prev] = await tx
          .select()
          .from(attendance)
          .where(and(eq(attendance.employeeId, input.employeeId), eq(attendance.date, input.date)));
        const saved = await upsertEntry(tx, input);
        await writeAudit(tx, {
          actorId: me.id,
          action: prev ? 'attendance.update' : 'attendance.create',
          entity: 'attendance',
          entityId: saved.id,
          before: prev ? entrySnapshot(prev) : null,
          after: entrySnapshot(saved),
        });
        return saved;
      });
      const [entry] = await toEntries(app.db, [row]);
      if (!entry) throw new Error('Attendance entry missing after save');
      return entry;
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['attendance'],
        summary: 'Delete one attendance entry',
        params: IdParamsSchema,
        response: { 200: OkSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(attendance)
          .where(eq(attendance.id, request.params.id));
        if (!row) throw notFound('Attendance entry');
        if (await isAttendanceLocked(tx, row.date)) throw lockedError(row.date);
        await tx.delete(attendance).where(eq(attendance.id, row.id));
        await writeAudit(tx, {
          actorId: me.id,
          action: 'attendance.delete',
          entity: 'attendance',
          entityId: row.id,
          before: entrySnapshot(row),
        });
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/import',
    {
      schema: {
        tags: ['attendance'],
        summary:
          'Import a DTR CSV (multipart field "file"). Valid rows are saved; invalid rows are listed with their row number.',
        consumes: ['multipart/form-data'],
        response: { 200: AttendanceImportResultSchema, ...errorResponses },
      },
    },
    async (request) => {
      const me = requireOwner(request);
      const file = await request.file();
      if (!file) throw badRequest('NO_FILE', 'Attach a CSV file.');
      const buffer = await file.toBuffer();

      let records: string[][];
      try {
        records = parse(buffer, {
          bom: true,
          trim: true,
          skip_empty_lines: true,
          relax_column_count: true,
        }) as string[][];
      } catch (err) {
        throw badRequest('BAD_CSV', `The file is not a valid CSV: ${(err as Error).message}`);
      }
      const [header, ...data] = records;
      if (!header) throw badRequest('BAD_CSV', 'The file is empty.');
      const normalised = header.map((h) => h.toLowerCase());
      const missing = ATTENDANCE_CSV_COLUMNS.filter((c) => !normalised.includes(c));
      const unknown = normalised.filter(
        (h) => !(ATTENDANCE_CSV_COLUMNS as readonly string[]).includes(h),
      );
      if (missing.length > 0 || unknown.length > 0) {
        throw badRequest(
          'BAD_CSV_HEADER',
          `The header row must be: ${ATTENDANCE_CSV_COLUMNS.join(',')}`,
          { missing, unknown },
        );
      }
      if (data.length > MAX_IMPORT_ROWS) {
        throw badRequest('TOO_MANY_ROWS', `Import at most ${MAX_IMPORT_ROWS} rows per file.`);
      }

      const result = await app.db.transaction(async (tx) => {
        const errors: { row: number; message: string }[] = [];
        const emps = await tx
          .select({ id: employees.id, employeeNo: employees.employeeNo })
          .from(employees);
        const idByNo = new Map(emps.map((e) => [e.employeeNo, e.id]));
        const lockCache = new Map<string, boolean>();
        const seen = new Map<string, number>();
        let imported = 0;

        for (const [i, cells] of data.entries()) {
          // Row numbers match the spreadsheet: the header is row 1.
          const rowNo = i + 2;
          const rec = Object.fromEntries(
            ATTENDANCE_CSV_COLUMNS.map((c) => [c, cells[normalised.indexOf(c)] ?? '']),
          ) as Record<CsvColumn, string>;
          const employeeId = idByNo.get(rec.employee_no);
          if (!employeeId) {
            errors.push({
              row: rowNo,
              message: rec.employee_no
                ? `Unknown employee_no "${rec.employee_no}"`
                : 'employee_no is required',
            });
            continue;
          }
          const parsed = AttendanceEntryInputSchema.safeParse(csvRecordToInput(rec, employeeId));
          if (!parsed.success) {
            errors.push({ row: rowNo, message: zodMessage(parsed.error) });
            continue;
          }
          const input = parsed.data;
          const key = `${employeeId}|${input.date}`;
          const firstRow = seen.get(key);
          if (firstRow !== undefined) {
            errors.push({
              row: rowNo,
              message: `Duplicate of row ${firstRow} (same employee and date)`,
            });
            continue;
          }
          seen.set(key, rowNo);
          let locked = lockCache.get(input.date);
          if (locked === undefined) {
            locked = await isAttendanceLocked(tx, input.date);
            lockCache.set(input.date, locked);
          }
          if (locked) {
            errors.push({
              row: rowNo,
              message: `${input.date} is locked by an approved or paid payroll run`,
            });
            continue;
          }
          await upsertEntry(tx, input);
          imported += 1;
        }

        await writeAudit(tx, {
          actorId: me.id,
          action: 'attendance.import',
          entity: 'attendance',
          after: { rows: data.length, imported, errors: errors.length },
        });
        return { imported, errors };
      });
      return result;
    },
  );
};
