import type { User } from '#lib/api/auth.ts';
declare global {
  namespace App { interface Locals { user: User | null; authError: string | null } }
}
export {};
