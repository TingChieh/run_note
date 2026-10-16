import type { User } from '#lib/api/auth.ts';
declare global {
  namespace App {
    interface Locals { user: User | null; authError: string | null }
    interface PageState { activityBackAvailable?: boolean }
  }
}
export {};
