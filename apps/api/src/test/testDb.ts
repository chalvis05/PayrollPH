/** Name of the throwaway test database. Override with TEST_DB_NAME to run suites side by side. */
export function testDbName(): string {
  const name = process.env.TEST_DB_NAME ?? 'payrollph_test';
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes('test')) {
    throw new Error(
      `Refusing to use "${name}" as a test database (must match [a-z0-9_]+ and contain "test").`,
    );
  }
  return name;
}
