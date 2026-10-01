import type { Mission, PositionReceipt, RescueAsset, SearchArea } from './types';

/** 位置回执有效期：超过该时长的位置判为过期，不再参与覆盖率与态势计算 */
export const POSITION_TTL_MS = 10 * 60_000;

const GRID = 6;

/** 位置回执去重键：同一单位序号 + 同一回执序号只入账一次 */
export const positionKey = (unitSerial: string, seq: number) => `p:${unitSerial}#${seq}`;
export const taskKey = (unitSerial: string, seq: number) => `t:${unitSerial}#${seq}`;

export function nextSeqFor(
  receipts: { unitSerial: string; seq: number }[],
  unitSerial: string
): number {
  let max = 0;
  for (const r of receipts) {
    if (r.unitSerial === unitSerial && r.seq > max) max = r.seq;
  }
  return max + 1;
}

export function latestReceiptByUnit(receipts: PositionReceipt[]): Map<string, PositionReceipt> {
  const map = new Map<string, PositionReceipt>();
  for (const r of receipts) {
    const cur = map.get(r.unitSerial);
    if (!cur || new Date(r.time).getTime() > new Date(cur.time).getTime()) {
      map.set(r.unitSerial, r);
    }
  }
  return map;
}

export interface CoverageInfo {
  percent: number;
  covered: number;
  total: number;
  fresh: number;
}

/**
 * 由台账派生搜索区覆盖率：
 * - 只统计搜索区纪元之后、且未过期的位置回执；
 * - 任务单一旦更新，纪元刷新，旧覆盖率立即失效、按新回执重算。
 */
export function coverageOf(area: SearchArea, receipts: PositionReceipt[], now: number): CoverageInfo {
  const [w, s, e, n] = area.bounds;
  const epoch = new Date(area.epoch).getTime();
  const cells = new Set<string>();
  let fresh = 0;
  for (const r of receipts) {
    const t = new Date(r.time).getTime();
    if (t < epoch) continue; // 旧纪元回执，失效
    if (now - t > POSITION_TTL_MS) continue; // 过期位置，失效
    if (r.lng < w || r.lng > e || r.lat < s || r.lat > n) continue;
    fresh += 1;
    const cx = Math.min(GRID - 1, Math.floor(((r.lng - w) / (e - w)) * GRID));
    const cy = Math.min(GRID - 1, Math.floor(((r.lat - s) / (n - s)) * GRID));
    cells.add(`${cx},${cy}`);
  }
  return { percent: Math.round((cells.size / (GRID * GRID)) * 100), covered: cells.size, total: GRID * GRID, fresh };
}

/** 未回传单位：没有回执或最近回执已过期 */
export function staleUnits(
  assets: RescueAsset[],
  receipts: PositionReceipt[],
  now: number
): RescueAsset[] {
  const latest = latestReceiptByUnit(receipts);
  return assets.filter((a) => {
    const r = latest.get(a.serial);
    if (!r) return true;
    return now - new Date(r.time).getTime() > POSITION_TTL_MS;
  });
}

/** 在途任务：已派发/进行中、尚未完成的任务单 */
export function inTransitMissions(missions: Mission[]): Mission[] {
  return missions.filter((m) => m.status === 'dispatched' || m.status === 'in_progress');
}

export function cellCenter(area: SearchArea, cx: number, cy: number): [number, number] {
  const [w, s, e, n] = area.bounds;
  return [s + ((cy + 0.5) / GRID) * (n - s), w + ((cx + 0.5) / GRID) * (e - w)];
}

export { GRID as COVERAGE_GRID };
