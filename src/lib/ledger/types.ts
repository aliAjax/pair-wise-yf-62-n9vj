/**
 * 调度账领域模型
 *
 * 账只有追加（append-only），任何状态变化都是一条 LedgerEntry。
 * 搜索区、单位、任务单的"当前状态"全部由回放账体得到，因此日志可以随时重建态势。
 */

export type NodeId = 'shore' | 'boat';

export const NODE_LABEL: Record<NodeId, string> = {
  shore: '岸基',
  boat: '船艇'
};

export type EntityType = 'area' | 'unit' | 'mission';
export type UnitType = 'ship' | 'helicopter' | 'drone' | 'shore';
export type AreaStatus = 'planned' | 'active' | 'closed';
export type MissionStatus = 'dispatched' | 'in_progress' | 'closed';
export type Priority = 'normal' | 'urgent';

/** 位置超过该时长未刷新即判为过期 */
export const STALE_MS = 10 * 60_000;

/** 字段级元数据：当前值、版次、最后写入方。冲突判定靠 rev。 */
export interface FieldMeta<T = unknown> {
  value: T;
  rev: number;
  origin: NodeId;
  entryId: string;
  time: string;
}

export interface EntityState {
  type: EntityType;
  id: string;
  fields: Record<string, FieldMeta>;
  /** 仅任务单有生命周期状态 */
  status?: MissionStatus;
  /** 任务单代号：每次实质变更 +1，旧 gen 的回执立即失效 */
  gen?: number;
  createdAt: string;
  updatedAt: string;
}

/** 字段冲突：基版 + 岸/船两版都保留，裁定前不覆盖任何一方 */
export interface FieldConflict {
  id: string;
  missionId: string;
  field: string;
  base: { value: unknown; rev: number };
  shore: { value: unknown; entryId: string; time: string };
  boat: { value: unknown; entryId: string; time: string };
  status: 'pending' | 'resolved';
  chosen?: NodeId;
  resolvedValue?: unknown;
  resolvedAt?: string;
}

export interface ArchivedTrackPoint {
  lat: number;
  lng: number;
  time: string;
}

/** 已结束任务的航迹快照：只追加、不参与重算、不允许回改 */
export interface ArchivedTrack {
  missionId: string;
  areaId: string;
  unitId: string;
  points: ArchivedTrackPoint[];
  closedAt: string;
  entryId: string;
}

export type ReceiptState = 'fresh' | 'stale' | 'superseded';

export interface PositionView {
  entryId: string;
  unitId: string;
  seq: number;
  lat: number;
  lng: number;
  observedAt: string;
  origin: NodeId;
  missionId: string | null;
  missionGen: number | null;
  state: ReceiptState;
  reason?: string;
}

export interface CoverageView {
  entryId: string;
  unitId: string;
  seq: number;
  missionId: string;
  areaId: string;
  missionGen: number;
  percent: number;
  observedAt: string;
  origin: NodeId;
  state: Exclude<ReceiptState, 'stale'> | 'stale';
  reason?: string;
}

/**
 * 账体条目。
 * seq 是单位自身回执的单调序号（位置/覆盖率共用同一序号空间），
 * idemKey 保证"同一单位序号只入账一次"。
 */
export type LedgerEntry = {
  id: string;
  idemKey: string;
  origin: NodeId;
  recordedAt: string;
} & (
  | { kind: 'AreaRegistered'; areaId: string; name: string; bounds: [number, number, number, number]; status: AreaStatus }
  | { kind: 'UnitRegistered'; unitId: string; name: string; unitType: UnitType; lat: number; lng: number }
  | { kind: 'MissionOpened'; missionId: string; title: string; areaId: string; unitIds: string[]; priority: Priority; note: string }
  | { kind: 'MissionStatusChanged'; missionId: string; status: MissionStatus; fromGen: number }
  | {
      kind: 'MissionPatched';
      missionId: string;
      /** 每个改动字段携带编辑时看到的 baseRev / baseValue，用于并发冲突检测 */
      changes: Record<string, { value: unknown; baseRev: number; baseValue: unknown }>;
    }
  | {
      kind: 'PositionReported';
      unitId: string;
      seq: number;
      lat: number;
      lng: number;
      observedAt: string;
      missionId: string | null;
      missionGen: number | null;
    }
  | {
      kind: 'CoverageReported';
      unitId: string;
      seq: number;
      missionId: string;
      areaId: string;
      missionGen: number;
      percent: number;
      observedAt: string;
    }
  | { kind: 'TrackArchived'; track: ArchivedTrack }
  | { kind: 'ConflictRaised'; conflict: FieldConflict }
  | { kind: 'ConflictResolved'; conflictId: string; missionId: string; field: string; chosen: NodeId; value: unknown }
);

export interface CoverageSummary {
  /** 仅由当前 gen 的有效回执重算；无有效回执时为 null（旧覆盖率已失效，等待新回执） */
  percent: number | null;
  validReceipts: number;
  invalidatedReceipts: number;
}

export interface SyncResult {
  at: string;
  /** 岸基本轮新收到的条目数 */
  shoreReceived: number;
  /** 船艇本轮新收到的条目数 */
  boatReceived: number;
  /** 命中幂等被丢弃的重复条目数（如单位回网重放旧回执） */
  duplicates: number;
  /** 本轮新挂起的字段冲突 */
  conflictsRaised: number;
  /** 合并后被判定失效的回执数（任务已更新/已结束） */
  supersededReceipts: number;
  /** 合并双方日志长度，应一致 */
  shoreLogSize: number;
  boatLogSize: number;
}

export interface Projection {
  areas: EntityState[];
  units: EntityState[];
  missions: EntityState[];
  positions: PositionView[];
  coverage: CoverageView[];
  conflicts: Record<string, FieldConflict>;
  tracks: ArchivedTrack[];
  /** 单位 -> 最大回执序号 / 最近回执时间，用于"未回传单位"与下一序号分配 */
  watermark: Record<string, { seq: number; at: string }>;
  /** 被忽略条目的审计痕迹（如结束任务上的迟到状态变更） */
  ignored: { entryId: string; reason: string }[];
  areaCoverage: Record<string, CoverageSummary>;
  /** 在途任务重算结果：unitId -> 在途任务 ID 列表（仅开放任务） */
  assignments: Record<string, string[]>;
  /** 单位 -> 最近一条位置（含失效状态，地图按状态着色） */
  latestPosition: Record<string, PositionView>;
  entriesApplied: number;
}
