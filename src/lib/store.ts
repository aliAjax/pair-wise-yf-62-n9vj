'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ArchivedTrack,
  AreaStatus,
  AssetStatus,
  ConflictRecord,
  EventLog,
  LedgerEntry,
  Mission,
  MissionStatus,
  PositionReceipt,
  RescueAsset,
  SearchArea,
  SyncResult,
  TaskReceipt
} from './types';
import { cellCenter, nextSeqFor, positionKey, taskKey } from './ledger';

const now = Date.now();
const iso = (t: number = now) => new Date(t).toISOString();
const uuid = () => crypto.randomUUID();

/* ----------------------------- 初始台账数据 ----------------------------- */

const areaAEpoch = new Date(now - 2 * 60 * 60_000).toISOString();
const areaBEpoch = new Date(now - 2 * 60 * 60_000).toISOString();

const initialAreas: SearchArea[] = [
  { id: 'area-a', name: 'A区 · 最后目击点', bounds: [121.42, 30.65, 121.68, 30.88], status: 'active', epoch: areaAEpoch, createdAt: areaAEpoch },
  { id: 'area-b', name: 'B区 · 北向漂流', bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned', epoch: areaBEpoch, createdAt: areaBEpoch }
];

const initialAssets: RescueAsset[] = [
  { id: 'ship-01', serial: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: iso(now - 20_000) },
  { id: 'heli-02', serial: 'heli-02', name: '救助B-712', type: 'helicopter', status: 'ready', lat: 30.82, lng: 121.73, lastSeen: iso(now - 40_000) },
  { id: 'drone-03', serial: 'drone-03', name: '无人机D-9', type: 'drone', status: 'offline', lat: 30.70, lng: 121.62, lastSeen: iso(now - 18 * 60_000) }
];

const initialMissions: Mission[] = [
  {
    id: 'mission-1',
    title: 'A区扇形搜索',
    areaId: 'area-a',
    assetIds: ['ship-01', 'drone-03'],
    status: 'in_progress',
    priority: 'urgent',
    note: '优先核验橙色漂浮物',
    createdAt: iso(now - 50 * 60_000),
    updatedAt: iso(now - 6 * 60_000),
    invalidatedAssetIds: []
  }
];

/** 种子位置回执：A区扫海 24 格、B区 12 格、无人机 1 条已过期 */
function seedReceipts(): PositionReceipt[] {
  const receipts: PositionReceipt[] = [];
  let n = 0;
  const push = (unitSerial: string, seq: number, lat: number, lng: number, t: number) => {
    receipts.push({ id: `seed-${n++}`, unitSerial, seq, lat, lng, time: iso(t), recordedAt: iso(t), source: 'online' });
  };
  const areaA = initialAreas[0];
  let seq = 1;
  // A区：扫过 0..3 行共 24 格，时间散布在最近 9 分钟内（均未过期）
  for (let cy = 0; cy < 4; cy += 1) {
    for (let cx = 0; cx < 6; cx += 1) {
      const [lat, lng] = cellCenter(areaA, cx, cy);
      push('ship-01', seq++, lat, lng, now - (9 * 60_000 - (cy * 6 + cx) * 22_000));
    }
  }
  const areaB = initialAreas[1];
  seq = 1;
  for (let cy = 0; cy < 2; cy += 1) {
    for (let cx = 0; cx < 6; cx += 1) {
      const [lat, lng] = cellCenter(areaB, cx, cy);
      push('heli-02', seq++, lat, lng, now - (9 * 60_000 - (cy * 6 + cx) * 40_000));
    }
  }
  // 无人机失联前最后一条回执：18 分钟前，已过期
  push('drone-03', 1, 30.70, 121.62, now - 18 * 60_000);
  return receipts;
}

/** 无人机离线仓：3 条漂移位置 + 1 条任务回执（仍以为任务在 A 区进行中） */
function seedPending(): { positions: PositionReceipt[]; taskReceipts: TaskReceipt[] } {
  const positions: PositionReceipt[] = [2, 3, 4].map((seq, i) => ({
    id: `offline-pos-${i}`,
    unitSerial: 'drone-03',
    seq,
    lat: 30.70 + (i + 1) * 0.006,
    lng: 121.62 + (i + 1) * 0.006,
    time: iso(now - (14 - i * 5) * 60_000),
    recordedAt: iso(now - (14 - i * 5) * 60_000),
    source: 'offline' as const
  }));
  const taskReceipts: TaskReceipt[] = [{
    id: 'offline-task-0',
    unitSerial: 'drone-03',
    missionId: 'mission-1',
    seq: 1,
    status: 'in_progress',
    areaId: 'area-a',
    time: iso(now - 12 * 60_000),
    recordedAt: iso(now - 12 * 60_000),
    source: 'offline'
  }];
  return { positions, taskReceipts };
}

const initialEvents: EventLog[] = [
  { id: 'event-1', time: iso(now - 50 * 60_000), actor: '指挥员', message: 'A区任务下发，海巡071开始扇形搜索' },
  { id: 'event-2', time: iso(now - 18 * 60_000), actor: '无人机D-9', message: '链路中断，最后位置已标记为过期，进入离线缓存' }
];

/* --------------------------------- Store --------------------------------- */

interface CommandState {
  areas: SearchArea[];
  assets: RescueAsset[];
  missions: Mission[];
  events: EventLog[];
  ledger: LedgerEntry[];
  receipts: PositionReceipt[];
  taskReceipts: TaskReceipt[];
  pending: { positions: PositionReceipt[]; taskReceipts: TaskReceipt[] };
  lastBatch: { positions: PositionReceipt[]; taskReceipts: TaskReceipt[] };
  conflicts: ConflictRecord[];
  syncResults: SyncResult[];
  archive: ArchivedTrack[];
  offline: boolean;
  lowBandwidth: boolean;

  toggleOffline: () => void;
  toggleBandwidth: () => void;
  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  dispatchMission: (input: { title: string; areaId: string; assetIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  updateMission: (id: string, patch: { areaId?: string; status?: MissionStatus }) => void;
  recordOfflineFix: (assetId: string) => void;
  syncPending: (actor?: string) => void;
  resyncLastBatch: () => void;
  resolveConflict: (id: string, choice: 'local' | 'remote') => void;
}

interface MergeOutcome {
  receipts: PositionReceipt[];
  taskReceipts: TaskReceipt[];
  assets: RescueAsset[];
  missions: Mission[];
  conflicts: ConflictRecord[];
  applied: number;
  duplicates: number;
  conflictCount: number;
  events: EventLog[];
  ledger: LedgerEntry[];
}

/**
 * 合并一批离线回执（纯函数式，返回新状态片段）：
 * - 同一单位序号 + 回执序号只入账一次，重复回执计数但不应用；
 * - 任务回执与台账冲突时保留两版待确认，不覆盖。
 */
function mergeBatch(
  s: CommandState,
  batch: { positions: PositionReceipt[]; taskReceipts: TaskReceipt[] },
  actor: string
): MergeOutcome {
  const appliedPos = new Set(s.receipts.map((r) => positionKey(r.unitSerial, r.seq)));
  const appliedTask = new Set(s.taskReceipts.map((r) => taskKey(r.unitSerial, r.seq)));

  const receipts = [...s.receipts];
  const taskReceipts = [...s.taskReceipts];
  const assets = s.assets.map((a) => ({ ...a }));
  const missions = s.missions.map((m) => ({ ...m, invalidatedAssetIds: [...m.invalidatedAssetIds] }));
  const conflicts: ConflictRecord[] = [];
  const events: EventLog[] = [];
  const ledger: LedgerEntry[] = [];

  let applied = 0;
  let duplicates = 0;
  let conflictCount = 0;
  const t = iso();

  for (const r of batch.positions) {
    const key = positionKey(r.unitSerial, r.seq);
    if (appliedPos.has(key)) {
      duplicates += 1; // 重复回执：只计数，不入账
      continue;
    }
    appliedPos.add(key);
    receipts.push(r);
    applied += 1;
    const asset = assets.find((a) => a.serial === r.unitSerial);
    if (asset && new Date(r.time).getTime() >= new Date(asset.lastSeen).getTime()) {
      asset.lat = r.lat;
      asset.lng = r.lng;
      asset.lastSeen = r.time;
    }
    ledger.push({ id: uuid(), time: t, actor, kind: 'receipt', ref: r.unitSerial, message: `单位 ${r.unitSerial} 位置回执 #${r.seq} 入账（${r.source === 'offline' ? '离线' : '在线'}）` });
  }

  for (const r of batch.taskReceipts) {
    const key = taskKey(r.unitSerial, r.seq);
    if (appliedTask.has(key)) {
      duplicates += 1;
      continue;
    }
    appliedTask.add(key);
    taskReceipts.push(r);
    applied += 1;

    const mission = missions.find((m) => m.id === r.missionId);
    if (!mission) continue;

    if (mission.status === 'closed') {
      // 已完成任务：回执只入留档参考，不改账、不派回旧搜索区
      ledger.push({ id: uuid(), time: t, actor, kind: 'archive', ref: mission.id, message: `单位 ${r.unitSerial} 对已结束任务 ${mission.id} 的迟到回执留档，不重新派单` });
      continue;
    }

    const late = new Date(r.time).getTime() < new Date(mission.updatedAt).getTime();
    const statusDiffers = r.status !== mission.status;
    const areaDiffers = r.areaId !== mission.areaId;

    if (late && (statusDiffers || areaDiffers)) {
      // 两版冲突：台账版 vs 回执版，保留待确认，不覆盖
      conflictCount += 1;
      const field: 'status' | 'areaId' = statusDiffers ? 'status' : 'areaId';
      conflicts.push({
        id: uuid(),
        detectedAt: t,
        refType: 'mission',
        refId: mission.id,
        field,
        local: field === 'status' ? mission.status : mission.areaId,
        remote: field === 'status' ? r.status : r.areaId,
        status: 'pending'
      });
      events.push({ id: uuid(), time: t, actor, message: `任务 ${mission.title} 出现${field === 'status' ? '状态' : '搜索区'}冲突：台账版 ${field === 'status' ? mission.status : mission.areaId} / 回执版 ${field === 'status' ? r.status : r.areaId}，待确认` });
      ledger.push({ id: uuid(), time: t, actor, kind: 'conflict', ref: mission.id, message: `任务 ${mission.id} ${field === 'status' ? '状态' : '搜索区'}两版冲突，已挂起待确认` });
      continue;
    }

    if (!late && statusDiffers) {
      mission.status = r.status;
      mission.updatedAt = r.time;
      events.push({ id: uuid(), time: t, actor, message: `任务 ${mission.title} 按新回执推进为 ${r.status}` });
    }
  }

  return { receipts, taskReceipts, assets, missions, conflicts, applied, duplicates, conflictCount, events, ledger };
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set, get) => ({
      areas: initialAreas,
      assets: initialAssets,
      missions: initialMissions,
      events: initialEvents,
      ledger: [],
      receipts: seedReceipts(),
      taskReceipts: [],
      pending: seedPending(),
      lastBatch: { positions: [], taskReceipts: [] },
      conflicts: [],
      syncResults: [],
      archive: [],
      offline: false,
      lowBandwidth: false,

      toggleOffline: () => {
        const goingOnline = get().offline;
        set((s) => {
          const next = { ...s, offline: !s.offline };
          if (goingOnline && (s.pending.positions.length > 0 || s.pending.taskReceipts.length > 0)) {
            // 回网即同步
            const outcome = mergeBatch(s, s.pending, '回网自动同步');
            const received = s.pending.positions.length + s.pending.taskReceipts.length;
            const result: SyncResult = {
              id: uuid(),
              time: iso(),
              actor: '回网自动同步',
              received,
              applied: outcome.applied,
              duplicates: outcome.duplicates,
              conflicts: outcome.conflictCount,
              detail: `接收 ${received} 条 · 新入账 ${outcome.applied} · 重复 ${outcome.duplicates} · 待确认冲突 ${outcome.conflictCount}`
            };
            next.receipts = outcome.receipts;
            next.taskReceipts = outcome.taskReceipts;
            next.assets = outcome.assets;
            next.missions = outcome.missions;
            next.conflicts = [...outcome.conflicts, ...s.conflicts];
            next.pending = { positions: [], taskReceipts: [] };
            next.lastBatch = s.pending;
            next.syncResults = [result, ...s.syncResults].slice(0, 20);
            next.events = [...outcome.events, ...s.events];
            next.ledger = [...outcome.ledger, ...s.ledger];
          }
          return next;
        });
      },

      toggleBandwidth: () => set((s) => ({ lowBandwidth: !s.lowBandwidth })),

      setAreaStatus: (id, status) => set((s) => ({
        areas: s.areas.map((area) => area.id === id ? { ...area, status } : area),
        events: [{ id: uuid(), time: iso(), actor: '指挥员', message: `搜索区 ${id} 状态改为 ${status}` }, ...s.events]
      })),

      setAssetStatus: (id, status) => set((s) => {
        const asset = s.assets.find((a) => a.id === id);
        if (!asset) return s;
        let pending = s.pending;
        // 标记失联时，把离线前最后一条任务回执关进离线仓
        if (status === 'offline') {
          const mission = s.missions.find((m) => m.assetIds.includes(id) && (m.status === 'in_progress' || m.status === 'dispatched'));
          const hasTask = pending.taskReceipts.some((r) => r.unitSerial === asset.serial);
          if (mission && !hasTask) {
            pending = {
              ...pending,
              taskReceipts: [...pending.taskReceipts, {
                id: uuid(),
                unitSerial: asset.serial,
                missionId: mission.id,
                seq: nextSeqFor([...s.taskReceipts, ...pending.taskReceipts], asset.serial),
                status: mission.status,
                areaId: mission.areaId,
                time: iso(),
                recordedAt: iso(),
                source: 'offline'
              }]
            };
          }
        }
        return {
          ...s,
          pending,
          assets: s.assets.map((a) => a.id === id ? { ...a, status, lastSeen: status === 'offline' ? a.lastSeen : iso() } : a),
          events: [{ id: uuid(), time: iso(), actor: '值班员', message: `${asset.name} ${status === 'offline' ? '标记失联，开始离线记录' : '恢复在线'}` }, ...s.events]
        };
      }),

      dispatchMission: (input) => set((s) => {
        const mission: Mission = {
          id: uuid(),
          title: input.title,
          areaId: input.areaId,
          assetIds: input.assetIds,
          status: 'dispatched',
          priority: input.priority,
          note: input.note,
          createdAt: iso(),
          updatedAt: iso(),
          invalidatedAssetIds: []
        };
        return {
          ...s,
          missions: [mission, ...s.missions],
          assets: s.assets.map((asset) => input.assetIds.includes(asset.id) ? { ...asset, status: 'assigned' } : asset),
          events: [{ id: uuid(), time: iso(), actor: '指挥员', message: `任务“${input.title}”已派发至 ${input.areaId}` }, ...s.events],
          ledger: [{ id: uuid(), time: iso(), actor: '指挥员', kind: 'mission', ref: mission.id, message: `任务单 ${mission.title} 派发，搜索区 ${input.areaId}` }, ...s.ledger]
        };
      }),

      updateMission: (id, patch) => set((s) => {
        const missions = s.missions.map((m) => ({ ...m, invalidatedAssetIds: [...m.invalidatedAssetIds] }));
        const assets = s.assets.map((a) => ({ ...a }));
        const areas = s.areas.map((a) => ({ ...a }));
        const mission = missions.find((m) => m.id === id);
        if (!mission) return s;

        const t = iso();
        const events: EventLog[] = [];
        const ledger: LedgerEntry[] = [];

        // 任务单一旦更新：旧搜索区覆盖率立即失效（纪元刷新，重算）
        const touchEpoch = (areaId: string) => {
          const area = areas.find((a) => a.id === areaId);
          if (area) area.epoch = t;
        };

        if (patch.areaId && patch.areaId !== mission.areaId) {
          const oldArea = mission.areaId;
          mission.areaId = patch.areaId;
          mission.updatedAt = t;
          // 在途任务立即失效：已调派但未完成的单位释放，需重新调派
          const invalidated = mission.assetIds.filter((aid) => assets.find((a) => a.id === aid)?.status === 'assigned');
          mission.invalidatedAssetIds = Array.from(new Set([...mission.invalidatedAssetIds, ...invalidated]));
          for (const aid of invalidated) {
            const a = assets.find((x) => x.id === aid);
            if (a) a.status = 'ready';
          }
          touchEpoch(oldArea);
          touchEpoch(patch.areaId);
          events.push({ id: uuid(), time: t, actor: '指挥员', message: `任务“${mission.title}”改派至 ${patch.areaId}，${invalidated.length} 个在途单位调派失效、已释放待重新调派` });
          ledger.push({ id: uuid(), time: t, actor: '指挥员', kind: 'mission', ref: id, message: `任务单 ${mission.title} 搜索区变更，旧覆盖率与在途任务立即失效重算` });
        }

        if (patch.status && patch.status !== mission.status) {
          const prev = mission.status;
          mission.status = patch.status;
          mission.updatedAt = t;
          touchEpoch(mission.areaId);
          if (patch.status === 'closed') {
            // 已完成航迹照旧留档：按任务窗口抽取位置回执，只追加不改写
            const track = s.receipts
              .filter((r) => mission.assetIds.includes(r.unitSerial) && new Date(r.time).getTime() >= new Date(mission.createdAt).getTime())
              .sort((x, y) => new Date(x.time).getTime() - new Date(y.time).getTime())
              .map((r) => ({ lat: r.lat, lng: r.lng, time: r.time, unitSerial: r.unitSerial }));
            const archived: ArchivedTrack = { missionId: id, title: mission.title, areaId: mission.areaId, closedAt: t, track };
            for (const aid of mission.assetIds) {
              const a = assets.find((x) => x.id === aid);
              if (a && a.status === 'assigned') a.status = 'ready';
            }
            events.push({ id: uuid(), time: t, actor: '指挥员', message: `任务“${mission.title}”已关闭，航迹 ${track.length} 点留档` });
            ledger.push({ id: uuid(), time: t, actor: '指挥员', kind: 'archive', ref: id, message: `任务 ${mission.title} 完成留档，航迹 ${track.length} 点归档备查` });
            return {
              ...s,
              missions,
              assets,
              areas,
              archive: [archived, ...s.archive],
              events: [...events, ...s.events],
              ledger: [...ledger, ...s.ledger]
            };
          }
          events.push({ id: uuid(), time: t, actor: '指挥员', message: `任务“${mission.title}”状态 ${prev} → ${patch.status}` });
          ledger.push({ id: uuid(), time: t, actor: '指挥员', kind: 'mission', ref: id, message: `任务 ${mission.title} 状态更新为 ${patch.status}，相关视图立即重算` });
        }

        return { ...s, missions, assets, areas, events: [...events, ...s.events], ledger: [...ledger, ...s.ledger] };
      }),

      recordOfflineFix: (assetId) => set((s) => {
        const asset = s.assets.find((a) => a.id === assetId);
        if (!asset) return s;
        const pending = { positions: [...s.pending.positions], taskReceipts: [...s.pending.taskReceipts] };
        const t = iso();

        // 离线期间持续记录位置（沿漂移方向外推）
        const lastPos = [...s.receipts, ...pending.positions]
          .filter((r) => r.unitSerial === asset.serial)
          .sort((x, y) => new Date(x.time).getTime() - new Date(y.time).getTime())
          .pop();
        pending.positions.push({
          id: uuid(),
          unitSerial: asset.serial,
          seq: nextSeqFor([...s.receipts, ...pending.positions], asset.serial),
          lat: (lastPos?.lat ?? asset.lat) + 0.004,
          lng: (lastPos?.lng ?? asset.lng) + 0.004,
          time: t,
          recordedAt: t,
          source: 'offline'
        });

        // 若还没有任务回执，补一条离线任务回执
        const mission = s.missions.find((m) => m.assetIds.includes(assetId) && (m.status === 'in_progress' || m.status === 'dispatched'));
        if (mission && !pending.taskReceipts.some((r) => r.unitSerial === asset.serial)) {
          pending.taskReceipts.push({
            id: uuid(),
            unitSerial: asset.serial,
            missionId: mission.id,
            seq: nextSeqFor([...s.taskReceipts, ...pending.taskReceipts], asset.serial),
            status: mission.status,
            areaId: mission.areaId,
            time: t,
            recordedAt: t,
            source: 'offline'
          });
        }

        return {
          ...s,
          pending,
          events: [{ id: uuid(), time: t, actor: asset.name, message: `离线记录位置 #${pending.positions.length}，存入离线仓待回网同步` }, ...s.events]
        };
      }),

      syncPending: (actor = '离线仓同步') => set((s) => {
        const batch = s.pending;
        const received = batch.positions.length + batch.taskReceipts.length;
        const outcome = mergeBatch(s, batch, actor);
        const result: SyncResult = {
          id: uuid(),
          time: iso(),
          actor,
          received,
          applied: outcome.applied,
          duplicates: outcome.duplicates,
          conflicts: outcome.conflictCount,
          detail: received === 0
            ? '离线仓为空，无待同步回执'
            : `接收 ${received} 条 · 新入账 ${outcome.applied} · 重复 ${outcome.duplicates} · 待确认冲突 ${outcome.conflictCount}`
        };
        return {
          ...s,
          receipts: outcome.receipts,
          taskReceipts: outcome.taskReceipts,
          assets: outcome.assets,
          missions: outcome.missions,
          conflicts: [...outcome.conflicts, ...s.conflicts],
          pending: { positions: [], taskReceipts: [] },
          lastBatch: batch,
          syncResults: [result, ...s.syncResults].slice(0, 20),
          events: [...outcome.events, ...(result.received ? [] : [{ id: uuid(), time: iso(), actor, message: '离线仓为空，最近同步结果无新增' }]), ...s.events],
          ledger: [...outcome.ledger, { id: uuid(), time: iso(), actor, kind: 'sync', ref: 'sync', message: result.detail }, ...s.ledger]
        };
      }),

      resyncLastBatch: () => set((s) => {
        const batch = s.lastBatch;
        const received = batch.positions.length + batch.taskReceipts.length;
        if (received === 0) return s;
        // 重发同一批：序号已入账，应全部判为重复，不重复记账
        const outcome = mergeBatch(s, batch, '重发上一批');
        const result: SyncResult = {
          id: uuid(),
          time: iso(),
          actor: '重发上一批',
          received,
          applied: outcome.applied,
          duplicates: outcome.duplicates,
          conflicts: outcome.conflictCount,
          detail: `重发 ${received} 条 · 新入账 ${outcome.applied}（应为 0）· 重复 ${outcome.duplicates} · 待确认冲突 ${outcome.conflictCount}`
        };
        return {
          ...s,
          syncResults: [result, ...s.syncResults].slice(0, 20),
          events: [...outcome.events, ...s.events],
          ledger: [...outcome.ledger, { id: uuid(), time: iso(), actor: '重发上一批', kind: 'sync', ref: 'sync', message: result.detail }, ...s.ledger]
        };
      }),

      resolveConflict: (id, choice) => set((s) => {
        const conflict = s.conflicts.find((c) => c.id === id);
        if (!conflict || conflict.status !== 'pending') return s;
        const value = choice === 'local' ? conflict.local : conflict.remote;
        const missions = s.missions.map((m) => ({ ...m, invalidatedAssetIds: [...m.invalidatedAssetIds] }));
        const assets = s.assets.map((a) => ({ ...a }));
        const areas = s.areas.map((a) => ({ ...a }));
        const mission = missions.find((m) => m.id === conflict.refId);
        const t = iso();
        if (mission) {
          if (conflict.field === 'status') {
            mission.status = value as MissionStatus;
            mission.updatedAt = t;
          } else {
            const oldArea = mission.areaId;
            mission.areaId = value;
            mission.updatedAt = t;
            const invalidated = mission.assetIds.filter((aid) => assets.find((a) => a.id === aid)?.status === 'assigned');
            mission.invalidatedAssetIds = Array.from(new Set([...mission.invalidatedAssetIds, ...invalidated]));
            for (const aid of invalidated) {
              const a = assets.find((x) => x.id === aid);
              if (a) a.status = 'ready';
            }
            const touch = (areaId: string) => { const area = areas.find((a) => a.id === areaId); if (area) area.epoch = t; };
            touch(oldArea);
            touch(value);
          }
        }
        const resolved: ConflictRecord = { ...conflict, status: 'resolved', resolvedValue: value, resolvedAt: t };
        return {
          ...s,
          missions,
          assets,
          areas,
          conflicts: s.conflicts.map((c) => c.id === id ? resolved : c),
          events: [{ id: uuid(), time: t, actor: '指挥员', message: `冲突已裁决：任务 ${mission?.title ?? conflict.refId} 采用${choice === 'local' ? '台账版' : '回执版'}（${value}）` }, ...s.events],
          ledger: [{ id: uuid(), time: t, actor: '指挥员', kind: 'conflict', ref: conflict.refId, message: `冲突裁决完成，采用${choice === 'local' ? '台账版' : '回执版'} ${value}，相关视图重算` }, ...s.ledger]
        };
      })
    }),
    { name: 'maritime-command-v2' }
  )
);
