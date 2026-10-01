/**
 * 调度账投影 -> 页面行模型。全部为纯派生，不持有状态。
 */

import type { EntityState, Projection } from './ledger/types';
import { isStale, missionField } from './ledger/replay';

export type UnitDisplayStatus = 'assigned' | 'ready';

export interface UnitRow {
  id: string;
  name: string;
  unitType: string;
  status: UnitDisplayStatus;
  /** 最新一条位置回执（可能已失效） */
  latest: Projection['positions'][number] | undefined;
  watermarkSeq: number;
  lastReceiptAt: string | null;
  /** 超过 STALE 窗口没有任何回执 */
  unreported: boolean;
  /** 最新位置本身已过期 */
  positionStale: boolean;
  /** 最新位置因任务更新/关闭而失效 */
  positionSuperseded: boolean;
  activeMissionIds: string[];
}

export function unitRows(view: Projection, at: number = Date.now()): UnitRow[] {
  return view.units.map((u) => {
    const id = u.id;
    const latest = view.latestPosition[id];
    const wm = view.watermark[id];
    const activeMissionIds = view.assignments[id] ?? [];
    const lastAt = wm?.at ?? null;
    const unreported = !lastAt || at - new Date(lastAt).getTime() > 10 * 60_000;
    return {
      id,
      name: String(u.fields.name?.value ?? id),
      unitType: String(u.fields.unitType?.value ?? ''),
      status: activeMissionIds.length ? 'assigned' : 'ready',
      latest,
      watermarkSeq: wm?.seq ?? 0,
      lastReceiptAt: lastAt,
      unreported,
      positionStale: latest?.state === 'stale' || (!!latest && isStale(latest.observedAt, at)),
      positionSuperseded: latest?.state === 'superseded',
      activeMissionIds
    };
  });
}

export interface AreaRow {
  id: string;
  name: string;
  status: string;
  bounds: [number, number, number, number];
  /** 重算覆盖率；null = 旧值已失效，等待新回执 */
  coverage: number | null;
  validReceipts: number;
  invalidated: number;
}

export function areaRows(view: Projection): AreaRow[] {
  return view.areas.map((a) => {
    const summary = view.areaCoverage[a.id];
    return {
      id: a.id,
      name: String(a.fields.name?.value ?? a.id),
      status: String(a.fields.status?.value ?? ''),
      bounds: (a.fields.bounds?.value ?? [0, 0, 0, 0]) as [number, number, number, number],
      coverage: summary?.percent ?? null,
      validReceipts: summary?.validReceipts ?? 0,
      invalidated: summary?.invalidatedReceipts ?? 0
    };
  });
}

export interface MissionRow {
  id: string;
  entity: EntityState;
  title: string;
  areaId: string;
  areaName: string;
  unitIds: string[];
  priority: string;
  note: string;
  noteRev: number;
  noteOrigin: string;
  status: string;
  gen: number;
  conflictFields: string[];
}

const FIELD_LABELS: Record<string, string> = {
  title: '任务名称',
  areaId: '搜索区',
  unitIds: '调派单位',
  priority: '优先级',
  note: '任务说明'
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function missionRows(view: Projection): MissionRow[] {
  const areaName = (id: string) => String(view.areas.find((a) => a.id === id)?.fields.name?.value ?? id);
  return view.missions.map((m) => ({
    id: m.id,
    entity: m,
    title: missionField<string>(m, 'title') ?? m.id,
    areaId: missionField<string>(m, 'areaId') ?? '',
    areaName: areaName(missionField<string>(m, 'areaId') ?? ''),
    unitIds: missionField<string[]>(m, 'unitIds') ?? [],
    priority: missionField<string>(m, 'priority') ?? 'normal',
    note: missionField<string>(m, 'note') ?? '',
    noteRev: m.fields.note?.rev ?? 1,
    noteOrigin: String(m.fields.note?.origin ?? ''),
    status: m.status ?? 'dispatched',
    gen: m.gen ?? 1,
    conflictFields: Object.values(view.conflicts)
      .filter((c) => c.missionId === m.id && c.status === 'pending')
      .map((c) => c.field)
  }));
}

export const UNIT_TYPE_LABEL: Record<string, string> = {
  ship: '船艇',
  helicopter: '直升机',
  drone: '无人机',
  shore: '岸基观察点'
};

export const STATUS_LABEL: Record<string, string> = {
  planned: '规划中',
  active: '执行中',
  closed: '已关闭',
  dispatched: '已派发',
  in_progress: '进行中'
};
