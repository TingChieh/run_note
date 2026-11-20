// Compile-time contract between the backend schemas and the frontend API layer, checked by
// `pnpm check`. Never imported at runtime.
//
// Each entry is `(backend) => frontend`: everything the backend can send must fit the type the
// frontend's parser promises, so renaming, removing or loosening a backend field fails here instead
// of in the browser. `Narrowed<T, K>` marks a field the frontend parser deliberately accepts in a
// narrower form than the backend sends; each one says why.
import type { RequestBody, ResponseData } from '#lib/api/generated/api.ts';
import type { Activity, ActivityList, Route } from '#lib/api/activities.ts';
import type { Footprints } from '#lib/api/footprints.ts';
import type { AdminUserList } from '#lib/api/admin-users.ts';
import type { Context, Create, Report, ReportList } from '#lib/api/ai.ts';
import type { User } from '#lib/api/auth.ts';
import type { GlobalFootprints, Provinces, Streaks } from '#lib/api/milestones.ts';
import type { PeriodReport } from '#lib/api/period-report.ts';
import type { Records } from '#lib/api/records.ts';
import type { ReplayData } from '#lib/api/replay.ts';
import type { RouteGroupDetail, RouteGroupList } from '#lib/api/route-groups.ts';
import type { CreatedShare, PublicActivity, Share } from '#lib/api/sharing.ts';
import type { ShowcaseProfile } from '#lib/api/showcase.ts';
import type { Calendar, Summary, Trends } from '#lib/api/statistics.ts';
import type { FeedPage } from '#lib/api/together.ts';
import type { VersionInfo } from '#lib/api/version.ts';

type Narrowed<T, K extends keyof T> = Omit<T, K> & { [P in K]: unknown };
type Items<T extends { items: unknown[] }, Item> = Omit<T, 'items'> & { items: Item[] };
/** Request direction: what the frontend sends must not carry keys the strict backend rejects. */
type NoExtraKeys<Sent, Accepted> = Exclude<keyof Sent, keyof Accepted> extends never ? Sent : never;

type RouteShape = Narrowed<Route, 'start' | 'end'>;

export const responses = {
  activityDetail: (v: ResponseData<'/api/v1/activities/{identifier}', 'get'>): Activity => v,
  activityList: (v: ResponseData<'/api/v1/activities', 'get'>): ActivityList => v,
  publicActivity: (v: ResponseData<'/api/v1/public/activities/{identifier}', 'get'>): PublicActivity => v,
  sharedActivity: (v: ResponseData<'/api/v1/shared/{token}', 'get'>): PublicActivity => v,
  shares: (v: ResponseData<'/api/v1/activities/{identifier}/shares', 'get'>): { items: Share[] } => v,
  shareCreated: (v: ResponseData<'/api/v1/activities/{identifier}/shares', 'post'>): CreatedShare => v,
  summary: (v: ResponseData<'/api/v1/statistics/summary', 'get'>): Summary => v,
  calendar: (v: ResponseData<'/api/v1/statistics/calendar', 'get'>): Calendar => v,
  // The frontend only requests week/month; the backend also accepts year.
  trends: (v: ResponseData<'/api/v1/statistics/trends', 'get'>): Narrowed<Trends, 'period'> => v,
  records: (v: ResponseData<'/api/v1/statistics/records', 'get'>): Records => v,
  periodReport: (v: ResponseData<'/api/v1/statistics/report', 'get'>): PeriodReport => v,
  showcasePeriodReport: (v: ResponseData<'/api/v1/showcase/statistics/report', 'get'>): PeriodReport => v,
  me: (v: ResponseData<'/api/v1/me', 'get'>): User => v,
  // An activity without segments sends start/end null; readRoute rejects that, and callers only
  // read routes when has_route is true.
  route: (v: ResponseData<'/api/v1/activities/{identifier}/route', 'get'>): RouteShape => v,
  showcaseRoute: (v: ResponseData<'/api/v1/showcase/activities/{identifier}/route', 'get'>): RouteShape => v,
  adminRoute: (v: ResponseData<'/api/v1/admin/users/{user_id}/activities/{activity_id}/route', 'get'>): RouteShape => v,
  replay: (v: ResponseData<'/api/v1/activities/{identifier}/replay', 'get'>): ReplayData => v,
  showcaseReplay: (v: ResponseData<'/api/v1/showcase/activities/{identifier}/replay', 'get'>): ReplayData => v,
  footprints: (v: ResponseData<'/api/v1/footprints', 'get'>): Footprints => v,
  showcaseFootprints: (v: ResponseData<'/api/v1/showcase/footprints', 'get'>): Footprints => v,
  global: (v: ResponseData<'/api/v1/footprints/global', 'get'>): GlobalFootprints => v,
  showcaseGlobal: (v: ResponseData<'/api/v1/showcase/footprints/global', 'get'>): GlobalFootprints => v,
  streaks: (v: ResponseData<'/api/v1/statistics/streaks', 'get'>): Streaks => v,
  showcaseStreaks: (v: ResponseData<'/api/v1/showcase/statistics/streaks', 'get'>): Streaks => v,
  provinces: (v: ResponseData<'/api/v1/footprints/provinces', 'get'>): Provinces => v,
  showcaseProvinces: (v: ResponseData<'/api/v1/showcase/footprints/provinces', 'get'>): Provinces => v,
  adminUsers: (v: ResponseData<'/api/v1/admin/users', 'get'>): AdminUserList => v,
  // stats_snapshot is stored JSON with a schema_version; older reports must stay readable, so the
  // backend keeps it a dict and ai.ts validates the current shape.
  aiContext: (v: ResponseData<'/api/v1/ai-reports/context', 'get'>): Narrowed<Context, 'stats_snapshot'> => v,
  aiReports: (v: ResponseData<'/api/v1/ai-reports', 'get'>): Items<ReportList, Narrowed<Report, 'stats_snapshot'>> => v,
  routeGroups: (v: ResponseData<'/api/v1/routes/groups', 'get'>): RouteGroupList => v,
  routeGroup: (v: ResponseData<'/api/v1/routes/groups/{identifier}', 'get'>): RouteGroupDetail => v,
  showcaseProfile: (v: ResponseData<'/api/v1/showcase/profile', 'get'>): ShowcaseProfile => v,
  togetherFeed: (v: ResponseData<'/api/v1/together/feed', 'get'>): FeedPage => v,
  version: (v: ResponseData<'/api/v1/admin/version', 'get'>): VersionInfo => v,
};

export const requests = {
  aiCreate: (
    v: NoExtraKeys<Create, RequestBody<'/api/v1/ai-reports', 'post'>>,
  ): RequestBody<'/api/v1/ai-reports', 'post'> => v,
};

// Not listed: parsers that reshape the wire format into a different domain type (together.ts turns
// `tracks` into a footprint collection). Binary routes (images, CSV) are `unknown`.
