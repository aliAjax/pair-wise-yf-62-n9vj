'use client';

import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { LedgerStore } from '@/lib/store';
import { NODE_LABEL } from '@/lib/ledger/types';
import type { Projection } from '@/lib/ledger/types';
import { unitRows } from '@/lib/views';

interface Props {
  view: Projection;
  store: LedgerStore;
}

/**
 * 同步面板：低带宽下也能一眼读到
 * - 最近一次回网合并的结果（收到/去重/冲突/失效条数）
 * - 当前仍未回传的单位
 */
export function SyncPanel({ view, store }: Props) {
  const units = unitRows(view);
  const unreported = units.filter((u) => u.unreported);
  const pendingConflicts = Object.values(view.conflicts).filter((c) => c.status === 'pending').length;
  const superseded =
    view.positions.filter((p) => p.state === 'superseded').length +
    view.coverage.filter((c) => c.state === 'superseded').length;
  const last = store.lastSync;

  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>回网同步</Title>
          <Badge mt={6} color={store.link === 'linked' ? 'teal' : 'red'} variant="filled">
            {store.link === 'linked' ? '链路已通 · 写入实时双发' : '断链中 · 双方各自记账'}
          </Badge>
        </div>
        <Group>
          <Button
            variant={store.link === 'down' ? 'filled' : 'default'}
            color="red"
            onClick={() => store.setLink('down')}
            disabled={store.link === 'down'}
          >
            切断链路
          </Button>
          <Button onClick={store.syncNow} disabled={store.link === 'linked'}>
            回网合并
          </Button>
        </Group>
      </Group>

      <Stack gap="xs" mt="md">
        {last ? (
          <Card padding="sm" bg="var(--mantine-color-teal-0)">
            <Text size="sm" fw={600}>
              最近同步：{formatDistanceToNow(new Date(last.at), { addSuffix: true, locale: zhCN })}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              岸基新收 {last.shoreReceived} 条 · 船艇新收 {last.boatReceived} 条 ·
              幂等去重 {last.duplicates} 条 · 新挂起冲突 {last.conflictsRaised} 个 ·
              合并后失效回执 {last.supersededReceipts} 条
            </Text>
            <Text size="xs" c="dimmed">
              合并后账长：岸基 {last.shoreLogSize} 条 / 船艇 {last.boatLogSize} 条（应一致）
            </Text>
          </Card>
        ) : (
          <Text size="sm" c="dimmed">尚未回网合并，当前为双方本地账的合并预览（去重/失效判定同样生效）。</Text>
        )}

        <Group gap="xs">
          <Badge color={unreported.length ? 'orange' : 'teal'} variant="light">
            未回传单位 {unreported.length}
          </Badge>
          <Badge color={pendingConflicts ? 'red' : 'gray'} variant="light">
            待确认冲突 {pendingConflicts}
          </Badge>
          <Badge color={superseded ? 'orange' : 'gray'} variant="light">
            失效回执 {superseded}
          </Badge>
          <Badge color="gray" variant="light">
            已归档航迹 {view.tracks.length} 段
          </Badge>
        </Group>

        {unreported.length > 0 && (
          <Text size="xs" c="orange.8">
            ⚠ {unreported.map((u) => `${u.name}（序号${u.watermarkSeq}，${u.lastReceiptAt ? formatDistanceToNow(new Date(u.lastReceiptAt), { addSuffix: true, locale: zhCN }) : '从无回执'}）`).join('；')}
          </Text>
        )}

        <Text size="xs" c="dimmed">
          岸基账 {store.shore.entries.length} 条 · 船艇账 {store.boat.entries.length} 条
          {store.link === 'down' && store.shore.entries.length !== store.boat.entries.length && ' · 断链产生差异，待合并'}
        </Text>
      </Stack>
    </Card>
  );
}

export function nodeBadge(origin: 'shore' | 'boat') {
  return <Badge size="xs" variant="outline" color={origin === 'shore' ? 'blue' : 'grape'}>{NODE_LABEL[origin]}</Badge>;
}
