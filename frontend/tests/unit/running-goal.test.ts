import { describe, it, expect } from 'vitest';
import { goalRange, validGoal, readGoals, saveGoal } from '../../src/lib/api/running-goal';
describe('personal running goal', () => {
  it('uses account local dates, Monday weeks and exclusive calendar end dates', () => {
    const now = new Date('2026-12-31T18:00:00Z');
    expect(goalRange('week', 'Asia/Shanghai', now)).toEqual({ from:'2026-12-28', to:'2027-01-04' });
    expect(goalRange('month', 'Asia/Shanghai', now)).toEqual({ from:'2027-01-01', to:'2027-02-01' });
    expect(goalRange('year', 'America/Los_Angeles', now)).toEqual({ from:'2026-01-01', to:'2027-01-01' });
    expect(goalRange('month', 'UTC', new Date('2024-02-29T12:00:00Z'))).toEqual({ from:'2024-02-01', to:'2024-03-01' });
  });
  it('accepts positive kilometre goals and rejects invalid or excessive precision', () => {
    expect(validGoal('50.5')).toBe(50.5);
    for (const value of ['0','-1','NaN','Infinity','10.55','100001','1e3','']) expect(validGoal(value)).toBeNull();
  });
  it('reads all account targets from the backend and preserves unset periods', async () => {
    const fetcher = (async (path: string) => {
      expect(path).toBe('/api/v1/me/running-goals');
      return Response.json({data:{week:5.5,month:null,year:500}});
    }) as typeof fetch;
    expect(await readGoals(fetcher)).toEqual({week:5.5,month:null,year:500});
  });
  it('saves only the selected period with fresh CSRF and returns the confirmed target', async () => {
    const fetcher = (async (path: string, init?: RequestInit) => {
      if(path.endsWith('/csrf')) return Response.json({data:{csrf_token:'fresh-token'}});
      expect(path).toBe('/api/v1/me/running-goals/month');
      expect(init?.method).toBe('PUT');
      expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('fresh-token');
      expect(JSON.parse(init?.body as string)).toEqual({target_km:50.5});
      return Response.json({data:{period:'month',target_km:50.5}});
    }) as typeof fetch;
    expect(await saveGoal('month',50.5,fetcher)).toBe(50.5);
  });
  it('rejects invalid backend values and propagates failed writes', async () => {
    for(const week of ['5',-1,5.55]) {
      await expect(readGoals((async()=>Response.json({data:{week,month:null,year:null}})) as typeof fetch)).rejects.toThrow();
    }
    const fetcher = (async(path:string)=>path.endsWith('/csrf') ? Response.json({data:{csrf_token:'token'}}) : Response.json({error:{message:'保存失败'}},{status:503})) as typeof fetch;
    await expect(saveGoal('week',5,fetcher)).rejects.toThrow('保存失败');
  });
});
