export type AreaStatus = 'planned' | 'active' | 'closed';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
export type MissionStatus = 'draft' | 'dispatched' | 'in_progress' | 'closed';

export interface SearchArea {
  id: string;
  name: string;
  bounds: [number, number, number, number];
  status: AreaStatus;
  /** 台账纪元：任务单变更后刷新，早于该时间的回执不再参与覆盖率计算 */
  epoch: string;
  createdAt: string;
}

export interface RescueAsset {
  id: string;
  /** 单位序号：回执入账的唯一身份 */
  serial: string;
  name: string;
  type: 'ship' | 'helicopter' | 'drone' | 'shore';
  status: AssetStatus;
  lat: number;
  lng: number;
  lastSeen: string;
}

export interface Mission {
  id: string;
  title: string;
  areaId: string;
  assetIds: string[];
  status: MissionStatus;
  priority: 'normal' | 'urgent';
  note: string;
  createdAt: string;
  updatedAt: string;
  /** 任务单变更后失效的在途调派（单位已释放，需重新调派） */
  invalidatedAssetIds: string[];
}

/** 位置回执：单位离线记录、回网合并的原始凭证 */
export interface PositionReceipt {
  id: string;
  unitSerial: string;
  /** 单位内递增序号，与 unitSerial 共同保证只入账一次 */
  seq: number;
  lat: number;
  lng: number;
  /** 单位记录时间 */
  time: string;
  /** 入账时间 */
  recordedAt: string;
  source: 'offline' | 'online';
}

/** 任务回执：单位侧记录的任务状态/搜索区版本 */
export interface TaskReceipt {
  id: string;
  unitSerial: string;
  missionId: string;
  seq: number;
  status: MissionStatus;
  areaId: string;
  /** 单位记录时间 */
  time: string;
  recordedAt: string;
  source: 'offline' | 'online';
}

export type LedgerKind = 'receipt' | 'mission' | 'area' | 'conflict' | 'sync' | 'archive';

export interface LedgerEntry {
  id: string;
  time: string;
  actor: string;
  kind: LedgerKind;
  ref: string;
  message: string;
}

export interface EventLog {
  id: string;
  time: string;
  actor: string;
  message: string;
}

/** 字段冲突：两版都保留，等待人工裁决 */
export interface ConflictRecord {
  id: string;
  detectedAt: string;
  refType: 'mission';
  refId: string;
  field: 'status' | 'areaId';
  /** 台账版（岸基当前版本） */
  local: string;
  /** 回执版（离线单位版本） */
  remote: string;
  status: 'pending' | 'resolved';
  resolvedValue?: string;
  resolvedAt?: string;
}

/** 最近一次同步结果（低带宽下只看这个也够） */
export interface SyncResult {
  id: string;
  time: string;
  actor: string;
  received: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  detail: string;
}

/** 已完成航迹留档：只追加、不失效、不改写 */
export interface ArchivedTrack {
  missionId: string;
  title: string;
  areaId: string;
  closedAt: string;
  track: { lat: number; lng: number; time: string; unitSerial: string }[];
}
