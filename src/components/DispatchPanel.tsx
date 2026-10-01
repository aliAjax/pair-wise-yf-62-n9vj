'use client';

import { Badge, Button, Card, Group, MultiSelect, Select, Stack, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import type { LedgerStore } from '@/lib/store';
import { NODE_LABEL, type NodeId, type Projection } from '@/lib/ledger/types';

interface Props {
  view: Projection;
  store: LedgerStore;
  node: NodeId;
}

/** 新任务单入账；断链时只入本地账，回网合并后双方一致 */
export function DispatchPanel({ view, store, node }: Props) {
  const [title, setTitle] = useState('');
  const [areaId, setAreaId] = useState<string>(view.areas[0]?.id ?? '');
  const [units, setUnits] = useState<string[]>([]);
  const [priority, setPriority] = useState<'normal' | 'urgent'>('urgent');
  const [note, setNote] = useState('');

  const submit = () => {
    if (title.trim().length < 3 || !areaId || units.length === 0) return;
    store.openMission(node, { title: title.trim(), areaId, unitIds: units, priority, note: note.trim() });
    setTitle(''); setUnits([]); setNote('');
  };

  return (
    <Card withBorder h="100%">
      <Group justify="space-between">
        <Title order={3}>开立任务单</Title>
        <Badge variant="outline" color={node === 'shore' ? 'blue' : 'grape'}>
          记入{NODE_LABEL[node]}账
        </Badge>
      </Group>
      <Stack gap="xs" mt="md">
        <TextInput size="sm" label="任务名称（≥3字）" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Select
          size="sm"
          label="搜索区"
          data={view.areas.map((a) => ({
            value: a.id,
            label: String(a.fields.name?.value ?? a.id) + (String(a.fields.status?.value) === 'closed' ? '（已关闭）' : '')
          }))}
          value={areaId}
          onChange={(v) => v && setAreaId(v)}
          allowDeselect={false}
        />
        <MultiSelect
          size="sm"
          label="调派单位（可多选）"
          data={view.units.map((u) => ({ value: u.id, label: String(u.fields.name?.value ?? u.id) }))}
          value={units}
          onChange={(values) => setUnits(values)}
          searchable
        />
        <Select
          size="sm"
          label="优先级"
          data={[{ value: 'normal', label: '常规' }, { value: 'urgent', label: '紧急' }]}
          value={priority}
          onChange={(v) => setPriority((v as 'normal' | 'urgent') ?? 'urgent')}
          allowDeselect={false}
        />
        <TextInput size="sm" label="任务说明" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" onClick={submit} disabled={title.trim().length < 3 || !areaId || units.length === 0}>
          入账并派发
        </Button>
      </Stack>
    </Card>
  );
}
