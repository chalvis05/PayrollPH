-- Employee cap: active employees may never exceed settings.employee_cap.
-- Enforced here in addition to the API check, so no code path (or manual SQL) can bypass it.
-- The API maps SQLSTATE P0001 with message prefix EMPLOYEE_CAP_EXCEEDED to a 409 error.

CREATE OR REPLACE FUNCTION enforce_employee_cap() RETURNS trigger AS $$
DECLARE
  cap integer;
  active_count integer;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
    RETURN NEW;
  END IF;

  -- Serialise concurrent activations so two inserts cannot both pass the count.
  PERFORM pg_advisory_xact_lock(hashtext('payrollph_employee_cap'));

  SELECT employee_cap INTO cap FROM settings WHERE id = 1;
  IF cap IS NULL THEN
    cap := 25; -- default when settings have not been created yet
  END IF;

  SELECT count(*) INTO active_count FROM employees WHERE status = 'active' AND id <> NEW.id;
  IF active_count + 1 > cap THEN
    RAISE EXCEPTION 'EMPLOYEE_CAP_EXCEEDED: % active employees already; the cap is %', active_count, cap
      USING ERRCODE = 'P0001', HINT = 'Deactivate or separate an employee, or raise the cap in Settings.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER employees_enforce_cap
  BEFORE INSERT OR UPDATE OF status ON employees
  FOR EACH ROW EXECUTE FUNCTION enforce_employee_cap();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_cap_not_below_active() RETURNS trigger AS $$
DECLARE
  active_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('payrollph_employee_cap'));
  SELECT count(*) INTO active_count FROM employees WHERE status = 'active';
  IF NEW.employee_cap < active_count THEN
    RAISE EXCEPTION 'EMPLOYEE_CAP_BELOW_ACTIVE: % employees are active; the cap cannot be set to %', active_count, NEW.employee_cap
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER settings_cap_not_below_active
  BEFORE INSERT OR UPDATE OF employee_cap ON settings
  FOR EACH ROW EXECUTE FUNCTION enforce_cap_not_below_active();
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Manila');
END;
$$;
