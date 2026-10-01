'use client';

import { Badge, Button, Card, Grid, Group, List, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, Timeline, Title, Alert, Divider, ThemeIcon } from '@mantine/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useMemo, useState } from 'react';
import { useCommandStore } from '@/lib/store';
import { SearchMap } from '@/components/SearchMap';
import { coverageOf, staleUnits, inTransitMissions, POSITION_TTL_MS } from '@/lib/ledger';
import type { MissionStatus } from '@/lib/types';

const missionSchema = z.object({
  title: z.string().min(3, '任务名称至少3个字'),
  areaId: z.string().min(1),
  assetIds: z.array(z.string()).min(1, '至少调派一个单位'),
  priority: z.enum(['normal', 'urgent']),
  note: z.string().max(160)
});

const statusBadge = (status: string) =>
  status === 'offline' || status === 'closed' ? 'red'
    : status === 'assigned' || status === 'in_progress' || status === 'dispatched' ? 'blue'
    : status === 'urgent' ? 'red' : 'teal';

export default function CommandPage() {
  const state = useCommandStore();
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['ship-01']);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof missionSchema>>({
    resolver: zodResolver(missionSchema),
    defaultValues: { title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' }
  });

  const now = Date.now();
  const stale = useMemo(() => staleUnits(state.assets, state.receipts, now), [state.assets, state.receipts, now]);
  const inTransit = inTransitMissions(state.missions);
  const pendingConflicts = state.conflicts.filter((c) => c.status === 'pending');
  const lastSync = state.syncResults[0];
  const pendingCount = state.pending.positions.length + state.pending.taskReceipts.length;

  const coverageByArea = useMemo(() => {
    const map = new Map<string, ReturnType<typeof coverageOf>>();
    for (const area of state.areas) map.set(area.id, coverageOf(area, state.receipts, now));
    return map;
  }, [state.areas, state.receipts, now]);

  const submitMission = (values: z.infer<typeof missionSchema>) => {
    state.dispatchMission({ ...values, assetIds: selectedAssets });
    reset({ title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' });
  };

  const areaName = (id: string) => state.areas.find((a) => a.id === id)?.name ?? id;
  const assetName = (id: string) => state.assets.find((a) => a.id === id)?.name ?? id;

  return (
    <main className={state.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1600} mx="auto">
        <Group justify="space-between" align="flex-end">
          <div>
            <Badge color={state.offline ? 'red' : 'teal'}>{state.offline ? '离线缓存模式' : '联合指挥在线'}</Badge>
            <Title order={1} className="section-title">海上搜救联合指挥</Title>
            <Text c="dimmed">搜索区、单位、任务单与位置回执一本账：序号只入账一次，冲突两版待确认</Text>
          </div>
          <Group>
            <Switch label="低带宽" checked={state.lowBandwidth} onChange={state.toggleBandwidth} />
            <Switch label="模拟离线" checked={state.offline} onChange={state.toggleOffline} />
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 2, md: 4 }}>
          {[
            ['活动搜索区', state.areas.filter((item) => item.status === 'active').length],
            ['在线单位', state.assets.filter((item) => item.status !== 'offline').length],
            ['在途任务', inTransit.length],
            ['未回传单位', stale.length]
          ].map(([label, value]) => (
            <Card key={String(label)} withBorder>
              <Text size="sm" c="dimmed">{label}</Text>
              <Title order={2} c={label === '未回传单位' && Number(value) > 0 ? 'red' : undefined}>{value}</Title>
            </Card>
          ))}
        </SimpleGrid>

        {/* 低带宽视图：只保留最近同步结果与未回传单位，不加载地图 */}
        {state.lowBandwidth && (
          <Alert color="blue" title="低带宽模式：仅同步摘要">
            <Stack gap="xs">
              <Text size="sm">
                最近同步：{lastSync ? `${lastSync.detail}（${formatDistanceToNow(new Date(lastSync.time), { addSuffix: true, locale: zhCN })}）` : '尚未同步'}
              </Text>
              <Text size="sm" c={stale.length ? 'red' : 'dimmed'}>
                未回传单位 {stale.length} 个：{stale.map((a) => a.name).join('、') || '无'}
              </Text>
              <Group>
                <Button size="xs" onClick={() => state.syncPending()}>回网同步（{pendingCount}）</Button>
                <Button size="xs" variant="default" onClick={state.resyncLastBatch} disabled={state.lastBatch.positions.length + state.lastBatch.taskReceipts.length === 0}>
                  重发上一批
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {pendingConflicts.length > 0 && (
          <Card withBorder>
            <Group justify="space-between">
              <Title order={3}>待确认冲突（{pendingConflicts.length}）</Title>
              <Badge color="orange">两版均保留，未覆盖</Badge>
            </Group>
            <Stack mt="md">
              {pendingConflicts.map((c) => (
                <Card key={c.id} withBorder padding="sm">
                  <Group justify="space-between" align="center">
                    <div>
                      <Text size="sm" fw={600}>{c.refId} · {c.field === 'status' ? '任务状态' : '搜索区'}冲突</Text>
                      <Text size="xs" c="dimmed">检测于 {new Date(c.detectedAt).toLocaleTimeString()}</Text>
                    </div>
                    <Group>
                      <Card withBorder padding="xs" radius="md"><Text size="xs" c="dimmed">台账版</Text><Badge color="blue">{c.field === 'status' ? c.local : areaName(c.local)}</Badge></Card>
                      <Text size="sm" c="dimmed">vs</Text>
                      <Card withBorder padding="xs" radius="md"><Text size="xs" c="dimmed">回执版</Text><Badge color="orange">{c.field === 'status' ? c.remote : areaName(c.remote)}</Badge></Card>
                    </Group>
                    <Group>
                      <Button size="compact-xs" variant="default" onClick={() => state.resolveConflict(c.id, 'local')}>保留台账版</Button>
                      <Button size="compact-xs" color="orange" onClick={() => state.resolveConflict(c.id, 'remote')}>采纳回执版</Button>
                    </Group>
                  </Group>
                </Card>
              ))}
            </Stack>
          </Card>
        )}

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card withBorder>
              <Group justify="space-between">
                <Title order={3}>搜救态势</Title>
                <Text size="sm" c="dimmed">覆盖率由有效位置回执即时重算</Text>
              </Group>
              <SearchMap areas={state.areas} assets={state.assets} />
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card withBorder h="100%">
              <Group justify="space-between">
                <Title order={3}>单位状态</Title>
                <Badge color={stale.length ? 'red' : 'teal'}>{stale.length} 个未回传</Badge>
              </Group>
              <Stack mt="md">
                {state.assets.map((asset) => {
                  const isStale = stale.some((a) => a.id === asset.id);
                  const staleMin = Math.max(0, Math.round((now - new Date(asset.lastSeen).getTime()) / 60_000));
                  return (
                    <Card key={asset.id} withBorder padding="sm">
                      <Group justify="space-between">
                        <b>{asset.name}</b>
                        <Badge color={statusBadge(asset.status)}>{asset.status}</Badge>
                      </Group>
                      <Text size="xs" c={isStale ? 'red' : 'dimmed'}>
                        {isStale ? `位置已过期 · 失联 ${staleMin} 分钟 · ` : ''}
                        {formatDistanceToNow(new Date(asset.lastSeen), { addSuffix: true, locale: zhCN })}
                      </Text>
                      <Group mt="xs">
                        <Button size="compact-xs" variant="default" onClick={() => state.setAssetStatus(asset.id, asset.status === 'offline' ? 'ready' : 'offline')}>
                          {asset.status === 'offline' ? '恢复在线' : '标记失联'}
                        </Button>
                        {asset.status === 'offline' && (
                          <Button size="compact-xs" color="orange" variant="light" onClick={() => state.recordOfflineFix(asset.id)}>
                            记录离线位置
                          </Button>
                        )}
                      </Group>
                    </Card>
                  );
                })}
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Card withBorder>
              <Title order={3}>派发新任务</Title>
              <form onSubmit={handleSubmit(submitMission)}>
                <Stack mt="md">
                  <TextInput label="任务名称" {...register('title')} error={errors.title?.message} />
                  <label>搜索区
                    <select {...register('areaId')} style={{ width: '100%', padding: 8 }}>
                      {state.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                    </select>
                  </label>
                  <label>调派单位（可多选）
                    <select multiple value={selectedAssets} onChange={(event) => setSelectedAssets(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} style={{ width: '100%', minHeight: 86 }}>
                      {state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}（{asset.serial}）</option>)}
                    </select>
                  </label>
                  <label>优先级
                    <select {...register('priority')} style={{ width: '100%', padding: 8 }}>
                      <option value="urgent">紧急</option>
                      <option value="normal">常规</option>
                    </select>
                  </label>
                  <Textarea label="任务说明" {...register('note')} />
                  <Button type="submit">派发任务</Button>
                </Stack>
              </form>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Card withBorder>
              <Group justify="space-between">
                <Title order={3}>同步与回执账</Title>
                <Badge color={pendingCount ? 'orange' : 'teal'}>离线仓 {pendingCount} 条</Badge>
              </Group>
              <Stack mt="md" gap="xs">
                <Group>
                  <Button onClick={() => state.syncPending()}>回网同步</Button>
                  <Button variant="default" onClick={state.resyncLastBatch} disabled={state.lastBatch.positions.length + state.lastBatch.taskReceipts.length === 0}>
                    重发上一批
                  </Button>
                </Group>
                {lastSync ? (
                  <Card withBorder padding="sm" radius="md">
                    <Text size="sm" fw={600}>最近同步 · {formatDistanceToNow(new Date(lastSync.time), { addSuffix: true, locale: zhCN })}</Text>
                    <Text size="xs" c="dimmed">{lastSync.detail}</Text>
                  </Card>
                ) : <Text size="sm" c="dimmed">尚未同步</Text>}
                <Divider my={4} />
                <Text size="xs" c="dimmed">入账规则：同一单位序号（{POSITION_TTL_MS / 60_000} 分钟内）的位置/任务回执只入账一次；重复回执计数不应用；冲突两版挂起待确认。</Text>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>

        <Card withBorder>
          <Title order={3}>搜索区与任务单</Title>
          <Table mt="md">
            <thead><tr><th>搜索区</th><th>状态</th><th>覆盖率（回执重算）</th><th>纪元重算于</th></tr></thead>
            <tbody>
              {state.areas.map((area) => {
                const cov = coverageByArea.get(area.id)!;
                return (
                  <tr key={area.id}>
                    <td>{area.name}</td>
                    <td><Badge color={statusBadge(area.status)}>{area.status}</Badge></td>
                    <td style={{ width: '34%' }}><Progress value={cov.percent} /><Text size="xs" c="dimmed">{cov.covered}/{cov.total} 格 · 有效回执 {cov.fresh} 条</Text></td>
                    <td><Text size="xs" c="dimmed">{formatDistanceToNow(new Date(area.epoch), { addSuffix: true, locale: zhCN })}</Text></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <List mt="lg" spacing="sm">
            {state.missions.map((mission) => (
              <List.Item key={mission.id}>
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Group gap="xs">
                      <b>{mission.title}</b>
                      <Badge color={statusBadge(mission.status)}>{mission.status}</Badge>
                      {mission.invalidatedAssetIds.length > 0 && <Badge color="orange" variant="light">在途失效 {mission.invalidatedAssetIds.length}</Badge>}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {areaName(mission.areaId)} · {mission.assetIds.map(assetName).join(' / ')}
                      {mission.invalidatedAssetIds.length > 0 ? ` · 已释放：${mission.invalidatedAssetIds.map(assetName).join('、')}` : ''}
                    </Text>
                  </div>
                  <Group gap="xs">
                    <Select
                      size="xs"
                      style={{ width: 150 }}
                      value={mission.areaId}
                      data={state.areas.map((a) => ({ value: a.id, label: a.name }))}
                      onChange={(v) => { if (v && v !== mission.areaId) state.updateMission(mission.id, { areaId: v }); }}
                    />
                    {mission.status !== 'closed' && (
                      <>
                        <Button size="compact-xs" variant="default" onClick={() => state.updateMission(mission.id, { status: 'in_progress' as MissionStatus })}>推进</Button>
                        <Button size="compact-xs" color="red" variant="light" onClick={() => state.updateMission(mission.id, { status: 'closed' as MissionStatus })}>关闭留档</Button>
                      </>
                    )}
                  </Group>
                </Group>
              </List.Item>
            ))}
          </List>
        </Card>

        {state.archive.length > 0 && (
          <Card withBorder>
            <Title order={3}>已完成航迹留档（{state.archive.length}）</Title>
            <Stack mt="md">
              {state.archive.map((track) => (
                <Card key={track.missionId} withBorder padding="sm" radius="md">
                  <Group justify="space-between">
                    <div>
                      <Text size="sm" fw={600}>{track.title}</Text>
                      <Text size="xs" c="dimmed">{areaName(track.areaId)} · 关闭于 {new Date(track.closedAt).toLocaleString()}</Text>
                    </div>
                    <Badge color="teal">航迹 {track.track.length} 点 · 只追加不改写</Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mt="xs">
                    {track.track.slice(0, 6).map((p) => `${assetName(p.unitSerial)}(${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})`).join(' → ')}
                    {track.track.length > 6 ? ' …' : ''}
                  </Text>
                </Card>
              ))}
            </Stack>
          </Card>
        )}

        <Card withBorder>
          <Title order={3}>调度台账时间线</Title>
          <Timeline mt="lg" active={state.ledger.length + state.events.length} bulletSize={18} lineWidth={2}>
            {[...state.ledger, ...state.events]
              .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
              .slice(0, 12)
              .map((entry) => (
                <Timeline.Item key={entry.id} title={`${entry.actor} · ${new Date(entry.time).toLocaleTimeString()}`}>
                  <Text size="sm">{entry.message}</Text>
                </Timeline.Item>
              ))}
          </Timeline>
        </Card>
      </Stack>
    </main>
  );
}
