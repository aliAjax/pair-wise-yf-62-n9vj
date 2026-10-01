'use client';

import { Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { Projection } from '@/lib/ledger/types';

/**
 * 已完成航迹：任务关闭瞬间快照入账，只追加、永不重算、永不删除。
 * 即使任务后续被任何一方误操作，这里的轨迹仍然完整可查。
 */
export function TracksPanel({ view }: { view: Projection }) {
  return (
    <Card withBorder>
      <Group justify="space-between">
        <Title order={3}>已完成航迹归档</Title>
        <Badge variant="light" color="gray">{view.tracks.length} 段 · 只追加留档</Badge>
      </Group>
      {view.tracks.length === 0 ? (
        <Text size="sm" c="dimmed" mt={8}>尚无归档。关闭任务时会自动把在途轨迹快照存入账本。</Text>
      ) : (
        <Stack mt="md" gap="sm">
          {view.tracks.map((t) => (
            <Card key={`${t.missionId}:${t.unitId}`} withBorder padding="sm">
              <Group justify="space-between">
                <Text size="sm">
                  <b>{t.missionId}</b> · {t.unitId} · {t.areaId}
                </Text>
                <Text size="xs" c="dimmed">
                  关闭于 {formatDistanceToNow(new Date(t.closedAt), { addSuffix: true, locale: zhCN })}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                {t.points.length} 个轨迹点：
                {t.points.map((p) => `(${p.lat.toFixed(3)},${p.lng.toFixed(3)} ${formatDistanceToNow(new Date(p.time), { addSuffix: true, locale: zhCN })})`).join(' → ')}
              </Text>
            </Card>
          ))}
        </Stack>
      )}
    </Card>
  );
}
