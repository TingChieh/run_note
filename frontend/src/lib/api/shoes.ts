import { ActivityError, calendarDate, request } from './activities.ts';
import type {
  ShoeActivities,
  ShoeActivity,
  ShoeBinding,
  ShoeInput,
  ShoeList,
  ShoePatch,
  ShoeRef,
  ShoeView,
} from './generated/api.ts';

export type { ShoeActivities, ShoeInput, ShoeList, ShoeRef, ShoeView };
export type ShoeStatus = 'active' | 'retired';

export class ShoeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export const isShoeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && [...value].length <= max && !!value.trim();
const nullableText = (value: unknown, max: number): value is string | null => value === null || text(value, max);
const nullableDate = (value: unknown): value is string | null => value === null || calendarDate(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const meters = (value: unknown, min = 0, max = Infinity): value is string =>
  typeof value === 'string' &&
  /^\d+(?:\.\d{1,3})?$/.test(value) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= min &&
  Number(value) < max;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function invalid(): never {
  throw new ShoeError('跑鞋服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE');
}

function identifier(value: string): string {
  if (!isShoeId(value)) throw new ShoeError('记录不存在', 404, 'RESOURCE_NOT_FOUND');
  return value;
}

function isRef(value: unknown): value is Record<string, unknown> & ShoeRef {
  return object(value) && isShoeId(value.id) && text(value.name, 80) && nullableDate(value.retired_on);
}

function parseRef(value: unknown): ShoeRef {
  if (!isRef(value)) invalid();
  return { id: value.id, name: value.name, retired_on: value.retired_on };
}

function parseShoe(value: unknown): ShoeView {
  if (!isRef(value)) invalid();
  const {
    brand,
    model,
    notes,
    purchased_on,
    initial_distance_m,
    replacement_distance_m,
    activity_distance_m,
    total_distance_m,
    activity_count,
    reminder,
    remaining_distance_m,
    created_at,
    updated_at,
  } = value;
  if (
    !nullableText(brand, 60) ||
    !nullableText(model, 60) ||
    !nullableText(notes, 1000) ||
    !nullableDate(purchased_on) ||
    !meters(initial_distance_m, 0, 1e9) ||
    !(replacement_distance_m === null || meters(replacement_distance_m, 0.001, 1e9)) ||
    !meters(activity_distance_m) ||
    !meters(total_distance_m) ||
    !count(activity_count) ||
    !(reminder === null || reminder === 'near' || reminder === 'due') ||
    !(remaining_distance_m === null || meters(remaining_distance_m, 0.001, 1e9)) ||
    !timestamp(created_at) ||
    !timestamp(updated_at)
  )
    invalid();
  return {
    ...parseRef(value),
    brand,
    model,
    notes,
    purchased_on,
    initial_distance_m,
    replacement_distance_m,
    activity_distance_m,
    total_distance_m,
    activity_count,
    reminder,
    remaining_distance_m,
    created_at,
    updated_at,
  };
}

function parseActivity(value: unknown): ShoeActivity {
  if (!object(value)) invalid();
  const { id, title, activity_date, distance_m } = value;
  if (
    !isShoeId(id) ||
    typeof title !== 'string' ||
    [...title].length > 120 ||
    !calendarDate(activity_date) ||
    !meters(distance_m, 0, 1e9)
  )
    invalid();
  return { id, title, activity_date, distance_m };
}

function listing<T>(value: unknown, parse: (item: unknown) => T) {
  if (!object(value)) invalid();
  const { items, total, limit, offset } = value;
  if (
    !Array.isArray(items) ||
    !count(total) ||
    !count(limit) ||
    limit < 1 ||
    limit > 100 ||
    !count(offset) ||
    offset > 1000000 ||
    items.length > limit
  )
    invalid();
  return { items: items.map(parse), total, limit, offset };
}

async function read(path: string, init: RequestInit = {}): Promise<unknown> {
  try {
    return await request(path, init, fetch);
  } catch (error) {
    if (error instanceof ActivityError) {
      throw new ShoeError(error.message, error.status, error.code);
    }
    throw error;
  }
}

async function write(path: string, method: string, body?: ShoeInput | ShoePatch | { shoe_id: string | null }) {
  const csrf = await read('/api/v1/auth/csrf');
  if (!object(csrf) || typeof csrf.csrf_token !== 'string' || !csrf.csrf_token) invalid();
  return read(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrf_token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function listShoes(
  status: ShoeStatus,
  offset = 0,
  order: 'reminder' | 'name' = 'reminder',
  limit = 20,
): Promise<ShoeList> {
  const query = new URLSearchParams({ status, order, offset: String(offset), limit: String(limit) });
  return listing(await read('/api/v1/me/shoes?' + query), parseShoe);
}

export async function getShoe(id: string): Promise<ShoeView> {
  return parseShoe(await read('/api/v1/me/shoes/' + identifier(id)));
}

export async function createShoe(body: ShoeInput): Promise<ShoeView> {
  return parseShoe(await write('/api/v1/me/shoes', 'POST', body));
}

export async function editShoe(id: string, body: ShoePatch): Promise<ShoeView> {
  return parseShoe(await write('/api/v1/me/shoes/' + identifier(id), 'PATCH', body));
}

export async function deleteShoe(id: string): Promise<void> {
  const value = await write('/api/v1/me/shoes/' + identifier(id), 'DELETE');
  if (!object(value) || value.deleted !== true) invalid();
}

export async function shoeActivities(id: string, offset = 0): Promise<ShoeActivities> {
  return listing(await read('/api/v1/me/shoes/' + identifier(id) + '/activities?offset=' + offset), parseActivity);
}

function binding(value: unknown): ShoeBinding {
  if (!object(value)) invalid();
  return { shoe: value.shoe === null ? null : parseRef(value.shoe) };
}

export async function readBinding(id: string): Promise<ShoeBinding> {
  return binding(await read('/api/v1/me/activities/' + identifier(id) + '/shoe'));
}

export async function saveBinding(id: string, shoeId: string | null): Promise<ShoeBinding> {
  return binding(
    await write('/api/v1/me/activities/' + identifier(id) + '/shoe', 'PATCH', {
      shoe_id: shoeId === null ? null : identifier(shoeId),
    }),
  );
}

export function kilometersToMeters(value: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, '');
  if (whole.length > 6) return null;
  const fraction = (match[2] ?? '').padEnd(6, '0');
  const wholeMeters = String(Number(whole + fraction.slice(0, 3)));
  const millimeters = fraction.slice(3).replace(/0+$/, '');
  return millimeters ? wholeMeters + '.' + millimeters : wholeMeters;
}

export function metersToKilometers(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const padded = whole.padStart(4, '0');
  const decimals = (padded.slice(-3) + fraction).replace(/0+$/, '');
  return padded.slice(0, -3) + (decimals ? '.' + decimals : '');
}

const kilometers = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const kmLabel = (value: string) => kilometers.format(Number(value) / 1000) + ' km';
export const remainingLabel = (value: string) => (Number(value) < 100 ? '剩余不足 0.1 km' : '剩余 ' + kmLabel(value));
export const reminderLabel = (reminder: ShoeView['reminder']) => (reminder === 'due' ? '已达替换里程' : '接近替换里程');
