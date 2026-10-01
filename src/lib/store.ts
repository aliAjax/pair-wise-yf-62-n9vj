'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ArchivedTrack, LedgerEntry, NodeId, SyncResult } from './ledger/types';
import { emptyNode, entry as E, exchangeLogs, project, type LedgerNode } from './ledger/merge';
import { replay } from './ledger/replay';
import { buildSeed } from './ledger/seed';

export type LinkState = 'down' | 'linked';

export interface LedgerStore {
  shore: LedgerNode;
  boat: LedgerNode;
  link: LinkState;
  lowBandwidth: boolean;
  lastSync: SyncResult | null;
  /** 合并后的权威投影（每次 sync 后固化；未合并时由选择器实时合并） */
  syncedEntries: LedgerEntry[] | null;

  setLink: (link: LinkState) => void;
  toggleLowBandwidth: () => void;
  resetLedger: () => void;
  /** 回网合并：双向去重、冲突挂起、失效统计 */
  syncNow: () => void;

  openMission: (nodeId: NodeId, input: { title: string; areaId: string; unitIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  changeMissionStatus: (nodeId: NodeId, missionId: string, status: 'dispatched' | 'in_progress' | 'closed') => void;
  patchMission: (nodeId: NodeId, missionId: string, field: string, value: string | string[]) => void;
  resolveConflict: (missionId: string, field: string, chosen: NodeId) => void;

  reportPosition: (nodeId: NodeId, unitId: string) => void;
  reportCoverage: (nodeId: NodeId, unitId: string, percent: number) => void;
  /** 模拟失联单位回网重传：构造同一序号的新条目（不同 entryId），应被幂等丢弃 */
  resendLastReceipt: (nodeId: NodeId, unitId: string) => void;
}

function seedNodes(): { shore: LedgerNode; boat: LedgerNode } {
  const { shoreEntries, boatEntries } = buildSeed();
  return {
    shore: { id: 'shore', entries: shoreEntries },
    boat: { id: 'boat', entries: boatEntries }
  };
}

function other(nodeId: NodeId): NodeId {
  return nodeId === 'shore' ? 'boat' : 'shore';
}

/** 单位报位置/覆盖率时的下一个序号：取本节点已知水线 +1 */
function nextSeq(node: LedgerNode, unitId: string): number {
  return (project(node).watermark[unitId]?.seq ?? 0) + 1;
}

/** 在途任务上下文：把回执盖在该单位当前（本节点所见的）开放任务与版次上 */
function missionContext(node: LedgerNode, unitId: string): { missionId: string | null; missionGen: number | null; areaId: string | null } {
  const view = project(node);
  const missionId = view.assignments[unitId]?.[0] ?? null;
  if (!missionId) return { missionId: null, missionGen: null, areaId: null };
  const m = view.missions.find((item) => item.id === missionId);
  return {
    missionId,
    missionGen: m?.gen ?? null,
    areaId: (m?.fields.areaId?.value as string) ?? null
  };
}

/** 关闭任务时，把各单位在该任务上的轨迹快照归档（只追加、永久留档） */
function buildTrackArchives(node: LedgerNode, missionId: string, origin: NodeId): LedgerEntry[] {
  const view = project(node);
  const m = view.missions.find((item) => item.id === missionId);
  if (!m) return [];
  const areaId = String(m.fields.areaId?.value ?? '');
  const unitIds = (m.fields.unitIds?.value as string[] | undefined) ?? [];
  const out: LedgerEntry[] = [];
  for (const unitId of unitIds) {
    const points = view.positions
      .filter((p) => p.unitId === unitId && p.missionId === missionId)
      .map((p) => ({ lat: p.lat, lng: p.lng, time: p.observedAt }));
    if (points.length === 0) continue;
    const track: ArchivedTrack = {
      missionId, areaId, unitId, points, closedAt: new Date().toISOString(),
      entryId: `track-${missionId}-${unitId}-${Date.now().toString(36)}`
    };
    out.push(E.trackArchived(origin, track));
  }
  return out;
}

export const useLedgerStore = create<LedgerStore>()(
  persist(
    (set, get) => {
      /** 往节点追加；链路通时同一条目同时入账对方（实时传播，天然不会产生冲突） */
      const append = (nodeId: NodeId, newEntries: LedgerEntry[]) => {
        const state = get();
        const target = state[nodeId];
        const peer = state[other(nodeId)];
        const next = {
          [nodeId]: { ...target, entries: [...target.entries, ...newEntries] }
        } as Partial<LedgerStore>;
        if (state.link === 'linked') {
          next[other(nodeId)] = { ...peer, entries: [...peer.entries, ...newEntries] };
        }
        set(next as Pick<LedgerStore, 'shore' | 'boat'>);
      };

      return {
        ...seedNodes(),
        link: 'down',
        lowBandwidth: false,
        lastSync: null,
        syncedEntries: null,

        setLink: (link) => set({ link }),
        toggleLowBandwidth: () => set((s) => ({ lowBandwidth: !s.lowBandwidth })),

        resetLedger: () => set({ ...seedNodes(), link: 'down', lastSync: null, syncedEntries: null }),

        syncNow: () => {
          const { shore, boat } = get();
          const { merged, result } = exchangeLogs(shore, boat);
          const sync: SyncResult = {
            at: new Date().toISOString(),
            ...result,
            shoreLogSize: merged.length,
            boatLogSize: merged.length
          };
          set({
            shore: { id: 'shore', entries: merged },
            boat: { id: 'boat', entries: merged },
            link: 'linked',
            syncedEntries: merged,
            lastSync: sync
          });
        },

        openMission: (nodeId, input) => {
          const missionId = `mission-${Date.now().toString(36)}`;
          append(nodeId, [E.missionOpened(nodeId, missionId, input.title, input.areaId, input.unitIds, input.priority, input.note)]);
        },

        changeMissionStatus: (nodeId, missionId, status) => {
          const node = get()[nodeId];
          const m = project(node).missions.find((item) => item.id === missionId);
          if (!m) return;
          const newEntries: LedgerEntry[] = [E.missionStatus(nodeId, missionId, status, m.gen ?? 1)];
          if (status === 'closed') {
            // 已完成航迹在关闭一刻照旧归档，之后任何重算都不动它
            newEntries.push(...buildTrackArchives(node, missionId, nodeId));
          }
          append(nodeId, newEntries);
        },

        patchMission: (nodeId, missionId, field, value) => {
          const node = get()[nodeId];
          const m = project(node).missions.find((item) => item.id === missionId);
          const current = m?.fields[field];
          if (!m || !current) return;
          if (JSON.stringify(current.value) === JSON.stringify(value)) return;
          append(nodeId, [E.missionPatch(nodeId, missionId, {
            [field]: { value, baseRev: current.rev, baseValue: current.value }
          })]);
        },

        resolveConflict: (missionId, field, chosen) => {
          const view = project(get().shore);
          const conflict = view.conflicts[`${missionId}:${field}`];
          if (!conflict) return;
          const value = chosen === 'shore' ? conflict.shore.value : conflict.boat.value;
          // 裁定是岸基职权：先入岸基账，链路通时同步传播
          append('shore', [E.conflictResolved('shore', conflict.id, missionId, field, chosen, value)]);
        },

        reportPosition: (nodeId, unitId) => {
          const node = get()[nodeId];
          const seq = nextSeq(node, unitId);
          const ctx = missionContext(node, unitId);
          // 演示用：在最近位置附近小幅漂移
          const last = project(node).latestPosition[unitId];
          const lat = (last ? last.lat : 30.75) + (Math.random() - 0.5) * 0.04;
          const lng = (last ? last.lng : 121.55) + (Math.random() - 0.5) * 0.04;
          append(nodeId, [E.position(nodeId, unitId, seq, Number(lat.toFixed(4)), Number(lng.toFixed(4)),
            new Date().toISOString(), ctx.missionId, ctx.missionGen)]);
        },

        reportCoverage: (nodeId, unitId, percent) => {
          const node = get()[nodeId];
          const seq = nextSeq(node, unitId);
          const ctx = missionContext(node, unitId);
          if (!ctx.missionId || !ctx.areaId || ctx.missionGen == null) return;
          append(nodeId, [E.coverage(nodeId, unitId, seq, ctx.missionId, ctx.areaId, ctx.missionGen,
            percent, new Date().toISOString())]);
        },

        resendLastReceipt: (nodeId, unitId) => {
          // 模拟离线单位把缓存的旧回执再发一遍：同 idemKey、不同 entryId
          const node = get()[nodeId];
          const view = project(node);
          const wm = view.watermark[unitId];
          if (!wm) return;
          const pos = [...view.positions].reverse().find((p) => p.unitId === unitId);
          const cov = [...view.coverage].reverse().find((p) => p.unitId === unitId);
          const dup: LedgerEntry = pos && (!cov || pos.seq >= cov.seq)
            ? E.position(nodeId, unitId, pos.seq, pos.lat, pos.lng, pos.observedAt, pos.missionId, pos.missionGen)
            : E.coverage(nodeId, unitId, cov!.seq, cov!.missionId, cov!.areaId, cov!.missionGen, cov!.percent, cov!.observedAt);
          append(nodeId, [dup]);
        }
      };
    },
    {
      name: 'maritime-ledger-v2',
      version: 2
    }
  )
);

/** 合并视角：把双方日志拼起重放，回放层负责去重/失效（未点同步时也能预览差异） */
export function useMergedView() {
  const shore = useLedgerStore((s) => s.shore);
  const boat = useLedgerStore((s) => s.boat);
  return replay([...shore.entries, ...boat.entries]);
}

export { project as projectNode, emptyNode };
