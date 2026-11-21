import { randomUUID } from 'node:crypto';

export const sampleActivity = '34567890-1234-4567-8899-012345678901';
const moment = '2026-11-21T01:00:00Z';
const secondActivity = '34567890-1234-4567-8899-012345678902';
const thirdActivity = '34567890-1234-4567-8899-012345678903';
const sampleShoe = '45d68910-3d3d-4c10-8e13-ea016883ff41';
const runs = [
  { id: sampleActivity, title: '周末长距离', activity_date: '2026-11-15', distance_m: '18600' },
  { id: secondActivity, title: '河边有氧跑', activity_date: '2026-11-12', distance_m: '12200' },
  { id: thirdActivity, title: '以往训练记录', activity_date: '2026-11-08', distance_m: '611600' },
];

/** @typedef {import('../../src/lib/api/generated/api.ts').ShoeInput & { id: string, userId: string, retired_on: string | null, created_at: string, updated_at: string }} Shoe */

/** @param {string} ownerId */
export function createShoes(ownerId) {
  /** @type {Map<string, Shoe>} */
  const shoes = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const bindings = new Map();
  /** @param {string} userId @param {Partial<Shoe> & { name: string }} fields */
  function create(userId, fields) {
    const row = {
      id: randomUUID(),
      userId,
      brand: null,
      model: null,
      notes: null,
      purchased_on: null,
      retired_on: null,
      initial_distance_m: '0',
      replacement_distance_m: null,
      created_at: moment,
      updated_at: moment,
      ...fields,
    };
    shoes.set(row.id, row);
    return row;
  }
  function reset() {
    for (const [id, shoe] of shoes) if (shoe.userId === ownerId) shoes.delete(id);
    create(ownerId, {
      id: sampleShoe,
      name: '长距离训练鞋',
      brand: 'Northline',
      model: 'Pace 02',
      initial_distance_m: '120000',
      replacement_distance_m: '800000',
      purchased_on: '2026-03-22',
    });
    create(ownerId, {
      id: '45d68910-3d3d-4c10-8e13-ea016883ff42',
      name: '间歇训练鞋',
      brand: 'Stride Lab',
      model: 'Tempo 01',
      initial_distance_m: '286100',
      replacement_distance_m: '650000',
    });
    create(ownerId, {
      id: '45d68910-3d3d-4c10-8e13-ea016883ff43',
      name: '轻松跑训练鞋',
      brand: 'Northline',
      model: 'Pace 01',
      initial_distance_m: '842300',
      retired_on: '2026-10-07',
    });
    bindings.set(ownerId, new Map(runs.map(({ id }) => [id, sampleShoe])));
  }

  /** @param {Shoe | null | undefined} row */
  function ref(row) {
    return row ? { id: row.id, name: row.name, retired_on: row.retired_on } : null;
  }
  /** @param {Shoe} row */
  function related(row) {
    return runs.filter((activity) => bindings.get(row.userId)?.get(activity.id) === row.id);
  }
  /** @param {Shoe} row */
  function view(row) {
    const activity = related(row);
    const distance = activity.reduce((total, run) => total + Number(run.distance_m), 0);
    const total = distance + Number(row.initial_distance_m ?? '0');
    const threshold = Number(row.replacement_distance_m);
    /** @type {'near' | 'due' | null} */
    const reminder =
      !threshold || row.retired_on ? null : total >= threshold ? 'due' : total >= threshold * 0.9 ? 'near' : null;
    const { userId, ...visible } = row;
    return {
      ...visible,
      activity_distance_m: distance.toFixed(3),
      activity_count: activity.length,
      total_distance_m: total.toFixed(3),
      remaining_distance_m: reminder === 'near' ? (threshold - total).toFixed(3) : null,
      reminder,
    };
  }
  /** @template T @param {T[]} items @param {URL} url */
  function page(items, url) {
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {URL} url
   * @param {(data: unknown, status?: number, message?: string) => void} send
   * @param {{ id?: string, is_active?: boolean } | undefined} current
   */
  async function handle(req, url, send, current) {
    const shoe = url.pathname.match(/^\/api\/v1\/me\/shoes(?:\/([^/]+)(\/activities)?)?$/);
    const binding = url.pathname.match(/^\/api\/v1\/me\/activities\/([^/]+)\/shoe$/);
    if (!shoe && !binding) return false;
    if (!current?.is_active || !current.id) {
      send(null, 401);
      return true;
    }
    const owner = current.id;
    const row = shoe?.[1] ? shoes.get(shoe[1]) : null;
    let payload;
    if (req.method !== 'GET') {
      if (req.headers['x-csrf-token'] !== 'ui-csrf') {
        send(null, 403, '请求来源或CSRF令牌不合法');
        return true;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      payload = body ? JSON.parse(body) : {};
    }
    if (binding) {
      if (!bindings.has(owner)) bindings.set(owner, new Map());
      const index = bindings.get(owner) ?? new Map();
      const old = index.get(binding[1]);
      if (req.method === 'GET') send({ shoe: ref(old ? shoes.get(old) : null) });
      else {
        const picked = payload.shoe_id && shoes.get(payload.shoe_id);
        if (payload.shoe_id && picked?.userId !== owner) send(null, 404, '跑鞋不存在');
        else if (picked?.retired_on && picked.id !== old) send(null, 409, '跑鞋已退役，请选择使用中的跑鞋');
        else {
          if (picked) index.set(binding[1], picked.id);
          else index.delete(binding[1]);
          send({ shoe: ref(picked) });
        }
      }
    } else if (!shoe?.[1] && req.method === 'GET') {
      const retired = url.searchParams.get('status') === 'retired';
      const byName = url.searchParams.get('order') === 'name';
      const groups = { due: 0, near: 1 };
      const rows = [...shoes.values()]
        .filter((item) => item.userId === owner && !!item.retired_on === retired)
        .map(view);
      rows.sort((a, b) =>
        byName
          ? a.name.localeCompare(b.name)
          : (a.reminder ? groups[a.reminder] : 2) - (b.reminder ? groups[b.reminder] : 2) ||
            b.created_at.localeCompare(a.created_at),
      );
      send(page(rows, url));
    } else if (!shoe?.[1] && req.method === 'POST') {
      for (const key of ['brand', 'model', 'notes']) payload[key] ||= null;
      send(view(create(owner, payload)), 201);
    } else if (!row || row.userId !== owner) {
      send(null, 404, '跑鞋不存在');
    } else if (shoe?.[2]) {
      send(page(related(row), url));
    } else if (req.method === 'GET') {
      send(view(row));
    } else if (req.method === 'PATCH') {
      const { retired, ...fields } = payload;
      for (const key of ['brand', 'model', 'notes']) if (fields[key] === '') fields[key] = null;
      Object.assign(row, fields);
      if (retired !== undefined) row.retired_on = retired ? (row.retired_on ?? '2026-11-21') : null;
      send(view(row));
    } else if (req.method === 'DELETE') {
      if ([...(bindings.get(owner)?.values() ?? [])].includes(row.id))
        send(null, 409, '仍有关联活动，请先解绑或退役跑鞋');
      else {
        shoes.delete(row.id);
        send({ deleted: true });
      }
    }
    return true;
  }

  reset();
  return { handle, reset };
}
