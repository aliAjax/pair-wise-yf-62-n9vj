/**
 * 初始账：预置"断链作业、回网待合并"的现场。
 *
 * 共享段（断链前双方一致）+ 岸基独有段 + 船艇独有段，
 * 条目对象在双方日志中共用以保证 id 一致（模拟已同步过的历史）。
 */

import type { LedgerEntry, NodeId } from './types';

const MIN = 60_000;

function ago(min: number): string {
  return new Date(Date.now() - min * MIN).toISOString();
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, 'id' | 'idemKey' | 'origin' | 'recordedAt'> : never;
type EntryBody = DistributiveOmit<LedgerEntry, 'id' | 'idemKey' | 'origin' | 'recordedAt'>;

function e(
  id: string,
  idemKey: string,
  origin: NodeId,
  time: string,
  payload: EntryBody
): LedgerEntry {
  return { id, idemKey, origin, recordedAt: time, ...payload } as LedgerEntry;
}

export function buildSeed(): { shoreEntries: LedgerEntry[]; boatEntries: LedgerEntry[] } {
  // ---------- 共享段：断链前已同步 ----------
  const shared: LedgerEntry[] = [
    e('seed-area-a', 'area:area-a', 'shore', ago(30), {
      kind: 'AreaRegistered', areaId: 'area-a', name: 'A区 · 最后目击点',
      bounds: [121.42, 30.65, 121.68, 30.88], status: 'active'
    }),
    e('seed-area-b', 'area:area-b', 'shore', ago(30), {
      kind: 'AreaRegistered', areaId: 'area-b', name: 'B区 · 北向漂流',
      bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned'
    }),
    e('seed-ship', 'unit:ship-01', 'shore', ago(29), {
      kind: 'UnitRegistered', unitId: 'ship-01', name: '海巡071', unitType: 'ship', lat: 30.70, lng: 121.48
    }),
    e('seed-heli', 'unit:heli-02', 'shore', ago(29), {
      kind: 'UnitRegistered', unitId: 'heli-02', name: '救助B-712', unitType: 'helicopter', lat: 30.84, lng: 121.70
    }),
    e('seed-drone', 'unit:drone-03', 'shore', ago(29), {
      kind: 'UnitRegistered', unitId: 'drone-03', name: '无人机D-9', unitType: 'drone', lat: 30.69, lng: 121.61
    }),
    e('seed-m1', 'mission-open:mission-1', 'shore', ago(20), {
      kind: 'MissionOpened', missionId: 'mission-1', title: 'A区扇形搜索', areaId: 'area-a',
      unitIds: ['ship-01', 'drone-03'], priority: 'urgent', note: '优先核验橙色漂浮物'
    }),
    // 船艇与无人机的在途回执（均挂任务单 gen=1）
    e('seed-r1', 'receipt:ship-01:1', 'boat', ago(14), {
      kind: 'PositionReported', unitId: 'ship-01', seq: 1, lat: 30.71, lng: 121.50,
      observedAt: ago(14), missionId: 'mission-1', missionGen: 1
    }),
    e('seed-r2', 'receipt:ship-01:2', 'boat', ago(12), {
      kind: 'CoverageReported', unitId: 'ship-01', seq: 2, missionId: 'mission-1', areaId: 'area-a',
      missionGen: 1, percent: 45, observedAt: ago(12)
    }),
    e('seed-r3', 'receipt:drone-03:1', 'boat', ago(13), {
      kind: 'PositionReported', unitId: 'drone-03', seq: 1, lat: 30.74, lng: 121.57,
      observedAt: ago(13), missionId: 'mission-1', missionGen: 1
    }),
    e('seed-r4', 'receipt:drone-03:2', 'boat', ago(11), {
      kind: 'CoverageReported', unitId: 'drone-03', seq: 2, missionId: 'mission-1', areaId: 'area-a',
      missionGen: 1, percent: 68, observedAt: ago(11)
    }),
    e('seed-r5', 'receipt:heli-02:1', 'boat', ago(12), {
      kind: 'PositionReported', unitId: 'heli-02', seq: 1, lat: 30.84, lng: 121.70,
      observedAt: ago(12), missionId: null, missionGen: null
    }),
    e('seed-r6', 'receipt:ship-01:3', 'boat', ago(9), {
      kind: 'PositionReported', unitId: 'ship-01', seq: 3, lat: 30.78, lng: 121.60,
      observedAt: ago(9), missionId: 'mission-1', missionGen: 1
    })
  ];

  // ---------- 断链 8 分钟前开始，以下为各自独有 ----------
  const shoreOnly: LedgerEntry[] = [
    // 岸基修改任务说明（基于 rev=1）
    e('seed-s1', 'mission-patch:mission-1:note@1="岸基：傍晚转东北风6级，收紧返航时限"', 'shore', ago(6.5), {
      kind: 'MissionPatched', missionId: 'mission-1',
      changes: { note: { value: '岸基：傍晚转东北风6级，收紧返航时限', baseRev: 1, baseValue: '优先核验橙色漂浮物' } }
    }),
    // 岸基关闭任务单（基于自己看到的 gen=2）→ 旧覆盖率/在途位置将全部失效
    e('seed-s2', 'mission-status:shore:mission-1:closed:2', 'shore', ago(4), {
      kind: 'MissionStatusChanged', missionId: 'mission-1', status: 'closed', fromGen: 2
    }),
    // 已完成航迹归档（海巡071 在 mission-1 上的轨迹点）
    e('seed-s3', 'track:mission-1:ship-01', 'shore', ago(4), {
      kind: 'TrackArchived', track: {
        missionId: 'mission-1', areaId: 'area-a', unitId: 'ship-01', closedAt: ago(4), entryId: 'seed-s3',
        points: [
          { lat: 30.71, lng: 121.50, time: ago(14) },
          { lat: 30.75, lng: 121.55, time: ago(11) },
          { lat: 30.78, lng: 121.60, time: ago(9) }
        ]
      }
    }),
    // 新任务派往 B 区（不会把单位再派回旧的 A 区）
    e('seed-s4', 'mission-open:mission-2', 'shore', ago(3), {
      kind: 'MissionOpened', missionId: 'mission-2', title: 'B区北向漂流搜索', areaId: 'area-b',
      unitIds: ['heli-02'], priority: 'normal', note: '按漂移带向东北方向扩展'
    })
  ];

  const boatOnly: LedgerEntry[] = [
    // 船艇同时改了同一字段（也基于 rev=1）→ 回网挂起为字段冲突，两版都保留
    e('seed-b1', 'mission-patch:mission-1:note@1="船艇：D-9电量40%，建议轮换回收"', 'boat', ago(6), {
      kind: 'MissionPatched', missionId: 'mission-1',
      changes: { note: { value: '船艇：D-9电量40%，建议轮换回收', baseRev: 1, baseValue: '优先核验橙色漂浮物' } }
    }),
    // 失联无人机离线缓存的旧版回执（mission-1 已被岸基关闭）→ 合并后判失效，绝不能复活任务
    e('seed-b2', 'receipt:drone-03:3', 'boat', ago(3), {
      kind: 'CoverageReported', unitId: 'drone-03', seq: 3, missionId: 'mission-1', areaId: 'area-a',
      missionGen: 1, percent: 72, observedAt: ago(3)
    }),
    e('seed-b3', 'receipt:drone-03:4', 'boat', ago(2), {
      kind: 'PositionReported', unitId: 'drone-03', seq: 4, lat: 30.80, lng: 121.63,
      observedAt: ago(2), missionId: 'mission-1', missionGen: 1
    })
  ];

  return {
    shoreEntries: [...shared, ...shoreOnly],
    boatEntries: [...shared, ...boatOnly]
  };
}
