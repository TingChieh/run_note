import { describe, it, expect } from 'vitest';
import { parsePublicActivity, publicProfilePath, sharingWrite } from '../../src/lib/api/sharing';
import { isProtected } from '../../src/lib/api/auth';
describe('public sharing', () => {
  it('anonymous pages are outside the authentication gate', () => {
    for (const path of ['/u/runner','/shared/token','/public/activities/id']) expect(isProtected(path)).toBe(false);
    expect(publicProfilePath('a/b')).toBe('/u/a%2Fb');
  });
  it('rejects invalid summaries and coordinate exposure', () => {
    const value = { id:'1',title:'Run',activity_date:'2024-01-01',distance_m:'1000',elapsed_seconds:null,avg_pace_seconds_per_km:null,author:{username:'runner',display_name:'Runner'},has_shared_route:false };
    expect(parsePublicActivity(value).title).toBe('Run');
    expect(() => parsePublicActivity({...value, has_shared_route:true})).toThrow();
    expect(() => parsePublicActivity({...value, distance_m:-1})).toThrow();
  });
  it('uses fresh csrf for writes', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fake = (async (path: string, init?: RequestInit) => {
      calls.push([path,init]);
      return Response.json({data:path.endsWith('csrf')?{csrf_token:'fresh'}:{revoked:true},error:null});
    }) as typeof fetch;
    await sharingWrite('/api/v1/activities/id/shares/link','DELETE',undefined,fake);
    expect(calls.map(c => c[0])).toEqual(['/api/v1/auth/csrf','/api/v1/activities/id/shares/link']);
    expect(calls[1][1]?.headers).toEqual({'Content-Type':'application/json','X-CSRF-Token':'fresh'});
  });
});
