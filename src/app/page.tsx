'use client';

import { SegmentedControl, Stack, Group, Title, Text, Badge, Switch, Button, SimpleGrid, Card, Grid } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useLedgerStore, useMergedView } from '@/lib/store';
import { NODE_LABEL, type NodeId } from '@/lib/ledger/types';
import { SearchMap } from '@/components/SearchMap';
import { SyncPanel } from '@/components/SyncPanel';
import { UnitsPanel } from '@/components/UnitsPanel';
import { MissionsPanel } from '@/components/MissionsPanel';
import { AreasPanel } from '@/components/AreasPanel';
import { ConflictsPanel } from '@/components/ConflictsPanel';
import { DispatchPanel } from '@/components/DispatchPanel';
import { TracksPanel } from '@/components/TracksPanel';
import { LedgerAuditPanel } from '@/components/LedgerAuditPanel';
import { areaRows, unitRows } from '@/lib/views';

export default function CommandPage() {
  const store = useLedgerStore();
  const [node, setNode] = useState<NodeId>('shore');
  // 合并视角：双方本地账拼起重放（回放层去重/判失效）；同步后两账一致
  const liveView = useMergedView();
  const mergedEntries = useMemo(() => {
    const byId = new Map<string, typeof store.shore.entries[number]>();
    const idem = new Set<string>();
    const all = [...store.shore.entries, ...store.boat.entries]
      .sort((a, b) => a.recordedAt === b.recordedAt ? a.id.localeCompare(b.id) : a.recordedAt.localeCompare(b.recordedAt));
    for (const e of all) {
      if (byId.has(e.id) || idem.has(e.idemKey)) continue;
      byId.set(e.id, e);
      idem.add(e.idemKey);
    }
    return [...byId.values()];
  }, [store.shore.entries, store.boat.entries]);

  const stats = [
    ['搜索区（执行中）', liveView.areas.filter((a) => a.fields.status?.value === 'active').length],
    ['单位总数', liveView.units.length],
    ['未回传单位', unitRows(liveView).filter((u) => u.unreported).length],
    ['在途任务', liveView.missions.filter((m) => m.status !== 'closed').length],
    ['待确认冲突', Object.values(liveView.conflicts).filter((c) => c.status === 'pending').length],
    ['失效回执',
      liveView.positions.filter((p) => p.state === 'superseded').length +
      liveView.coverage.filter((c) => c.state === 'superseded').length],
    ['已归档航迹', liveView.tracks.length],
    ['待重算覆盖率', areaRows(liveView).filter((a) => a.coverage === null).length]
  ] as const;

  return (
    <main className={store.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1680} mx="auto">
        <Group justify="space-between" align="flex-end" wrap="nowrap">
          <div>
            <Group gap="sm">
              <Badge color={store.link === 'linked' ? 'teal' : 'red'} size="lg">
                {store.link === 'linked' ? '链路已通' : '断链作业'}
              </Badge>
              <Title order={1} className="section-title">海上搜救调度账</Title>
            </Group>
            <Text c="dimmed" size="sm" mt={4}>
              搜索区 · 单位 · 任务单 · 位置回执 同入一本 append-only 账：序号幂等、字段冲突留双版、任务更新即失效重算、完成航迹永久归档
            </Text>
          </div>
          <Group>
            <Switch label="低带宽" checked={store.lowBandwidth} onChange={store.toggleLowBandwidth} />
            <Button variant="subtle" color="gray" onClick={store.resetLedger}>重置场景</Button>
          </Group>
        </Group>

        <SyncPanel view={liveView} store={store} />

        <Group justify="space-between">
          <Group gap="sm">
            <Text size="sm" fw={600}>当前操作身份：</Text>
            <SegmentedControl
              value={node}
              onChange={(v) => setNode(v as NodeId)}
              data={[
                { label: NODE_LABEL.shore, value: 'shore' },
                { label: NODE_LABEL.boat, value: 'boat' }
              ]}
            />
            <Text size="xs" c="dimmed">
              断链时所有写入只入{NODE_LABEL[node]}本地账；链路已通时双发入账
            </Text>
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4, lg: 8 }}>
          {stats.map(([label, value]) => (
            <Card key={label} withBorder padding="sm">
              <Text size="xs" c="dimmed">{label}</Text>
              <Title order={3}>{value}</Title>
            </Card>
          ))}
        </SimpleGrid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            {store.lowBandwidth ? (
              <Card withBorder>
                <Title order={3}>低带宽态势（纯文本）</Title>
                <Stack gap={4} mt="sm">
                  {unitRows(liveView).map((u) => (
                    <Text key={u.id} size="sm">
                      {u.name} · {u.unreported ? '【未回传】' : ''}
                      {u.latest ? (u.latest.state === 'fresh' ? '位置有效' : `【${u.latest.state === 'stale' ? '位置过期' : '在途位置失效'}】`) : '无位置'}
                      {' '}· 序号{u.watermarkSeq}
                      {u.activeMissionIds.length ? ` · 在途 ${u.activeMissionIds.join('/')}` : ''}
                    </Text>
                  ))}
                  {areaRows(liveView).map((a) => (
                    <Text key={a.id} size="sm">
                      {a.name} · {a.coverage === null ? '覆盖率待重算（旧值已失效）' : `覆盖率 ${a.coverage}%`}
                    </Text>
                  ))}
                </Stack>
              </Card>
            ) : (
              <Card withBorder>
                <Title order={3}>搜救态势</Title>
                <SearchMap view={liveView} />
              </Card>
            )}
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <UnitsPanel view={liveView} store={store} node={node} />
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 4 }}><AreasPanel view={liveView} /></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 5 }}><MissionsPanel view={liveView} store={store} node={node} /></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 3 }}><DispatchPanel view={liveView} store={store} node={node} /></Grid.Col>
        </Grid>

        <ConflictsPanel view={liveView} store={store} />
        <TracksPanel view={liveView} />
        <LedgerAuditPanel
          view={liveView}
          entries={mergedEntries}
          shoreCount={store.shore.entries.length}
          boatCount={store.boat.entries.length}
        />
      </Stack>
    </main>
  );
}
