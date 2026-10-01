/**
 * 双节点调度账：岸基(shore) 与 船艇(boat) 各持一份 append-only 日志。
 *
 * - 断链期间双方各自记账（含单位离线缓存的回执）。
 * - 回网时 exchangeLogs 做确定性双向合并：重复条目按幂等键丢弃，
 *   旧 gen 的更新在回放层自然失效，并发字段修改在回放层挂起为冲突。
 * - 合并结果（收到条数 / 去重条数 / 失效回执数）形成 SyncResult 留痕，
 *   供低带宽下查看"最近一次同步结果"与"未回传单位"。
 */

import type {
  ArchivedTrack,
  LedgerEntry,
  NodeId,
  Priority,
  SyncResult,
  UnitType
} from './types';
import { emptyProjection, replay } from './replay';
import type { Projection } from './types';

export interface LedgerNode {
  id: NodeId;
  entries: LedgerEntry[];
}

let counter = 0;
function localId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function makeEntry<E extends LedgerEntry>(
  origin: NodeId,
  kind: E['kind'],
  rest: Omit<E, 'id' | 'idemKey' | 'origin' | 'recordedAt' | 'kind'>,
  idemKey: string
): E {
  const id = localId('e');
  return {
    id,
    idemKey,
    origin,
    recordedAt: new Date().toISOString(),
    kind,
    ...(rest as Record<string, unknown>)
  } as E;
}

/** 条目工厂：所有账体写入都经过这里，保证 id/idemKey/时间戳格式一致 */
export const entry = {
  areaRegistered: (origin: NodeId, areaId: string, name: string, bounds: [number, number, number, number], status: 'planned' | 'active' | 'closed') =>
    makeEntry<Extract<LedgerEntry, { kind: 'AreaRegistered' }>>(origin, 'AreaRegistered', { areaId, name, bounds, status }, `area:${areaId}`),

  unitRegistered: (origin: NodeId, unitId: string, name: string, unitType: UnitType, lat: number, lng: number) =>
    makeEntry<Extract<LedgerEntry, { kind: 'UnitRegistered' }>>(origin, 'UnitRegistered', { unitId, name, unitType, lat, lng }, `unit:${unitId}`),

  missionOpened: (origin: NodeId, missionId: string, title: string, areaId: string, unitIds: string[], priority: Priority, note: string) =>
    makeEntry<Extract<LedgerEntry, { kind: 'MissionOpened' }>>(origin, 'MissionOpened', { missionId, title, areaId, unitIds, priority, note }, `mission-open:${missionId}`),

  missionStatus: (origin: NodeId, missionId: string, status: 'dispatched' | 'in_progress' | 'closed', fromGen: number) =>
    makeEntry<Extract<LedgerEntry, { kind: 'MissionStatusChanged' }>>(origin, 'MissionStatusChanged', { missionId, status, fromGen },
      // 同一方基于同一版次发出的同目标状态指令只入账一次；
      // 另一方基于过期版次的迟到指令不会撞键，会进入回放逻辑被拒绝并留痕
      `mission-status:${origin}:${missionId}:${status}:${fromGen}`),

  missionPatch: (
    origin: NodeId,
    missionId: string,
    changes: Record<string, { value: unknown; baseRev: number; baseValue: unknown }>
  ) =>
    makeEntry<Extract<LedgerEntry, { kind: 'MissionPatched' }>>(origin, 'MissionPatched', { missionId, changes },
      // 幂等键含字段版次与值：同版重放去重，基于新版再次修改可入账
      `mission-patch:${missionId}:${Object.entries(changes).map(([f, c]) => `${f}@${c.baseRev}=${JSON.stringify(c.value)}`).join(',')}`),

  position: (origin: NodeId, unitId: string, seq: number, lat: number, lng: number, observedAt: string, missionId: string | null, missionGen: number | null) =>
    makeEntry<Extract<LedgerEntry, { kind: 'PositionReported' }>>(origin, 'PositionReported',
      { unitId, seq, lat, lng, observedAt, missionId, missionGen },
      // 核心幂等：同一单位序号只入账一次
      `receipt:${unitId}:${seq}`),

  coverage: (origin: NodeId, unitId: string, seq: number, missionId: string, areaId: string, missionGen: number, percent: number, observedAt: string) =>
    makeEntry<Extract<LedgerEntry, { kind: 'CoverageReported' }>>(origin, 'CoverageReported',
      { unitId, seq, missionId, areaId, missionGen, percent, observedAt },
      `receipt:${unitId}:${seq}`),

  trackArchived: (origin: NodeId, track: ArchivedTrack) =>
    makeEntry<Extract<LedgerEntry, { kind: 'TrackArchived' }>>(origin, 'TrackArchived', { track },
      `track:${track.missionId}:${track.unitId}`),

  conflictResolved: (origin: NodeId, conflictId: string, missionId: string, field: string, chosen: NodeId, value: unknown) =>
    makeEntry<Extract<LedgerEntry, { kind: 'ConflictResolved' }>>(origin, 'ConflictResolved',
      { conflictId, missionId, field, chosen, value },
      `conflict-resolve:${conflictId}`)
};

/**
 * 双向合并。返回合并后的日志（双方内容相同）与同步统计。
 * 去重以条目的 id 与 idemKey 双重判定。
 */
export function exchangeLogs(
  shore: LedgerNode,
  boat: LedgerNode
): { merged: LedgerEntry[]; result: Omit<SyncResult, 'at' | 'shoreLogSize' | 'boatLogSize'> } {
  const byId = new Map<string, LedgerEntry>();
  const idemOwner = new Map<string, string>();
  let duplicates = 0;

  const all = [...shore.entries, ...boat.entries].sort((a, b) =>
    a.recordedAt === b.recordedAt ? a.id.localeCompare(b.id) : a.recordedAt.localeCompare(b.recordedAt)
  );

  for (const e of all) {
    if (byId.has(e.id)) continue; // 同 id：已同步过的同一份拷贝，静默收敛
    const ownerId = idemOwner.get(e.idemKey);
    if (ownerId && ownerId !== e.id) {
      // 同幂等键、不同 id：重复重传（如离线单位回网补发同一序号）→ 只入账一次
      duplicates += 1;
      continue;
    }
    byId.set(e.id, e);
    idemOwner.set(e.idemKey, e.id);
  }

  const merged = [...byId.values()].sort((a, b) =>
    a.recordedAt === b.recordedAt ? a.id.localeCompare(b.id) : a.recordedAt.localeCompare(b.recordedAt)
  );

  // 各方新收 = 合并集里对方独有（按 id）的条目数
  const shoreIds = new Set(shore.entries.map((e) => e.id));
  const boatIds = new Set(boat.entries.map((e) => e.id));
  let shoreReceived = 0;
  let boatReceived = 0;
  for (const id of byId.keys()) {
    if (boatIds.has(id) && !shoreIds.has(id)) shoreReceived += 1;
    if (shoreIds.has(id) && !boatIds.has(id)) boatReceived += 1;
  }

  // 权威投影：失效与冲突以合并后为准（同步面板的语义就是"合并后共有多少失效回执"）
  const after = replay(merged);
  const supersededReceipts =
    after.positions.filter((p) => p.state === 'superseded').length +
    after.coverage.filter((c) => c.state === 'superseded').length;

  const conflictKeysBefore = new Set([
    ...Object.keys(replay(shore.entries).conflicts),
    ...Object.keys(replay(boat.entries).conflicts)
  ]);
  const conflictsRaised = Object.keys(after.conflicts).filter(
    (key) => after.conflicts[key].status === 'pending' && !conflictKeysBefore.has(key)
  ).length;

  return {
    merged,
    result: {
      shoreReceived,
      boatReceived,
      duplicates,
      conflictsRaised,
      supersededReceipts
    }
  };
}

export function project(node: LedgerNode): Projection {
  return replay(node.entries);
}

export function emptyNode(id: NodeId): LedgerNode {
  return { id, entries: [] };
}

export { emptyProjection };
