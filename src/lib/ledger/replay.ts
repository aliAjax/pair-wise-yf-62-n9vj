/**
 * 调度账回放引擎：从 append-only 日志纯函数重建调度态势。
 *
 * 关键不变量：
 * 1. 同一 (unitId, seq) 只入账一次 —— 幂等去重在回放层强制。
 * 2. 任务单实质变更（状态切换/字段修改）使 gen 递增；
 *    gen 落后的覆盖率回执、与开放任务不再匹配的位置立即标记 superseded。
 * 3. 字段冲突不覆盖：保留 base + 岸/船两版，进入 conflicts 待人工裁定。
 * 4. 已完成航迹是独立归档条目，永远留档、不参与重算。
 */

import type {
  ArchivedTrack,
  CoverageView,
  EntityState,
  FieldConflict,
  LedgerEntry,
  PositionView,
  Projection
} from './types';
import { STALE_MS } from './types';

/** 任务单上参与冲突检测的可变字段（注册时定版 rev=1） */
const MISSION_MUTABLE_FIELDS = ['title', 'areaId', 'unitIds', 'priority', 'note'] as const;
export type MissionMutableField = (typeof MISSION_MUTABLE_FIELDS)[number];

const MISSION_ENTITY_FIELDS = ['title', 'areaId', 'unitIds', 'priority', 'note'] as const;

export function emptyProjection(): Projection {
  return {
    areas: [],
    units: [],
    missions: [],
    positions: [],
    coverage: [],
    conflicts: {},
    tracks: [],
    watermark: {},
    ignored: [],
    areaCoverage: {},
    assignments: {},
    latestPosition: {},
    entriesApplied: 0
  };
}

interface InternalState extends Projection {
  entities: Map<string, EntityState>;
  seenIdem: Map<string, string>;
  seenEntryIds: Set<string>;
  conflictPairs: Map<string, FieldConflict>;
}

function cloneField<T>(field: { value: T; rev: number; origin: LedgerEntry['origin']; entryId: string; time: string }) {
  return { value: field.value, rev: field.rev, origin: field.origin, entryId: field.entryId, time: field.time };
}

export function replay(entries: LedgerEntry[]): Projection {
  const s: InternalState = {
    ...emptyProjection(),
    entities: new Map(),
    seenIdem: new Map(),
    seenEntryIds: new Set(),
    conflictPairs: new Map()
  };

  // 日志在写入时已按节点时钟排序；合并后再做一次稳定排序（时间 + id）保证回放确定性
  const ordered = [...entries].sort((a, b) =>
    a.recordedAt === b.recordedAt ? a.id.localeCompare(b.id) : a.recordedAt.localeCompare(b.recordedAt)
  );

  for (const entry of ordered) {
    if (s.seenEntryIds.has(entry.id)) continue; // 完全重复（同一日志重放）：静默跳过
    const idemWinner = s.seenIdem.get(entry.idemKey);
    if (idemWinner && idemWinner !== entry.id) {
      // 同幂等键、不同条目 = 重复重传（如离线单位回网补发同一序号）：只入账一次，并留审计痕迹
      s.ignored.push({ entryId: entry.id, reason: `幂等键 ${entry.idemKey} 已由条目 ${idemWinner.slice(0, 14)}… 入账，重复内容丢弃` });
      continue;
    }
    s.seenEntryIds.add(entry.id);
    s.seenIdem.set(entry.idemKey, entry.id);

    switch (entry.kind) {
      case 'AreaRegistered': {
        if (s.entities.has(entry.areaId)) { s.ignored.push({ entryId: entry.id, reason: '搜索区已注册' }); break; }
        const now = entry.recordedAt;
        s.entities.set(entry.areaId, {
          type: 'area', id: entry.areaId, createdAt: now, updatedAt: now,
          fields: {
            name: { value: entry.name, rev: 1, origin: entry.origin, entryId: entry.id, time: now },
            bounds: { value: entry.bounds, rev: 1, origin: entry.origin, entryId: entry.id, time: now },
            status: { value: entry.status, rev: 1, origin: entry.origin, entryId: entry.id, time: now }
          }
        });
        break;
      }
      case 'UnitRegistered': {
        if (s.entities.has(entry.unitId)) { s.ignored.push({ entryId: entry.id, reason: '单位已注册' }); break; }
        const now = entry.recordedAt;
        s.entities.set(entry.unitId, {
          type: 'unit', id: entry.unitId, createdAt: now, updatedAt: now,
          fields: {
            name: { value: entry.name, rev: 1, origin: entry.origin, entryId: entry.id, time: now },
            unitType: { value: entry.unitType, rev: 1, origin: entry.origin, entryId: entry.id, time: now },
            homeLat: { value: entry.lat, rev: 1, origin: entry.origin, entryId: entry.id, time: now },
            homeLng: { value: entry.lng, rev: 1, origin: entry.origin, entryId: entry.id, time: now }
          }
        });
        break;
      }
      case 'MissionOpened': {
        if (s.entities.has(entry.missionId)) { s.ignored.push({ entryId: entry.id, reason: '任务单已存在' }); break; }
        const now = entry.recordedAt;
        const fields: EntityState['fields'] = {};
        for (const f of MISSION_ENTITY_FIELDS) {
          const value = f === 'unitIds' ? entry.unitIds : entry[f as 'title' | 'areaId' | 'priority' | 'note'];
          fields[f] = { value, rev: 1, origin: entry.origin, entryId: entry.id, time: now };
        }
        s.entities.set(entry.missionId, {
          type: 'mission', id: entry.missionId, createdAt: now, updatedAt: now,
          status: 'dispatched', gen: 1, fields
        });
        break;
      }
      case 'MissionStatusChanged': {
        const m = s.entities.get(entry.missionId);
        if (!m || m.type !== 'mission') { s.ignored.push({ entryId: entry.id, reason: '任务单不存在' }); break; }
        if (m.status === 'closed' && entry.status !== 'closed') {
          s.ignored.push({ entryId: entry.id, reason: '已结束任务不接受在途状态回退（避免派回旧搜索区）' });
          break;
        }
        if (entry.fromGen !== m.gen) {
          s.ignored.push({ entryId: entry.id, reason: `状态变更基于过期版次 ${entry.fromGen}，当前 ${m.gen}` });
          break;
        }
        m.status = entry.status;
        m.updatedAt = entry.recordedAt;
        // 状态切换是实质变更：关闭/重新进入在途都使旧回执失效
        m.gen = (m.gen ?? 1) + 1;
        break;
      }
      case 'MissionPatched': {
        const m = s.entities.get(entry.missionId);
        if (!m || m.type !== 'mission') { s.ignored.push({ entryId: entry.id, reason: '任务单不存在' }); break; }
        if (m.status === 'closed') {
          s.ignored.push({ entryId: entry.id, reason: '任务已结束，字段更新不再入账' });
          break;
        }
        let touched = false;
        for (const fieldName of Object.keys(entry.changes)) {
          const change = entry.changes[fieldName];
          const current = m.fields[fieldName];
          if (!current) continue;
          if (JSON.stringify(current.value) === JSON.stringify(change.value)) continue; // 幂等：值未变

          if (change.baseRev < current.rev) {
            // 并发修改：基于旧版修改，且与现值不同 → 保留两版待确认
            const pairKey = `${entry.missionId}:${fieldName}`;
            const existing = s.conflictPairs.get(pairKey);
            const side = { value: change.value, entryId: entry.id, time: entry.recordedAt };
            if (existing && existing.status === 'pending') {
              // 同一方重放或再次编辑：只更新该方版本（条目级幂等已防重放，这里收敛后续编辑）
              if (entry.origin === 'shore') existing.shore = side;
              else existing.boat = side;
            } else {
              const conflict: FieldConflict = {
                id: `conflict-${entry.missionId}-${fieldName}`,
                missionId: entry.missionId,
                field: fieldName,
                base: { value: change.baseValue, rev: change.baseRev },
                shore: entry.origin === 'shore' ? side : { value: current.value, entryId: current.entryId, time: current.time },
                boat: entry.origin === 'boat' ? side : { value: current.value, entryId: current.entryId, time: current.time },
                status: 'pending'
              };
              s.conflictPairs.set(pairKey, conflict);
            }
            continue;
          }
          m.fields[fieldName] = {
            value: change.value,
            rev: current.rev + 1,
            origin: entry.origin,
            entryId: entry.id,
            time: entry.recordedAt
          };
          touched = true;
        }
        if (touched) {
          m.updatedAt = entry.recordedAt;
          m.gen = (m.gen ?? 1) + 1; // 任务单更新：旧覆盖率/过期位置/在途任务立即失效
        }
        break;
      }
      case 'PositionReported': {
        const prev = s.watermark[entry.unitId];
        if (prev && entry.seq <= prev.seq) {
          s.ignored.push({ entryId: entry.id, reason: `回执序号 ${entry.seq} 已入账（最高 ${prev.seq}），重复位置丢弃` });
          break;
        }
        s.watermark[entry.unitId] = { seq: entry.seq, at: entry.observedAt };
        s.positions.push({
          entryId: entry.id, unitId: entry.unitId, seq: entry.seq,
          lat: entry.lat, lng: entry.lng, observedAt: entry.observedAt,
          origin: entry.origin, missionId: entry.missionId, missionGen: entry.missionGen,
          state: 'fresh'
        });
        break;
      }
      case 'CoverageReported': {
        const prev = s.watermark[entry.unitId];
        if (prev && entry.seq <= prev.seq) {
          s.ignored.push({ entryId: entry.id, reason: `回执序号 ${entry.seq} 已入账（最高 ${prev.seq}），重复覆盖率丢弃` });
          break;
        }
        s.watermark[entry.unitId] = { seq: entry.seq, at: entry.observedAt };
        s.coverage.push({
          entryId: entry.id, unitId: entry.unitId, seq: entry.seq,
          missionId: entry.missionId, areaId: entry.areaId, missionGen: entry.missionGen,
          percent: entry.percent, observedAt: entry.observedAt, origin: entry.origin,
          state: 'fresh'
        });
        break;
      }
      case 'TrackArchived': {
        // 归档条目独立于任务生命周期，任务关闭后仍永久留档
        if (!s.tracks.some((t) => t.entryId === entry.track.entryId || (t.missionId === entry.track.missionId && t.unitId === entry.track.unitId))) {
          s.tracks.push(entry.track);
        }
        break;
      }
      case 'ConflictRaised': {
        if (!s.conflictPairs.has(`${entry.conflict.missionId}:${entry.conflict.field}`)) {
          s.conflictPairs.set(`${entry.conflict.missionId}:${entry.conflict.field}`, entry.conflict);
        }
        break;
      }
      case 'ConflictResolved': {
        const pairKey = `${entry.missionId}:${entry.field}`;
        const conflict = s.conflictPairs.get(pairKey);
        const m = s.entities.get(entry.missionId);
        if (conflict) {
          conflict.status = 'resolved';
          conflict.chosen = entry.chosen;
          conflict.resolvedValue = entry.value;
          conflict.resolvedAt = entry.recordedAt;
        }
        if (m && m.type === 'mission' && MISSION_MUTABLE_FIELDS.includes(entry.field as MissionMutableField)) {
          const current = m.fields[entry.field];
          m.fields[entry.field] = {
            value: entry.value,
            rev: (current?.rev ?? 1) + 1,
            origin: entry.origin,
            entryId: entry.id,
            time: entry.recordedAt
          };
          m.updatedAt = entry.recordedAt;
          // 裁定结果是对任务单的实质确认：同样递增 gen，要求各方按确认版重新回传
          m.gen = (m.gen ?? 1) + 1;
        }
        break;
      }
    }
    s.entriesApplied += 1;
  }

  return finalize(s);
}

function finalize(s: InternalState): Projection {
  s.areas = [...s.entities.values()].filter((e) => e.type === 'area');
  s.units = [...s.entities.values()].filter((e) => e.type === 'unit');
  s.missions = [...s.entities.values()].filter((e) => e.type === 'mission');
  s.conflicts = Object.fromEntries(s.conflictPairs);

  const missionById = new Map(s.missions.map((m) => [m.id, m]));
  const areaByMission = new Map<string, string>();
  for (const m of s.missions) areaByMission.set(m.id, String(m.fields.areaId?.value));

  // ---- 在途任务重算：仅开放任务（dispatched/in_progress），关闭任务不再派回任何单位 ----
  s.assignments = {};
  for (const m of s.missions) {
    if (m.status === 'closed') continue;
    const unitIds = m.fields.unitIds?.value as string[] | undefined;
    for (const uid of unitIds ?? []) {
      (s.assignments[uid] ??= []).push(m.id);
    }
  }

  // ---- 覆盖率回执失效判定：任务已结束 / gen 落后 → superseded ----
  for (const c of s.coverage) {
    const m = missionById.get(c.missionId);
    if (!m) { c.state = 'superseded'; c.reason = '任务单不存在'; continue; }
    if (m.status === 'closed') { c.state = 'superseded'; c.reason = '任务已结束，旧覆盖率失效'; continue; }
    if (c.missionGen !== m.gen) { c.state = 'superseded'; c.reason = `任务单已更新（${c.missionGen} → ${m.gen}），等待新回执`; continue; }
    c.state = 'fresh';
  }

  // ---- 位置失效判定：在途任务关联的位置，在任务更新/关闭后立即失效重算 ----
  for (const p of s.positions) {
    if (!p.missionId) {
      p.state = isStale(p.observedAt) ? 'stale' : 'fresh';
      if (p.state === 'stale') p.reason = '位置超过 10 分钟未刷新';
      else p.reason = undefined;
      continue;
    }
    const m = missionById.get(p.missionId);
    if (!m || m.status === 'closed') {
      p.state = 'superseded'; p.reason = '关联任务已结束，该在途位置失效'; continue;
    }
    if (p.missionGen !== m.gen) {
      p.state = 'superseded'; p.reason = `任务单已更新（${p.missionGen} → ${m.gen}），在途位置失效重算`; continue;
    }
    if (isStale(p.observedAt)) {
      p.state = 'stale'; p.reason = '位置超过 10 分钟未刷新';
    } else {
      p.state = 'fresh'; p.reason = undefined;
    }
  }

  // ---- 每单位最近位置 ----
  s.latestPosition = {};
  for (const p of s.positions) {
    const cur = s.latestPosition[p.unitId];
    if (!cur || cur.seq < p.seq) s.latestPosition[p.unitId] = p;
  }

  // ---- 搜索区覆盖率：仅用当前版次的有效回执重算；无有效回执则为 null（不沿用旧值） ----
  s.areaCoverage = {};
  for (const area of s.areas) {
    const related = s.coverage.filter((c) => c.areaId === area.id);
    const valid = related.filter((c) => c.state === 'fresh');
    const percent = valid.length
      ? Math.round(valid.reduce((sum, c) => sum + c.percent, 0) / valid.length)
      : null;
    s.areaCoverage[area.id] = {
      percent,
      validReceipts: valid.length,
      invalidatedReceipts: related.length - valid.length
    };
  }

  return s;
}

export function isStale(iso: string, at: number = Date.now()): boolean {
  return at - new Date(iso).getTime() > STALE_MS;
}

/** 工具：从投影取任务字段现值 */
export function missionField<T>(m: EntityState, field: string): T | undefined {
  return m.fields[field]?.value as T | undefined;
}

export type { ArchivedTrack };
