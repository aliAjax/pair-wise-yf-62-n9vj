'use client';

import { Badge, Card, Group, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import { NODE_LABEL, type LedgerEntry, type Projection } from '@/lib/ledger/types';

const KIND_LABEL: Record<LedgerEntry['kind'], string> = {
  AreaRegistered: '搜索区注册',
  UnitRegistered: '单位注册',
  MissionOpened: '任务单开立',
  MissionStatusChanged: '任务状态',
  MissionPatched: '任务改单',
  PositionReported: '位置回执',
  CoverageReported: '覆盖率回执',
  TrackArchived: '航迹归档',
  ConflictRaised: '冲突挂起',
  ConflictResolved: '冲突裁定'
};

function describe(e: LedgerEntry): string {
  switch (e.kind) {
    case 'AreaRegistered': return `${e.areaId} ${e.name}`;
    case 'UnitRegistered': return `${e.unitId} ${e.name}`;
    case 'MissionOpened': return `${e.missionId} ${e.title} → ${e.areaId}`;
    case 'MissionStatusChanged': return `${e.missionId} → ${e.status}（基 gen ${e.fromGen}）`;
    case 'MissionPatched': return `${e.missionId}: ${Object.keys(e.changes).join(',')}`;
    case 'PositionReported': return `${e.unitId} #${e.seq} (${e.lat},${e.lng}) → ${e.missionId ?? '无任务'}@g${e.missionGen ?? '-'}`;
    case 'CoverageReported': return `${e.unitId} #${e.seq} ${e.percent}% → ${e.missionId}@g${e.missionGen}`;
    case 'TrackArchived': return `${e.track.missionId}/${e.track.unitId} ${e.track.points.length}点`;
    case 'ConflictRaised': return `${e.conflict.missionId}.${e.conflict.field}`;
    case 'ConflictResolved': return `${e.missionId}.${e.field} → ${NODE_LABEL[e.chosen]}`;
  }
}

function Row({ e, danger, dim }: { e: LedgerEntry; danger?: string; dim?: boolean }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Badge size="xs" variant="outline" color={e.origin === 'shore' ? 'blue' : 'grape'}>
          {NODE_LABEL[e.origin]}
        </Badge>
      </Table.Td>
      <Table.Td><Text size="xs" c={dim ? 'dimmed' : undefined}>{KIND_LABEL[e.kind]}</Text></Table.Td>
      <Table.Td>
        <Text size="xs" c={dim ? 'dimmed' : undefined}>{describe(e)}</Text>
        {danger && <Text size="xs" c="red.8">⚠ {danger}</Text>}
      </Table.Td>
      <Table.Td><Text size="xs" c="dimmed">{new Date(e.recordedAt).toLocaleTimeString('zh-CN')}</Text></Table.Td>
    </Table.Tr>
  );
}

const HEAD = (
  <Table.Thead>
    <Table.Tr>
      <Table.Th style={{ width: 60 }}>来源</Table.Th>
      <Table.Th style={{ width: 110 }}>类型</Table.Th>
      <Table.Th>内容</Table.Th>
      <Table.Th style={{ width: 90 }}>时间</Table.Th>
    </Table.Tr>
  </Table.Thead>
);

/**
 * 账本审计：账体条目 / 失效回执 / 被忽略的重复与迟到操作。
 * 所有展示数据均来自 append-only 日志的回放结果，丢掉投影、按日志可完整重建。
 */
export function LedgerAuditPanel({ view, entries, shoreCount, boatCount }: {
  view: Projection;
  entries: LedgerEntry[];
  shoreCount: number;
  boatCount: number;
}) {
  const deadEntries: { e: LedgerEntry; reason: string }[] = [];
  for (const p of view.positions.filter((x) => x.state !== 'fresh')) {
    deadEntries.push({
      reason: p.reason ?? p.state,
      e: {
        id: p.entryId, idemKey: '', origin: p.origin, recordedAt: p.observedAt,
        kind: 'PositionReported', unitId: p.unitId, seq: p.seq, lat: p.lat, lng: p.lng,
        observedAt: p.observedAt, missionId: p.missionId, missionGen: p.missionGen
      }
    });
  }
  for (const c of view.coverage.filter((x) => x.state !== 'fresh')) {
    deadEntries.push({
      reason: c.reason ?? c.state,
      e: {
        id: c.entryId, idemKey: '', origin: c.origin, recordedAt: c.observedAt,
        kind: 'CoverageReported', unitId: c.unitId, seq: c.seq, missionId: c.missionId,
        areaId: c.areaId, missionGen: c.missionGen, percent: c.percent, observedAt: c.observedAt
      }
    });
  }

  return (
    <Card withBorder>
      <Group justify="space-between">
        <Title order={3}>账本审计（可恢复）</Title>
        <Text size="xs" c="dimmed">
          已入账 {view.entriesApplied} 条 · 岸基 {shoreCount} / 船艇 {boatCount} · 状态全部由日志回放重建
        </Text>
      </Group>

      <Tabs defaultValue="entries" mt="sm">
        <Tabs.List>
          <Tabs.Tab value="entries">账体条目（{view.entriesApplied}）</Tabs.Tab>
          <Tabs.Tab value="dead">失效回执（{deadEntries.length}）</Tabs.Tab>
          <Tabs.Tab value="ignored">丢弃/忽略（{view.ignored.length}）</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="entries">
          <Table horizontalSpacing="xs" verticalSpacing={4}>
            {HEAD}
            <Table.Tbody>
              {[...entries].reverse().slice(0, 80).map((e) => <Row key={e.id} e={e} />)}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="dead">
          <Table horizontalSpacing="xs" verticalSpacing={4}>
            {HEAD}
            <Table.Tbody>
              {deadEntries.length === 0
                ? <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed" py="sm">无失效回执。</Text></Table.Td></Table.Tr>
                : deadEntries.map(({ e, reason }) => <Row key={e.id} e={e} danger={reason} dim />)}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="ignored">
          {view.ignored.length === 0 ? (
            <Text size="sm" c="dimmed" py="md">无。重复序号、迟到状态变更等会在此留痕，便于核对"只入账一次"。</Text>
          ) : (
            <Stack gap={4} py="sm">
              {view.ignored.map((ig) => (
                <Text key={ig.entryId} size="xs" c="orange.8">⚠ 条目 {ig.entryId.slice(0, 18)}… 被忽略：{ig.reason}</Text>
              ))}
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>
    </Card>
  );
}
