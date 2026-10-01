'use client';

import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { LedgerStore } from '@/lib/store';
import type { NodeId, Projection } from '@/lib/ledger/types';
import { UNIT_TYPE_LABEL, unitRows } from '@/lib/views';

interface Props {
  view: Projection;
  store: LedgerStore;
  node: NodeId;
}

const STATE_HINT: Record<string, { label: string; color: string }> = {
  fresh: { label: '位置有效', color: 'teal' },
  stale: { label: '位置过期', color: 'orange' },
  superseded: { label: '在途位置失效', color: 'red' }
};

export function UnitsPanel({ view, store, node }: Props) {
  const rows = unitRows(view);

  return (
    <Card withBorder h="100%">
      <Title order={3}>单位与回执水线</Title>
      <Text size="xs" c="dimmed" mt={4}>
        每个单位一条单调序号；同一序号重传只入账一次。位置失效后等待单位按新任务版次重报。
      </Text>
      <Stack mt="md" gap="sm">
        {rows.map((u) => {
          const hint = u.latest ? STATE_HINT[u.latest.state] : null;
          return (
            <Card key={u.id} withBorder padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Group gap={6}>
                    <b>{u.name}</b>
                    <Badge size="xs" variant="transparent" c="dimmed">{UNIT_TYPE_LABEL[u.unitType] ?? u.unitType}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    序号 {u.watermarkSeq} ·
                    {u.lastReceiptAt
                      ? ` 最近回执 ${formatDistanceToNow(new Date(u.lastReceiptAt), { addSuffix: true, locale: zhCN })}`
                      : ' 从无回执'}
                  </Text>
                  {u.activeMissionIds.length > 0 && (
                    <Text size="xs" c="blue.8">在途：{u.activeMissionIds.join('、')}</Text>
                  )}
                </div>
                <Group gap={6}>
                  {u.unreported && <Badge color="orange" size="sm">未回传</Badge>}
                  {hint && <Badge color={hint.color} size="sm">{hint.label}</Badge>}
                </Group>
              </Group>
              {u.latest?.reason && (
                <Text size="xs" c={u.latest.state === 'fresh' ? 'dimmed' : 'red.8'} mt={4}>
                  {u.latest.state !== 'fresh' ? '⚠ ' : ''}{u.latest.reason}
                </Text>
              )}
              <Group mt={8} gap="xs">
                <Button size="compact-xs" onClick={() => store.reportPosition(node, u.id)}>
                  报位置
                </Button>
                <Button
                  size="compact-xs"
                  variant="light"
                  disabled={!u.activeMissionIds.length}
                  onClick={() => store.reportCoverage(node, u.id, 20 + Math.round(Math.random() * 70))}
                >
                  报覆盖率
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  disabled={u.watermarkSeq === 0}
                  title="模拟离线单位回网重放同一序号回执，应被幂等丢弃"
                  onClick={() => store.resendLastReceipt(node, u.id)}
                >
                  重传旧序号
                </Button>
              </Group>
            </Card>
          );
        })}
      </Stack>
    </Card>
  );
}
