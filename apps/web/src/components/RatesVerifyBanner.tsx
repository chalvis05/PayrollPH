import { Link } from 'react-router';
import { Banner } from './Banner';
import { focusRing } from './Button';

interface RatesVerifyBannerProps {
  /** Where the owner reviews and marks the rates verified, normally `/settings/rates`. */
  to: string;
  className?: string | undefined;
}

export function RatesVerifyBanner({ to, className }: RatesVerifyBannerProps) {
  return (
    <Banner
      tone="warning"
      title="Verify statutory rates before your first live payroll"
      className={className}
    >
      The bundled SSS, PhilHealth, Pag-IBIG and BIR withholding tables are a starting point only.
      Check them against the latest SSS, PhilHealth, Pag-IBIG and BIR circulars, then mark them
      verified.{' '}
      <Link to={to} className={`font-semibold underline underline-offset-2 ${focusRing}`}>
        Review rates
      </Link>
    </Banner>
  );
}
