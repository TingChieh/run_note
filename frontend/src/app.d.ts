import type { ShowcaseProfile } from '#lib/api/showcase.ts';
import type { User } from '#lib/api/auth.ts';
import type { Site } from '#lib/site.ts';
declare global {
  const __RUNNOTE_MOBILE_BUNDLE__: boolean | undefined;
  const __RUNNOTE_APP_VERSION__: string | undefined;
  namespace App {
    interface Locals { user: User | null; authError: string | null; showcase: ShowcaseProfile | null; showcaseError: string | null; site: Site }
    interface PageState { activityBackAvailable?: boolean }
  }
}
export {};
