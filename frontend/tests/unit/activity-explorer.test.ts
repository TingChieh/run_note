import { expect, it } from 'vitest';
import { readActivities, readActivityCategories } from '../../src/lib/api/activities';

it('encodes exact category history including empty and punctuation without changing default lists', async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async input => { paths.push(String(input)); return Response.json({ data:{items:[],total:0,limit:20,offset:20},error:null }); };
  await readActivities(fetcher,20,undefined,'比赛&恢复');
  await readActivities(fetcher,20,undefined,'');
  await readActivities(fetcher,20);
  expect(paths).toEqual(['/api/v1/activities?limit=20&offset=20&category=%E6%AF%94%E8%B5%9B%26%E6%81%A2%E5%A4%8D','/api/v1/activities?limit=20&offset=20&category=','/api/v1/activities?limit=20&offset=20']);
});

it('validates private categories before presenting filter options', async () => {
  const fetcher = (data: unknown): typeof fetch => async () => Response.json({data,error:null});
  await expect(readActivityCategories(fetcher(['','轻松跑','比赛&恢复']))).resolves.toEqual(['','轻松跑','比赛&恢复']);
  for (const data of [null, {}, ['字'.repeat(31)], [2], ['重复','重复']]) await expect(readActivityCategories(fetcher(data))).rejects.toThrow('无效响应');
});


it('filters the chosen calendar month and rejects malformed months before reading', async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async input => { paths.push(String(input)); return Response.json({data:{items:[],total:0,limit:20,offset:0},error:null}); };
  await readActivities(fetcher,0,undefined,'轻松跑','2024-02');
  expect(paths).toEqual(['/api/v1/activities?limit=20&offset=0&category=%E8%BD%BB%E6%9D%BE%E8%B7%91&activity_month=2024-02']);
  for (const month of ['2024-13','2024-00','0000-01','2024-2']) await expect(readActivities(fetcher,0,undefined,undefined,month)).rejects.toThrow();
  expect(paths).toHaveLength(1);
});
