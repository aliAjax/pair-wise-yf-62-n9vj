'use client';

import { Badge, Card, Group, Progress, Stack, Text, Title } from '@mantine/core';
import type { Projection } from '@/lib/ledger/types';
import { STATUS_LABEL, areaRows } from '@/lib/views';

/**
 * 搜索区覆盖率：只从当前版次的有效回执重算。
 * 任务更新后没有任何有效回执时显示"待重算"，绝不沿用旧覆盖率。
 */
export function AreasPanel({ view }: { view: Projection }) {
  const areas = areaRows(view);
  return (
    <Card withBorder h="100%">
      <Title order={3}>搜索区覆盖率（重算）</Title>
      <Stack mt="md" gap="sm">
        {areas.map((a) => (
          <Card key={a.id} withBorder padding="sm">
            <Group justify="space-between">
              <Group gap={8}>
                <b>{a.name}</b>
                <Badge size="xs" variant="outline">{STATUS_LABEL[a.status] ?? a.status}</Badge>
              </Group>
              {a.coverage === null ? (
                <Badge color="orange" size="sm">覆盖率待重算</Badge>
              ) : (
                <Badge color="teal" size="sm">{a.coverage}%</Badge>
              )}
            </Group>
            {a.coverage === null ? (
              <Progress mt={10} value={0} color="orange" />
            ) : (
              <Progress mt={10} value={a.coverage} color="teal" />
            )}
            <Text size="xs" c="dimmed" mt={6}>
              有效回执 {a.validReceipts} 条
              {a.invalidated > 0 && (
                <Text component="span" c="orange.8"> · ⚠ {a.invalidated} 条旧回执已失效（任务已更新/结束）</Text>
              )}
            </Text>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}
