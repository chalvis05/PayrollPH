import { zodResolver } from '@hookform/resolvers/zod';
import {
  EmployeeChangeInputSchema,
  EmployeeInputSchema,
  type EmployeeInput,
} from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import {
  CheckboxField,
  DateField,
  FormError,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { useIsEncoder, useIsOwner } from '../lib/auth';
import { applyServerError } from '../lib/forms';
import {
  dailyFactorLabels,
  employmentTypeLabels,
  optionsFrom,
  payScheduleLabels,
  payTypeLabels,
  REGIONS,
  weekdayLabels,
} from '../lib/labels';

// Encoders submit EmployeeChangeInput (masked IDs = unchanged); it is a superset of EmployeeInput.
type FormIn = z.input<typeof EmployeeChangeInputSchema>;
type FormOut = z.output<typeof EmployeeChangeInputSchema>;
type Detail = ResponseOf<'/api/employees/{id}', 'get'>;

const empty: FormIn = {
  employeeNo: '',
  firstName: '',
  middleName: null,
  lastName: '',
  birthDate: null,
  sex: null,
  civilStatus: null,
  isSoloParent: false,
  address: null,
  phone: null,
  email: null,
  position: null,
  region: 'NCR',
  sssNo: null,
  philhealthNo: null,
  pagibigNo: null,
  tin: null,
  employmentType: 'regular',
  payType: 'monthly',
  paySchedule: 'standard',
  baseRate: '',
  dailyFactor: 261,
  restDays: [6, 7],
  hireDate: '',
  status: 'active',
  separationDate: null,
  allowances: [],
  dependents: [],
  payout: { method: 'cash', bankName: null, accountName: null, accountNumber: null },
};

function toFormValues(d: Detail): FormIn {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    sensitiveMasked: _m,
    missingGovIds: _g,
    ...rest
  } = d;
  return rest;
}

const rateHint: Record<EmployeeInput['payType'], string> = {
  monthly: 'Monthly salary.',
  semi_monthly: 'Salary per cutoff (half a month).',
  daily: 'Daily rate.',
  hourly: 'Hourly rate.',
};

export function EmployeeFormPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const isOwner = useIsOwner();
  const isEncoder = useIsEncoder();
  const readOnly = !isOwner && !isEncoder;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: ['employee', id],
    queryFn: () => unwrap(api.GET('/api/employees/{id}', { params: { path: { id: id ?? '' } } })),
    enabled: !isNew,
  });

  const { control, handleSubmit, formState, setError, reset } = useForm<FormIn, unknown, FormOut>({
    resolver: (isEncoder
      ? zodResolver(EmployeeChangeInputSchema)
      : zodResolver(EmployeeInputSchema)) as Resolver<FormIn, unknown, FormOut>,
    defaultValues: empty,
  });
  useEffect(() => {
    if (existing.data) reset(toFormValues(existing.data));
  }, [existing.data, reset]);

  const allowances = useFieldArray({ control, name: 'allowances' });
  const deps = useFieldArray({ control, name: 'dependents' });
  const payType = useWatch({ control, name: 'payType' });
  const payoutMethod = useWatch({ control, name: 'payout.method' });
  const status = useWatch({ control, name: 'status' });
  const allowanceKinds = useWatch({ control, name: 'allowances' });

  const rates = useQuery({ queryKey: ['rates'], queryFn: () => unwrap(api.GET('/api/rates')) });
  const deMinimisOptions = Object.entries(rates.data?.[0]?.data.benefits.deMinimis ?? {}).map(
    ([value, def]) => ({ value, label: def.label }),
  );

  if (!isNew && existing.isPending) return <Spinner label="Loading employee" />;
  if (!isNew && existing.error)
    return <Banner tone="danger">{errorMessage(existing.error)}</Banner>;

  const onSubmit = async (body: FormOut) => {
    if (isEncoder) {
      try {
        await unwrap(
          api.POST('/api/employee-requests/', {
            body: { employeeId: isNew ? null : (id ?? null), data: body },
          }),
        );
        await qc.invalidateQueries({ queryKey: ['employee-requests'] });
        await qc.invalidateQueries({ queryKey: ['dashboard'] });
        void navigate('/approvals');
      } catch (err) {
        applyServerError(err, setError);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    try {
      const saved = isNew
        ? await unwrap(api.POST('/api/employees/', { body }))
        : await unwrap(api.PUT('/api/employees/{id}', { params: { path: { id } }, body }));
      await qc.invalidateQueries({ queryKey: ['employees'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.setQueryData(['employee', saved.id], saved);
      void navigate('/employees');
    } catch (err) {
      applyServerError(err, setError);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const title = isNew
    ? 'New employee'
    : `${existing.data?.firstName ?? ''} ${existing.data?.lastName ?? ''}`;

  return (
    <>
      <PageHeader
        title={title}
        description={
          isNew
            ? 'Personal details, government IDs, pay setup and payout.'
            : existing.data?.employeeNo
        }
      />
      {isEncoder ? (
        <Banner tone="info" className="mb-4" title="Changes need the owner's approval">
          Submitting sends this to the owner under Approvals; nothing changes until they approve it.
          {existing.data?.sensitiveMasked
            ? ' Government IDs and account numbers shown as •••• stay as they are unless you type a new one.'
            : ''}
        </Banner>
      ) : existing.data?.sensitiveMasked ? (
        <Banner tone="info" className="mb-4">
          Government IDs and account numbers are masked for viewers.
        </Banner>
      ) : null}
      <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-6">
        <FormError errors={formState.errors} />
        <fieldset disabled={readOnly} className="space-y-6">
          <Card title="Personal">
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField control={control} name="employeeNo" label="Employee no." required />
              <TextField control={control} name="firstName" label="First name" required />
              <TextField control={control} name="middleName" label="Middle name" emptyAsNull />
              <TextField control={control} name="lastName" label="Last name" required />
              <DateField control={control} name="birthDate" label="Birth date" />
              <SelectField
                control={control}
                name="sex"
                label="Sex"
                placeholder="—"
                options={[
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                ]}
              />
              <SelectField
                control={control}
                name="civilStatus"
                label="Civil status"
                placeholder="—"
                options={[
                  { value: 'single', label: 'Single' },
                  { value: 'married', label: 'Married' },
                  { value: 'widowed', label: 'Widowed' },
                  { value: 'separated', label: 'Separated' },
                ]}
              />
              <TextField control={control} name="phone" label="Phone" type="tel" emptyAsNull />
              <TextField
                control={control}
                name="email"
                label="Email"
                type="email"
                hint="Payslips are emailed here."
                emptyAsNull
              />
              <TextField control={control} name="position" label="Position" emptyAsNull />
              <CheckboxField
                control={control}
                name="isSoloParent"
                label="Solo parent"
                hint="7 days solo parent leave after 6 months."
                className="sm:col-span-2"
              />
              <TextAreaField
                control={control}
                name="address"
                label="Address"
                className="sm:col-span-3"
              />
            </div>
          </Card>

          <Card title="Government IDs">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={control}
                name="sssNo"
                label="SSS no."
                placeholder="34-1234567-8"
                emptyAsNull
              />
              <TextField
                control={control}
                name="philhealthNo"
                label="PhilHealth no."
                placeholder="12-345678901-2"
                emptyAsNull
              />
              <TextField
                control={control}
                name="pagibigNo"
                label="Pag-IBIG MID no."
                placeholder="1234-5678-9012"
                emptyAsNull
              />
              <TextField
                control={control}
                name="tin"
                label="TIN"
                placeholder="123-456-789-000"
                emptyAsNull
              />
            </div>
          </Card>

          <Card title="Employment and pay">
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                control={control}
                name="employmentType"
                label="Employment type"
                options={optionsFrom(employmentTypeLabels)}
                required
              />
              <SelectField
                control={control}
                name="payType"
                label="Pay type"
                options={optionsFrom(payTypeLabels)}
                required
              />
              <SelectField
                control={control}
                name="paySchedule"
                label="Pay schedule"
                options={optionsFrom(payScheduleLabels)}
                hint="Twice weekly: paid every Wednesday (Sun–Wed) and Saturday (Thu–Sat)."
                required
              />
              <MoneyField
                control={control}
                name="baseRate"
                label="Base rate"
                hint={rateHint[payType]}
                required
              />
              <Controller
                control={control}
                name="dailyFactor"
                render={({ field }) => (
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Daily-rate factor
                    <select
                      value={String(field.value)}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      onBlur={field.onBlur}
                      className="h-10 rounded-md border border-slate-300 bg-white px-2 font-normal dark:border-slate-700 dark:bg-slate-900"
                    >
                      {optionsFrom(dailyFactorLabels).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              />
              <SelectField
                control={control}
                name="region"
                label="Region"
                options={REGIONS.map((r) => ({ value: r, label: r }))}
                required
              />
              <DateField control={control} name="hireDate" label="Hire date" required />
              <Controller
                control={control}
                name="restDays"
                render={({ field }) => (
                  <fieldset className="sm:col-span-3">
                    <legend className="mb-1 text-sm font-medium">Rest days</legend>
                    <div className="flex flex-wrap gap-3">
                      {weekdayLabels.map((label, i) => {
                        const day = i + 1;
                        const checked = field.value.includes(day);
                        return (
                          <label key={label} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                field.onChange(
                                  checked
                                    ? field.value.filter((d) => d !== day)
                                    : [...field.value, day].sort(),
                                )
                              }
                              className="size-4 accent-emerald-700"
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              />
              <SelectField
                control={control}
                name="status"
                label="Status"
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'separated', label: 'Separated' },
                ]}
                hint="Only active employees count toward the cap and get paid."
                required
              />
              {status === 'separated' ? (
                <DateField control={control} name="separationDate" label="Separation date" />
              ) : null}
            </div>
          </Card>

          <Card
            title="Allowances"
            actions={
              readOnly ? undefined : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    allowances.append({
                      name: '',
                      amount: '',
                      kind: 'taxable',
                      deMinimisType: null,
                    })
                  }
                >
                  Add allowance
                </Button>
              )
            }
          >
            {allowances.fields.length === 0 ? (
              <p className="text-sm text-slate-500">
                No allowances. Amounts are per payroll period.
              </p>
            ) : (
              <ul className="space-y-4">
                {allowances.fields.map((f, i) => (
                  <li
                    key={f.id}
                    className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_1.5fr_auto]"
                  >
                    <TextField
                      control={control}
                      name={`allowances.${i}.name`}
                      label="Name"
                      required
                    />
                    <MoneyField
                      control={control}
                      name={`allowances.${i}.amount`}
                      label="Per period"
                      required
                    />
                    <SelectField
                      control={control}
                      name={`allowances.${i}.kind`}
                      label="Tax"
                      options={[
                        { value: 'taxable', label: 'Taxable' },
                        { value: 'de_minimis', label: 'De minimis' },
                      ]}
                    />
                    {allowanceKinds[i]?.kind === 'de_minimis' ? (
                      <SelectField
                        control={control}
                        name={`allowances.${i}.deMinimisType`}
                        label="De minimis type"
                        placeholder="Choose…"
                        options={deMinimisOptions}
                      />
                    ) : (
                      <span />
                    )}
                    {readOnly ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => allowances.remove(i)}
                        aria-label={`Remove allowance ${i + 1}`}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Dependents"
            actions={
              readOnly ? undefined : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => deps.append({ name: '', relationship: '', birthDate: null })}
                >
                  Add dependent
                </Button>
              )
            }
          >
            {deps.fields.length === 0 ? (
              <p className="text-sm text-slate-500">No dependents.</p>
            ) : (
              <ul className="space-y-4">
                {deps.fields.map((f, i) => (
                  <li key={f.id} className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                    <TextField
                      control={control}
                      name={`dependents.${i}.name`}
                      label="Name"
                      required
                    />
                    <TextField
                      control={control}
                      name={`dependents.${i}.relationship`}
                      label="Relationship"
                      required
                    />
                    <DateField
                      control={control}
                      name={`dependents.${i}.birthDate`}
                      label="Birth date"
                    />
                    {readOnly ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deps.remove(i)}
                        aria-label={`Remove dependent ${i + 1}`}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Payout">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={control}
                name="payout.method"
                label="Method"
                options={[
                  { value: 'cash', label: 'Cash' },
                  { value: 'bank', label: 'Bank transfer' },
                  { value: 'gcash', label: 'GCash' },
                ]}
                required
              />
              {payoutMethod === 'bank' ? (
                <TextField control={control} name="payout.bankName" label="Bank" emptyAsNull />
              ) : null}
              {payoutMethod !== 'cash' ? (
                <>
                  <TextField
                    control={control}
                    name="payout.accountName"
                    label="Account name"
                    emptyAsNull
                  />
                  <TextField
                    control={control}
                    name="payout.accountNumber"
                    label={payoutMethod === 'gcash' ? 'GCash number' : 'Account number'}
                    emptyAsNull
                  />
                </>
              ) : null}
            </div>
          </Card>
        </fieldset>

        {readOnly ? null : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => void navigate('/employees')}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              {isEncoder ? 'Submit for approval' : isNew ? 'Add employee' : 'Save changes'}
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
