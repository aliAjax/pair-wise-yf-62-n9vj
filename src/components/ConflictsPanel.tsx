'use client';

import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { LedgerStore } from '@/lib/store';
import { NODE_LABEL, type Projection } from '@/lib/ledger/types';
import { fieldLabel } from '@/lib/views';

/**
 * 字段冲突：基版 + 岸/船两版都摆出来，裁定前任何一方都不覆盖。
 * 裁定入账后字段定为所选版本，并要求各方按确认版重新回传回执。
 */
export function ConflictsPanel({ view, store }: { view: Projection; store: LedgerStore }) {
  const pending = Object.values(view.conflicts).filter((c) => c.status === 'pending');
  const resolved = Object.values(view.conflicts).filter((c) => c.status === 'resolved');

  if (pending.length === 0 && resolved.length === 0) {
    return (
      <Card withBorder>
        <Title order={3}>字段冲突待确认</Title>
        <Text size="sm" c="dimmed" mt={8}>无冲突。离线双方基于同一版修改同一字段时，两版会在这里保留待裁定。</Text>
      </Card>
    );
  }

  return (
    <Card withBorder>
      <Title order={3}>字段冲突待确认</Title>
      <Stack mt="md" gap="sm">
        {pending.map((c) => (
          <Card key={c.id} withBorder padding="sm" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
            <Text size="sm">
              <b>{c.missionId}</b> · 字段「{fieldLabel(c.field)}」基于 rev {c.base.rev} 被双方同时修改
            </Text>
            <Text size="xs" c="dimmed" mt={2}>基版值：{String(c.base.value) || '（空）'}</Text>
            <Group grow mt={6} gap="sm" align="stretch">
              <Card padding="xs" bg="var(--mantine-color-blue-0)">
                <Badge size="xs" color="blue">{NODE_LABEL.shore}版</Badge>
                <Text size="sm" mt={4}>{String(c.shore.value)}</Text>
                <Text size="xs" c="dimmed">{formatDistanceToNow(new Date(c.shore.time), { addSuffix: true, locale: zhCN })}</Text>
              </Card>
              <Card padding="xs" bg="var(--mantine-color-grape-0)">
                <Badge size="xs" color="grape">{NODE_LABEL.boat}版</Badge>
                <Text size="sm" mt={4}>{String(c.boat.value)}</Text>
                <Text size="xs" c="dimmed">{formatDistanceToNow(new Date(c.boat.time), { addSuffix: true, locale: zhCN })}</Text>
              </Card>
            </Group>
            <Group mt={8} justify="flex-end">
              <Button size="compact-xs" variant="light" color="blue"
                onClick={() => store.resolveConflict(c.missionId, c.field, 'shore')}>
                采用{NODE_LABEL.shore}版
              </Button>
              <Button size="compact-xs" variant="light" color="grape"
                onClick={() => store.resolveConflict(c.missionId, c.field, 'boat')}>
                采用{NODE_LABEL.boat}版
              </Button>
            </Group>
          </Card>
        ))}
        {resolved.map((c) => (
          <Card key={c.id} withBorder padding="sm">
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {c.missionId} ·「{fieldLabel(c.field)}」已裁定采用{NODE_LABEL[c.chosen ?? 'shore']}版：{String(c.resolvedValue)}
              </Text>
              <Badge size="xs" color="teal">已确认</Badge>
            </Group>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}
