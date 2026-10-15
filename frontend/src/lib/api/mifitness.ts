import { ActivityError, parseActivity, request, validateDeviceMetrics, warningLabel, type Activity } from './activities.ts';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = ['distance','duration','start_time','end_time','calories','steps','avg_hrm','max_hrm','min_hrm','avg_cadence','max_cadence','vo2_max','train_load','train_effect','anaerobic_train_effect','avg_stride','recover_time','avg_speed','max_speed','avg_pace','timezone','hrm_aerobic_duration','hrm_anaerobic_duration','hrm_extreme_duration','hrm_fat_burning_duration','hrm_warm_up_duration'];
export interface PreparedRecord { record: { source_time: number; source_metrics: Record<string, number | null> }; hasDownloadedTrack: boolean; file?: File }
export interface MifitnessPreview extends Pick<Activity, 'activity_date' | 'timezone' | 'started_at' | 'ended_at' | 'distance_m' | 'timer_seconds' | 'elapsed_seconds' | 'calories_kcal' | 'steps' | 'avg_heart_rate_bpm' | 'max_heart_rate_bpm' | 'min_heart_rate_bpm' | 'avg_cadence_spm' | 'max_cadence_spm' | 'vo2_max_ml_kg_min' | 'training_load' | 'aerobic_training_effect' | 'anaerobic_training_effect' | 'has_route'> { point_count: number; segment_count: number; warnings: string[]; suspected_activity_ids: string[] }
function invalid(): never { throw new ActivityError('Mi Fitness 服务返回了无效响应，请重试',502,'INVALID_RESPONSE'); }
function inputError(message: string): never { throw new ActivityError(message,422,'MIFITNESS_INPUT_INVALID'); }
export function parsePreparedRecords(value: unknown): PreparedRecord[] {
  if (!object(value) || !Array.isArray(value.records) || value.records.length < 1 || value.records.length > 1000) inputError('汇总文件需包含 1–1000 条跑步记录');
  const seen = new Set<number>();
  return value.records.map((item: unknown) => {
    if (!object(item) || typeof item.source_time !== 'number' || !Number.isSafeInteger(item.source_time) || typeof item.has_downloaded_track !== 'boolean' || !object(item.source_metrics)) inputError('汇总记录格式不正确，请核对来源时间和指标');
    if (seen.has(item.source_time)) inputError('汇总中存在重复来源时间，无法唯一匹配');
    seen.add(item.source_time);
    const metrics: Record<string, number | null> = {};
    for (const field of fields) {
      const metric = item.source_metrics[field];
      if (metric === undefined) continue;
      if (metric !== null && (typeof metric !== 'number' || !Number.isFinite(metric))) inputError(`汇总指标 ${field} 必须是数字或空值`);
      metrics[field] = metric as number | null;
    }
    for (const field of ['distance','duration']) if (typeof metrics[field] !== 'number' || metrics[field]! < 0 || metrics[field]! >= 1e9) inputError('距离和用时必须是有效数字，且小于十亿');
    if (!Number.isSafeInteger(metrics.start_time) || !Number.isSafeInteger(metrics.end_time) || metrics.start_time !== item.source_time || metrics.end_time! < metrics.start_time! || metrics.end_time! - metrics.start_time! >= 1e9) inputError('来源时间须与开始时间相同，起止时间须为有效整数秒');
    for (const field of ['start_time','end_time']) {
      const year = new Date(metrics[field]! * 1000).getUTCFullYear();
      if (!Number.isFinite(year) || year < 1 || year > 9999) inputError('设备起止时间超出有效日期范围');
    }
    const record = { source_time: item.source_time, source_metrics: metrics };
    if (new TextEncoder().encode(JSON.stringify(record)).length > 4096) inputError('单条汇总不能超过 4096 字节');
    return { record, hasDownloadedTrack: item.has_downloaded_track };
  });
}
export async function readPreparedFile(file: File): Promise<PreparedRecord[]> {
  if (file.size > 2 * 1024 * 1024) inputError('汇总 JSON 文件不能超过 2 MiB');
  let value: unknown; try { value = JSON.parse(await file.text()); } catch { return inputError('无法读取汇总 JSON 文件'); }
  return parsePreparedRecords(value);
}
export function matchTrackFiles(records: PreparedRecord[], files: File[]): PreparedRecord[] {
  if (files.length > 1000) inputError('一次最多选择 1000 个 GPX 文件');
  const indexed = new Map<string, File>();
  for (const file of files) {
    if (indexed.has(file.name)) inputError(`GPX 文件名重复：${file.name}`);
    if (file.size > 10 * 1024 * 1024) inputError('单个 GPX 文件不能超过 10 MiB');
    if (!records.some(item => file.name === `running_${item.record.source_time}.gpx`)) inputError(`GPX 文件无法精确匹配汇总：${file.name}`);
    indexed.set(file.name,file);
  }
  return records.map(item => {
    const file = indexed.get(`running_${item.record.source_time}.gpx`);
    if (item.hasDownloadedTrack && !file) inputError(`缺少 running_${item.record.source_time}.gpx，请选择已下载的轨迹文件`);
    return { ...item, file };
  });
}
export function parsePreview(value: unknown): MifitnessPreview {
  if (!object(value) || typeof value.activity_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.activity_date) || !Number.isFinite(Date.parse(value.activity_date)) || new Date(value.activity_date).toISOString().slice(0,10) !== value.activity_date || typeof value.timezone !== 'string' || typeof value.has_route !== 'boolean') invalid();
  try { new Intl.DateTimeFormat('en',{timeZone:value.timezone}); } catch { invalid(); }
  for (const field of ['started_at','ended_at']) if (typeof value[field] !== 'string' || !Number.isFinite(Date.parse(value[field] as string))) invalid();
  for (const field of ['distance_m','timer_seconds','elapsed_seconds']) {
    const metric=value[field];
    if ((typeof metric !== 'number' && typeof metric !== 'string') || (typeof metric === 'string' && !/^\d+(\.\d+)?$/.test(metric)) || !Number.isFinite(Number(metric)) || Number(metric)<0 || Number(metric)>=1e9) invalid();
  }
  for (const field of ['calories_kcal','steps','avg_heart_rate_bpm']) { const metric=value[field]; if (metric !== null && (typeof metric !== 'number' || !Number.isInteger(metric) || metric < (field==='avg_heart_rate_bpm'?1:0) || metric > (field==='avg_heart_rate_bpm'?300:999999999))) invalid(); }
  validateDeviceMetrics(value);
  for (const field of ['point_count','segment_count']) if (!Number.isInteger(value[field]) || Number(value[field])<0 || Number(value[field])>200000) invalid();
  if (!Array.isArray(value.warnings) || value.warnings.some(item=>typeof item!=='string') || !Array.isArray(value.suspected_activity_ids) || value.suspected_activity_ids.some(item=>typeof item!=='string'||!uuid.test(item))) invalid();
  return value as unknown as MifitnessPreview;
}
async function submit(item: PreparedRecord, timezone: string, options: {preview?: boolean; confirmSimilar?: boolean; enrichActivityId?: string}, fetcher: typeof fetch): Promise<unknown> {
  const csrf = await request('/api/v1/auth/csrf',{},fetcher);
  if (!object(csrf) || typeof csrf.csrf_token !== 'string' || !csrf.csrf_token) invalid();
  const form = new FormData(); form.append('record',JSON.stringify(item.record));
  if (item.file) form.append('file',item.file);
  if (timezone.trim()) form.append('timezone',timezone.trim());
  if (options.confirmSimilar) form.append('confirm_similar','true');
  if (options.enrichActivityId) { if (!uuid.test(options.enrichActivityId)) inputError('已有记录标识无效'); form.append('enrich_activity_id',options.enrichActivityId); }
  return request(`/api/v1/mifitness-imports${options.preview?'?preview=true':''}`,{method:'POST',headers:{'X-CSRF-Token':csrf.csrf_token},body:form},fetcher,45000);
}
export async function previewMifitness(item: PreparedRecord, timezone: string, fetcher: typeof fetch = fetch): Promise<MifitnessPreview> { return parsePreview(await submit(item,timezone,{preview:true},fetcher)); }
export async function saveMifitness(item: PreparedRecord, timezone: string, options: {confirmSimilar?: boolean; enrichActivityId?: string} = {}, fetcher: typeof fetch = fetch): Promise<{activity:Activity;warnings:string[]}> {
  const value=await submit(item,timezone,options,fetcher);
  if (!object(value) || !Array.isArray(value.warnings) || value.warnings.some(item=>typeof item!=='string')) invalid();
  return {activity:parseActivity(value.activity),warnings:value.warnings as string[]};
}
export const mifitnessWarningLabel = warningLabel;
