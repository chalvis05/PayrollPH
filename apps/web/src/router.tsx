import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './lib/auth';
import type { RouteHandle } from './components/layout/AppShell';
import { AccountPage } from './pages/Account';
import { AttendancePage } from './pages/Attendance';
import { AuditPage } from './pages/Audit';
import { AuthLayout } from './pages/AuthLayout';
import { BackupsPage } from './pages/Backups';
import { DashboardPage } from './pages/Dashboard';
import { DeductionsPage } from './pages/Deductions';
import { EmployeeFormPage } from './pages/EmployeeForm';
import { EmployeesPage } from './pages/Employees';
import { FinalPayPage } from './pages/FinalPay';
import { HolidaysPage } from './pages/Holidays';
import { LoansPage } from './pages/Loans';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { PayrollRunDetailPage } from './pages/PayrollRunDetail';
import { PayrollRunsPage } from './pages/PayrollRuns';
import { PayslipPage } from './pages/Payslip';
import { RatesPage } from './pages/Rates';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { SetupPage } from './pages/Setup';
import { UsersPage } from './pages/Users';

const h = (title: string): RouteHandle => ({ title });

export const routes: RouteObject[] = [
  {
    element: <AuthLayout />,
    children: [
      { path: '/setup', element: <SetupPage />, handle: h('Setup') },
      { path: '/login', element: <LoginPage />, handle: h('Sign in') },
    ],
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage />, handle: h('Dashboard') },
      { path: 'employees', element: <EmployeesPage />, handle: h('Employees') },
      { path: 'employees/new', element: <EmployeeFormPage />, handle: h('New employee') },
      { path: 'employees/:id', element: <EmployeeFormPage />, handle: h('Edit employee') },
      { path: 'attendance', element: <AttendancePage />, handle: h('Attendance') },
      { path: 'holidays', element: <HolidaysPage />, handle: h('Holidays') },
      { path: 'payroll', element: <PayrollRunsPage />, handle: h('Payroll runs') },
      { path: 'payroll/:id', element: <PayrollRunDetailPage />, handle: h('Payroll run') },
      { path: 'payslips/:id', element: <PayslipPage />, handle: h('Payslip') },
      { path: 'final-pay', element: <FinalPayPage />, handle: h('Final pay') },
      { path: 'loans', element: <LoansPage />, handle: h('Loans') },
      { path: 'deductions', element: <DeductionsPage />, handle: h('Deductions') },
      { path: 'reports', element: <ReportsPage />, handle: h('Reports') },
      { path: 'settings', element: <SettingsPage />, handle: h('Settings') },
      { path: 'settings/rates', element: <RatesPage />, handle: h('Statutory rates') },
      { path: 'settings/backups', element: <BackupsPage />, handle: h('Backups') },
      { path: 'settings/users', element: <UsersPage />, handle: h('Users') },
      { path: 'audit', element: <AuditPage />, handle: h('Audit log') },
      { path: 'account', element: <AccountPage />, handle: h('My account') },
      { path: '*', element: <NotFoundPage />, handle: h('Not found') },
    ],
  },
];

export const router = createBrowserRouter(routes);
