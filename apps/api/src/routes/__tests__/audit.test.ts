import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../db/schema';
import {
  createTestContext,
  ownerClient,
  resetDb,
  type TestClient,
  type TestContext,
} from '../../test/helpers';

let ctx: TestContext;
let owner: TestClient;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  owner = await ownerClient(ctx.app);
});

interface Entry {
  id: string;
  at: string;
  action: string;
}

describe('audit log paging', () => {
  it('returns every entry exactly once when several share a timestamp across pages', async () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    await ctx.db
      .insert(auditLog)
      .values(
        ['a', 'b', 'c'].map((n) => ({ at, actorId: null, action: `test.${n}`, entity: 'paging' })),
      );

    const seen: string[] = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const res = await owner.get<Entry[]>(`/api/audit?entity=paging&limit=2${cursor}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.map((e) => e.action));
      const last = res.body[res.body.length - 1];
      if (res.body.length < 2 || !last) break;
      cursor = `&before=${encodeURIComponent(last.at)}&beforeId=${last.id}`;
    }
    expect(seen.sort()).toEqual(['test.a', 'test.b', 'test.c']);
  });
});
