import type { ShowcaseProfile } from '#lib/api/showcase.ts';
import type { User } from '#lib/api/auth.ts';
declare global {
  namespace App {
    interface Locals { user: User | null; authError: string | null; showcase: ShowcaseProfile | null; showcaseError: string | null }
    interface PageState { activityBackAvailable?: boolean }
  }
}
export {};
