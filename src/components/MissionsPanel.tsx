'use client';

import { Badge, Button, Card, Group, Stack, Text, Textarea, Title } from '@mantine/core';
import { useState } from 'react';
import type { LedgerStore } from '@/lib/store';
import { NODE_LABEL, type NodeId, type Projection } from '@/lib/ledger/types';
import { fieldLabel, missionRows } from '@/lib/views';

interface Props {
  view: Projection;
  store: LedgerStore;
  node: NodeId;
}

export function MissionsPanel({ view, store, node }: Props) {
  const missions = missionRows(view);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <Card withBorder>
      <Title order={3}>任务单调度账</Title>
      <Text size="xs" c="dimmed" mt={4}>
        任务单每次实质更新版次(gen)+1：旧覆盖率、过期在途位置立即失效重算；关闭任务不会再派回单位，航迹另档留存。
      </Text>
      <Stack mt="md" gap="sm">
        {missions.map((m) => {
          const closed = m.status === 'closed';
          return (
            <Card key={m.id} withBorder padding="sm" opacity={closed ? 0.75 : 1}>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Group gap={8}>
                    <b>{m.title}</b>
                    <Badge size="xs" color={m.priority === 'urgent' ? 'red' : 'gray'}>
                      {m.priority === 'urgent' ? '紧急' : '常规'}
                    </Badge>
                    <Badge size="xs" variant="outline">{m.status === 'dispatched' ? '已派发' : m.status === 'in_progress' ? '进行中' : '已关闭'}</Badge>
                    <Badge size="xs" variant="outline" color="violet">gen {m.gen}</Badge>
                    {m.conflictFields.length > 0 && (
                      <Badge size="xs" color="red">字段冲突：{m.conflictFields.map(fieldLabel).join('、')}</Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>
                    {m.id} · {m.areaName} · 单位 {m.unitIds.join('、') || '（无）'}
                  </Text>
                </div>
                <Group gap="xs">
                  {!closed && (
                    <Button size="compact-xs" variant="light"
                      onClick={() => store.changeMissionStatus(node, m.id, m.status === 'in_progress' ? 'dispatched' : 'in_progress')}>
                      {m.status === 'in_progress' ? '退回到派发' : '开始执行'}
                    </Button>
                  )}
                  <Button size="compact-xs" color={closed ? 'gray' : 'red'} variant={closed ? 'subtle' : 'filled'}
                    disabled={closed}
                    onClick={() => store.changeMissionStatus(node, m.id, 'closed')}>
                    关闭并归档航迹
                  </Button>
                </Group>
              </Group>

              <Group gap={6} mt={6} align="flex-start">
                <Text size="xs" c="dimmed" mt={3}>
                  当前说明（rev {m.noteRev}，来自{NODE_LABEL[m.noteOrigin as NodeId] ?? m.noteOrigin}）：
                </Text>
              </Group>
              <Text size="sm">{m.note}</Text>

              {!closed && (
                <Group grow mt={6} align="flex-end" gap="xs">
                  <Textarea
                    size="xs"
                    autosize
                    minRows={1}
                    placeholder={`以${NODE_LABEL[node]}身份改说明（离线时改完回网可能冲突，两版都会保留）`}
                    value={drafts[m.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <Button size="compact-xs" w={120}
                    disabled={!(drafts[m.id] ?? '').trim() || drafts[m.id] === m.note}
                    onClick={() => {
                      store.patchMission(node, m.id, 'note', (drafts[m.id] ?? '').trim());
                      setDrafts((d) => ({ ...d, [m.id]: '' }));
                    }}>
                    {NODE_LABEL[node]}改单
                  </Button>
                </Group>
              )}
            </Card>
          );
        })}
      </Stack>
    </Card>
  );
}
