import {
  PelicanScheduleListSchema,
  PelicanServerPageSchema,
  PelicanStatsSchema,
} from './pelican-api.schemas';
import { loadPelicanFixture } from './testing/pelican-fixtures';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('fixture is not an object');
  }
  return { ...value };
}

describe('Pelican upstream schemas', () => {
  it('unwraps the paginated server list', () => {
    const parsed = PelicanServerPageSchema.parse(
      loadPelicanFixture('servers-page'),
    );
    expect(parsed.pagination.total).toBe(2);
    expect(parsed.servers).toEqual([
      {
        uuid: '11111111-1111-4111-8111-111111111111',
        identifier: '11111111',
        name: 'Example Server 1',
      },
      {
        uuid: '22222222-2222-4222-8222-222222222222',
        identifier: '22222222',
        name: 'Example Server 2',
      },
    ]);
  });

  it('unwraps stats attributes', () => {
    const parsed = PelicanStatsSchema.parse(
      loadPelicanFixture('server-resources'),
    );
    expect(parsed.current_state).toBe('running');
    expect(parsed.resources.uptime).toBe(60000);
  });

  it('flattens schedules and their default-included tasks', () => {
    const parsed = PelicanScheduleListSchema.parse(
      loadPelicanFixture('server-schedules'),
    );
    expect(parsed.map((s) => s.name)).toEqual([
      'Nightly restart',
      'Weekend announcement',
    ]);
    expect(parsed[0]?.cron).toEqual({
      day_of_week: '*',
      day_of_month: '*',
      month: '*',
      hour: '4',
      minute: '0',
    });
    expect(parsed[0]?.tasks[0]?.action).toBe('power');
    expect(parsed[1]?.tasks[0]?.payload).toBe('say example');
    expect(parsed[1]?.next_run_at).toBeNull();
    expect(parsed[0]).not.toHaveProperty('relationships');
  });
});

describe('Pelican upstream schemas — tolerance and rejection', () => {
  it('treats a schedule without relationships as having no tasks', () => {
    const body = asRecord(loadPelicanFixture('server-schedules'));
    const data = Array.isArray(body.data) ? body.data : [];
    const first = asRecord(asRecord(data[0]).attributes);
    delete first.relationships;
    const parsed = PelicanScheduleListSchema.parse({
      object: 'list',
      data: [{ object: 'server_schedule', attributes: first }],
    });
    expect(parsed[0]?.tasks).toEqual([]);
  });

  function withFirstTask(patch: Record<string, unknown>): unknown {
    const body = asRecord(loadPelicanFixture('server-schedules'));
    const data = Array.isArray(body.data) ? body.data : [];
    const attributes = asRecord(asRecord(data[0]).attributes);
    const relationships = asRecord(attributes.relationships);
    const tasks = asRecord(relationships.tasks);
    const taskData = Array.isArray(tasks.data) ? tasks.data : [];
    const task = asRecord(taskData[0]);
    const patched = {
      ...task,
      attributes: { ...asRecord(task.attributes), ...patch },
    };
    const nextTasks = { ...tasks, data: [patched] };
    const nextAttrs = { ...attributes, relationships: { tasks: nextTasks } };
    return {
      ...body,
      data: [{ object: 'server_schedule', attributes: nextAttrs }],
    };
  }

  it.each([0, 900])('accepts a task time_offset of %d', (offset) => {
    const parsed = PelicanScheduleListSchema.parse(
      withFirstTask({ time_offset: offset }),
    );
    expect(parsed[0]?.tasks[0]?.time_offset).toBe(offset);
  });

  it.each([901, -1])('rejects a task time_offset of %d', (offset) => {
    const result = PelicanScheduleListSchema.safeParse(
      withFirstTask({ time_offset: offset }),
    );
    expect(result.success).toBe(false);
  });

  it('parses an unknown task action', () => {
    const parsed = PelicanScheduleListSchema.parse(
      withFirstTask({ action: 'wake' }),
    );
    expect(parsed[0]?.tasks[0]?.action).toBe('wake');
  });

  it('ignores unknown upstream fields (additive releases)', () => {
    const body = asRecord(loadPelicanFixture('server-resources'));
    const attributes = {
      ...asRecord(body.attributes),
      brand_new_field: 'x',
    };
    const parsed = PelicanStatsSchema.parse({ ...body, attributes });
    expect(parsed).not.toHaveProperty('brand_new_field');
    expect(parsed.is_suspended).toBe(false);
  });

  it('rejects stats missing current_state', () => {
    const body = asRecord(loadPelicanFixture('server-resources'));
    const attributes = asRecord(body.attributes);
    delete attributes.current_state;
    const result = PelicanStatsSchema.safeParse({ ...body, attributes });
    expect(result.success).toBe(false);
  });

  it('rejects a flat (un-enveloped) server list', () => {
    const result = PelicanServerPageSchema.safeParse({
      data: [{ uuid: 'x', identifier: 'x', name: 'x' }],
      meta: { pagination: { total: 1 } },
    });
    expect(result.success).toBe(false);
  });
});
