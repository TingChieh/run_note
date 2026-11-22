import { ActivityError, request } from './activities.ts';
import type { DiaryInput, DiaryPhotoView, DiaryView } from './generated/api.ts';

export type { DiaryInput, DiaryPhotoView, DiaryView };

export const moods = {
  very_bad: '很差',
  bad: '较差',
  neutral: '一般',
  good: '良好',
  very_good: '很好',
} satisfies Record<NonNullable<DiaryView['mood']>, string>;

export const weatherTypes = {
  clear: '晴',
  cloudy: '阴 / 多云',
  rain: '雨',
  snow: '雪',
  windy: '大风',
  other: '其他',
} satisfies Record<NonNullable<DiaryView['weather']>, string>;

export const maxPhotos = 6;
const photoSide = 1100;
const maxBytes = 5 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;

function invalid(): never {
  throw new ActivityError('日记服务返回了无效响应，请重试', 502, 'INVALID_RESPONSE');
}

function path(id: string, photoId?: string): string {
  if (!uuid.test(id) || (photoId !== undefined && !uuid.test(photoId))) {
    throw new ActivityError('记录不存在', 404, 'RESOURCE_NOT_FOUND');
  }
  const diary = `/api/v1/me/activities/${id}/diary`;
  return photoId === undefined ? diary : `${diary}/photos/${photoId}`;
}

function parsePhoto(value: unknown): DiaryPhotoView {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !uuid.test(value.id) ||
    !integer(value.width, photoSide) ||
    !integer(value.height, photoSide)
  )
    invalid();
  return { id: value.id, width: value.width, height: value.height };
}

function parseDetail(value: unknown): DiaryView | null {
  if (!object(value)) invalid();
  if (value.diary === null) return null;
  if (!object(value.diary)) invalid();
  const { mood, rpe, weather, notes, photos } = value.diary;
  if (
    !(mood === null || (typeof mood === 'string' && Object.hasOwn(moods, mood))) ||
    !(rpe === null || integer(rpe, 10)) ||
    !(weather === null || (typeof weather === 'string' && Object.hasOwn(weatherTypes, weather))) ||
    !(notes === null || (typeof notes === 'string' && [...notes].length <= 5000)) ||
    !Array.isArray(photos) ||
    photos.length > maxPhotos
  )
    invalid();
  const images = photos.map(parsePhoto);
  if (new Set(images.map((photo) => photo.id)).size !== images.length) invalid();
  return { mood: mood as DiaryView['mood'], rpe, weather: weather as DiaryView['weather'], notes, photos: images };
}

async function write(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: DiaryInput | FormData) {
  const csrf = await request('/api/v1/auth/csrf', {}, fetch);
  if (!object(csrf) || typeof csrf.csrf_token !== 'string' || !csrf.csrf_token) invalid();
  const headers = new Headers({ 'X-CSRF-Token': csrf.csrf_token });
  if (method === 'PUT') headers.set('Content-Type', 'application/json');
  return request(url, { method, headers, body: body instanceof FormData ? body : JSON.stringify(body) }, fetch, 15000);
}

export async function readDiary(id: string) {
  return parseDetail(await request(path(id), {}, fetch));
}

export async function saveDiary(id: string, input: DiaryInput) {
  const result = parseDetail(await write(path(id), 'PUT', input));
  return result ?? invalid();
}

export async function deleteDiary(id: string, photoId?: string) {
  const result = await write(path(id, photoId), 'DELETE');
  if (!object(result) || result.deleted !== true) invalid();
}

export async function uploadDiaryPhoto(id: string, file: File) {
  if (file.size > maxBytes) throw new ActivityError('图片不能超过 5 MiB', 413, 'IMAGE_TOO_LARGE');
  const body = new FormData();
  body.append('file', file);
  return parsePhoto(await write(path(id) + '/photos', 'POST', body));
}

export async function readDiaryPhoto(id: string, photoId: string, signal: AbortSignal) {
  const response = await fetch(path(id, photoId), {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (response.status === 401) throw new ActivityError('登录已过期，请重新登录', 401, 'AUTH_REQUIRED');
  if (!response.ok || response.headers.get('Content-Type') !== 'image/png') {
    throw new ActivityError('无法读取照片', response.status);
  }
  const image = await response.blob();
  if (image.size < 1 || image.size > maxBytes) invalid();
  return image;
}
