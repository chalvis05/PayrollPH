export interface NavItem {
  to: string;
  label: string;
  /** Match only the exact path (for `/`). */
  end?: boolean;
  /** Hidden from read-only viewers (the API refuses them anyway). */
  ownerOnly?: boolean;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    heading: 'Overview',
    items: [{ to: '/', label: 'Dashboard', end: true }],
  },
  {
    heading: 'People',
    items: [
      { to: '/employees', label: 'Employees' },
      { to: '/attendance', label: 'Attendance' },
      { to: '/holidays', label: 'Holidays' },
    ],
  },
  {
    heading: 'Payroll',
    items: [
      { to: '/payroll', label: 'Payroll runs' },
      { to: '/final-pay', label: 'Final pay' },
      { to: '/loans', label: 'Loans' },
      { to: '/deductions', label: 'Deductions' },
      { to: '/reports', label: 'Reports' },
    ],
  },
  {
    heading: 'Admin',
    items: [
      { to: '/settings', label: 'Settings', end: true },
      { to: '/settings/rates', label: 'Rates' },
      { to: '/settings/users', label: 'Users', ownerOnly: true },
      { to: '/settings/backups', label: 'Backups', ownerOnly: true },
      { to: '/audit', label: 'Audit log', ownerOnly: true },
    ],
  },
];
