/**
 * ProjectsManagerModal — 项目管理统一入口(claude-mem-改造需求.md 第 5 节)
 *
 * 替代旧 ContextSettingsModal 里的"项目"分区,提供完整 CRUD:
 *   - 列表(name + obs/summary/path 计数)
 *   - 改名(inline edit)
 *   - 路径管理(增/删,显示 last_seen)
 *   - 删除项目(物理删,需二次确认)
 *   - 合并到其它项目(observations + paths 全转移)
 *
 * 后端走 /api/projects-v2/* (ProjectsRoutes.ts)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../utils/api';

interface ProjectStats {
  observationCount: number;
  summaryCount: number;
  pathCount: number;
}

interface ProjectRecord {
  id: number;  // 8 位数字 ID(10000000-99999999)
  name: string;
  anchor_path: string | null;
  created_at: number;
  updated_at: number;
  stats?: ProjectStats;
}

interface ProjectPathRecord {
  id: number;
  project_id: number;
  path: string;
  added_at: number;
  last_seen_at: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// 目录浏览器(简易 file picker)
interface BrowseEntry {
  name: string;
  path: string;
  isDir: boolean;
  isLink: boolean;
}
interface BrowseResponse {
  cwd: string;
  parent: string | null;
  entries: BrowseEntry[];
  truncated: boolean;
  home: string;
}

function DirectoryPicker({ onPick, onCancel, initialPath }: {
  onPick: (path: string) => void;
  onCancel: () => void;
  initialPath?: string | null;
}) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [manualPath, setManualPath] = useState('');

  const navigate = useCallback(async (path: string | null) => {
    setErr(null);
    const url = '/api/projects-v2/_/browse?' +
      (path ? `path=${encodeURIComponent(path)}` : '') +
      (showHidden ? '&showHidden=1' : '');
    try {
      const res = await authFetch(url);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setErr(`${res.status}: ${e.error || '加载失败'}`);
        return;
      }
      const d: BrowseResponse = await res.json();
      setData(d);
      setManualPath(d.cwd);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [showHidden]);

  useEffect(() => { navigate(initialPath ?? null); }, [navigate, initialPath]);

  const C = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
    panel: { width: 'min(640px, 92vw)', maxHeight: '80vh', background: 'var(--color-bg-primary, #1a1a1a)', border: '1px solid var(--color-border-primary)', borderRadius: 8, display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
    header: { padding: '12px 16px', borderBottom: '1px solid var(--color-border-primary)' } as React.CSSProperties,
    pathBar: { display: 'flex', gap: 6, marginTop: 8 } as React.CSSProperties,
    input: { flex: 1, padding: '6px 10px', fontSize: 12, background: 'var(--color-bg-secondary, #222)', border: '1px solid var(--color-border-primary)', borderRadius: 3, color: 'var(--color-text-primary)', fontFamily: 'monospace' } as React.CSSProperties,
    btn: { padding: '6px 12px', fontSize: 12, background: 'transparent', border: '1px solid var(--color-border-primary)', borderRadius: 3, cursor: 'pointer', color: 'var(--color-text-secondary)' } as React.CSSProperties,
    btnPrimary: { padding: '6px 12px', fontSize: 12, background: 'var(--color-accent, #2563eb)', border: '1px solid var(--color-accent, #2563eb)', borderRadius: 3, cursor: 'pointer', color: '#fff' } as React.CSSProperties,
    list: { flex: 1, overflowY: 'auto' as const, padding: 8 } as React.CSSProperties,
    item: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', borderRadius: 3, fontSize: 13 } as React.CSSProperties,
    footer: { padding: 12, borderTop: '1px solid var(--color-border-primary)', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' } as React.CSSProperties,
  };

  return (
    <div style={C.overlay} onClick={onCancel}>
      <div style={C.panel} onClick={(e) => e.stopPropagation()}>
        <div style={C.header}>
          <strong>选择目录</strong>
          <div style={C.pathBar}>
            <input
              style={C.input}
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(manualPath); }}
              placeholder="直接输入绝对路径,回车跳转"
            />
            <button style={C.btn} onClick={() => navigate(manualPath)}>跳转</button>
            <button style={C.btn} onClick={() => navigate(data?.parent ?? null)} disabled={!data?.parent}>↑ 上一级</button>
            <button style={C.btn} onClick={() => navigate(data?.home ?? null)} title="跳到 $HOME">~</button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-secondary)' }}>
            <label style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> 显示隐藏目录(.开头)
            </label>
          </div>
        </div>

        {err && <div style={{ padding: 10, background: '#3a1a1a', color: '#ff6b6b', fontSize: 12 }}>{err}</div>}

        <div style={C.list}>
          {!data ? (
            <div style={{ padding: 16, color: 'var(--color-text-secondary)', fontSize: 12 }}>加载中…</div>
          ) : data.entries.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--color-text-secondary)', fontSize: 12 }}>(空目录)</div>
          ) : (
            data.entries.map(e => (
              <div
                key={e.path}
                style={{ ...C.item, ...(e.isLink ? { fontStyle: 'italic' } : {}) }}
                onClick={() => navigate(e.path)}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
              >
                <span>📁</span>
                <span>{e.name}{e.isLink ? ' →' : ''}</span>
              </div>
            ))
          )}
          {data?.truncated && (
            <div style={{ padding: 8, fontSize: 11, color: 'var(--color-text-secondary)', textAlign: 'center' }}>
              ⚠ 目录条数过多,已截断到 500 项
            </div>
          )}
        </div>

        <div style={C.footer}>
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            当前: {data?.cwd ?? '…'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={C.btn} onClick={onCancel}>取消</button>
            <button style={C.btnPrimary} onClick={() => data && onPick(data.cwd)} disabled={!data}>选择此目录</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectsManagerModal({ isOpen, onClose }: Props) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [paths, setPaths] = useState<ProjectPathRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // picker 状态:'addPath' / 'anchor' / null,记当前要把路径回传给哪个动作
  const [pickerMode, setPickerMode] = useState<null | 'addPath' | 'anchor'>(null);

  // 列表 + 详情
  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await authFetch('/api/projects-v2');
      if (!res.ok) throw new Error(`列表失败: ${res.status}`);
      const data = await res.json();
      setProjects(data.projects || []);
      // 选中项目还在列表里就保留,否则清掉
      if (selectedId && !data.projects.some((p: ProjectRecord) => p.id === selectedId)) {
        setSelectedId(null);
        setPaths([]);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadPaths = useCallback(async (projectId: number) => {
    try {
      const res = await authFetch(`/api/projects-v2/${projectId}/paths`);
      if (!res.ok) throw new Error(`paths 失败: ${res.status}`);
      const data = await res.json();
      setPaths(data.paths || []);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { if (isOpen) refresh(); }, [isOpen, refresh]);
  useEffect(() => { if (selectedId) loadPaths(selectedId); }, [selectedId, loadPaths]);

  // ── 操作 helpers ────────────────────────────────────────
  const handleCreate = async () => {
    const name = window.prompt('新项目名:');
    if (!name?.trim()) return;
    const res = await authFetch('/api/projects-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      window.alert(`创建失败: ${e.error || res.status}`);
      return;
    }
    await refresh();
  };

  const handleRename = async (project: ProjectRecord) => {
    const newName = window.prompt(`改名(原 "${project.name}"):`, project.name);
    if (!newName?.trim() || newName === project.name) return;
    const res = await authFetch(`/api/projects-v2/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      window.alert(`改名失败: ${e.error || res.status}`);
      return;
    }
    await refresh();
  };

  const handleDelete = async (project: ProjectRecord) => {
    const cnt = project.stats?.observationCount ?? 0;
    const ok = window.confirm(
      `物理删除项目 "${project.name}" (${cnt} 条 observation 不动,但解绑 project_id)?\n\n警告:不可撤销`
    );
    if (!ok) return;
    const res = await authFetch(`/api/projects-v2/${project.id}`, { method: 'DELETE' });
    if (!res.ok) {
      window.alert(`删除失败: ${res.status}`);
      return;
    }
    setSelectedId(null);
    setPaths([]);
    await refresh();
  };

  // 直接输入路径(input prompt 方式)
  const handleAddPathInput = async (project: ProjectRecord) => {
    const path = window.prompt('登记路径(绝对路径,会自动 realpath 规范化):');
    if (!path?.trim()) return;
    await submitAddPath(project.id, path.trim());
  };

  // 弹窗 picker 选择
  const handleAddPathPicker = (_project: ProjectRecord) => {
    setPickerMode('addPath');
  };

  // 共用提交(给两种入口用)
  const submitAddPath = async (projectId: number, path: string) => {
    const res = await authFetch(`/api/projects-v2/${projectId}/paths`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      window.alert(`登记失败: ${e.error || res.status}`);
      return;
    }
    await loadPaths(projectId);
    await refresh();
  };

  const submitWriteAnchor = async (projectId: number, cwd: string) => {
    const res = await authFetch(`/api/projects-v2/${projectId}/anchor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      window.alert(`写锚点失败: ${e.error || res.status}`);
      return;
    }
    const data = await res.json();
    window.alert(`已写锚点: ${data.anchorPath}`);
    await refresh();
  };

  const handleRemovePath = async (pathId: number) => {
    if (!window.confirm('移除该路径登记?(observations 不动)')) return;
    const res = await authFetch(`/api/projects-v2/${selectedId}/paths/${pathId}`, { method: 'DELETE' });
    if (!res.ok) { window.alert(`移除失败: ${res.status}`); return; }
    if (selectedId) await loadPaths(selectedId);
    await refresh();
  };

  const handleMerge = async (project: ProjectRecord) => {
    const targets = projects.filter(p => p.id !== project.id);
    if (targets.length === 0) { window.alert('没有可合并的目标项目'); return; }
    const list = targets.map((p, i) => `${i + 1}. ${p.name} (${p.stats?.observationCount ?? 0} obs)`).join('\n');
    const choice = window.prompt(`合并 "${project.name}" 到哪个项目?(输入编号)\n\n${list}`);
    if (!choice) return;
    const idx = parseInt(choice.trim(), 10) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= targets.length) {
      window.alert('编号无效'); return;
    }
    const target = targets[idx];
    if (!window.confirm(`确认: 把 "${project.name}" 全部 observations + paths 合并到 "${target.name}"?\n\n合并后原项目会被删除,不可撤销。`)) return;
    const res = await authFetch(`/api/projects-v2/${project.id}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: target.id }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      window.alert(`合并失败: ${e.error || res.status}`);
      return;
    }
    const data = await res.json();
    window.alert(`合并完成: 移动 ${data.result.observationsMoved} 条 obs / ${data.result.summariesMoved} 条 summary / ${data.result.pathsMoved} 条 path`);
    setSelectedId(target.id);
    await refresh();
  };

  // 写锚点:直接输入 cwd(input prompt 方式)
  const handleWriteAnchorInput = async (project: ProjectRecord) => {
    const cwd = window.prompt('在哪个目录写 .claude-mem 锚点文件?(绝对路径)');
    if (!cwd?.trim()) return;
    await submitWriteAnchor(project.id, cwd.trim());
  };

  // 写锚点:弹窗 picker
  const handleWriteAnchorPicker = (_project: ProjectRecord) => {
    setPickerMode('anchor');
  };

  // picker 回传 path 时分发(读 selectedId 而非 selected,避免 hoisting 冲突)
  const handlePickerPick = async (path: string) => {
    const mode = pickerMode;
    setPickerMode(null);
    if (!selectedId) return;
    if (mode === 'addPath') await submitAddPath(selectedId, path);
    else if (mode === 'anchor') await submitWriteAnchor(selectedId, path);
  };

  if (!isOpen) return null;

  const selected = projects.find(p => p.id === selectedId) || null;

  // ── 样式 token(参照 SyncSettingsModal 的 C) ─────────────
  const C = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
    panel: { width: 'min(960px, 92vw)', maxHeight: '88vh', background: 'var(--color-bg-primary, #1a1a1a)', border: '1px solid var(--color-border-primary, #2a2a2a)', borderRadius: 8, display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
    header: { padding: '14px 16px', borderBottom: '1px solid var(--color-border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
    body: { display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1, overflow: 'hidden' } as React.CSSProperties,
    sidebar: { borderRight: '1px solid var(--color-border-primary)', overflowY: 'auto' as const, padding: 8 } as React.CSSProperties,
    detail: { padding: 16, overflowY: 'auto' as const } as React.CSSProperties,
    listItem: (active: boolean) => ({ padding: '10px 12px', cursor: 'pointer', borderRadius: 4, marginBottom: 4, background: active ? 'var(--color-bg-tertiary, rgba(255,255,255,0.06))' : 'transparent', border: '1px solid ' + (active ? 'var(--color-border-secondary, #444)' : 'transparent') } as React.CSSProperties),
    btn: { padding: '6px 12px', fontSize: 12, background: 'transparent', border: '1px solid var(--color-border-primary)', borderRadius: 3, cursor: 'pointer', color: 'var(--color-text-secondary)', marginRight: 6, marginBottom: 4 } as React.CSSProperties,
    btnPrimary: { padding: '6px 12px', fontSize: 12, background: 'var(--color-accent, #2563eb)', border: '1px solid var(--color-accent, #2563eb)', borderRadius: 3, cursor: 'pointer', color: '#fff', marginRight: 6, marginBottom: 4 } as React.CSSProperties,
    btnDanger: { padding: '6px 12px', fontSize: 12, background: 'transparent', border: '1px solid #c0392b', borderRadius: 3, cursor: 'pointer', color: '#c0392b', marginRight: 6, marginBottom: 4 } as React.CSSProperties,
    pathRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--color-border-primary)', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 } as React.CSSProperties,
    chip: { display: 'inline-block', padding: '2px 6px', fontSize: 10, background: 'var(--color-bg-tertiary, rgba(255,255,255,0.06))', border: '1px solid var(--color-border-primary)', borderRadius: 10, color: 'var(--color-text-secondary)', marginRight: 4 } as React.CSSProperties,
  };

  const fmtTime = (epoch: number) => new Date(epoch).toLocaleString();

  return (
    <div style={C.overlay} onClick={onClose}>
      <div style={C.panel} onClick={(e) => e.stopPropagation()}>
        <div style={C.header}>
          <div>
            <strong style={{ fontSize: 16 }}>项目管理</strong>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              共 {projects.length} 个项目
            </span>
          </div>
          <div>
            <button style={C.btnPrimary} onClick={handleCreate}>+ 新建</button>
            <button style={C.btn} onClick={refresh} disabled={loading}>刷新</button>
            <button style={C.btn} onClick={onClose}>关闭</button>
          </div>
        </div>

        {err && (
          <div style={{ padding: 10, background: '#3a1a1a', color: '#ff6b6b', fontSize: 12 }}>{err}</div>
        )}

        <div style={C.body}>
          {/* sidebar: project list */}
          <div style={C.sidebar}>
            {projects.length === 0 && !loading && (
              <div style={{ padding: 16, color: 'var(--color-text-secondary)', fontSize: 12, textAlign: 'center' }}>
                暂无项目。新建或等 worker 收到第一个 observation 时自动建。
              </div>
            )}
            {projects.map(p => (
              <div key={p.id} style={C.listItem(p.id === selectedId)} onClick={() => setSelectedId(p.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13 }}>{p.name}</strong>
                  <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>ID: {p.id}</span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={C.chip}>📝 {p.stats?.observationCount ?? '?'}</span>
                  <span style={C.chip}>📋 {p.stats?.summaryCount ?? '?'}</span>
                  <span style={C.chip}>📁 {p.stats?.pathCount ?? '?'}</span>
                </div>
              </div>
            ))}
          </div>

          {/* detail: selected project */}
          <div style={C.detail}>
            {!selected ? (
              <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', marginTop: 40 }}>
                ← 从左侧选一个项目
              </div>
            ) : (
              <>
                <h2 style={{ marginTop: 0, fontSize: 18 }}>{selected.name}</h2>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                  ID: {selected.id} · 创建于 {fmtTime(selected.created_at)} · 上次更新 {fmtTime(selected.updated_at)}
                </div>

                <div style={{ marginTop: 12, marginBottom: 16 }}>
                  <button style={C.btn} onClick={() => handleRename(selected)}>改名</button>
                  <button style={C.btn} onClick={() => handleAddPathInput(selected)}>+ 路径(输入)</button>
                  <button style={C.btn} onClick={() => handleAddPathPicker(selected)} title="弹窗浏览目录后选择">+ 路径(选择…)</button>
                  <button style={C.btn} onClick={() => handleWriteAnchorInput(selected)}>写锚点(输入)</button>
                  <button style={C.btn} onClick={() => handleWriteAnchorPicker(selected)} title="弹窗浏览目录后选择">写锚点(选择…)</button>
                  <button style={C.btn} onClick={() => handleMerge(selected)}>合并到…</button>
                  <button style={C.btnDanger} onClick={() => handleDelete(selected)}>删除项目</button>
                </div>

                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>登记的路径 ({paths.length}):</div>
                {paths.length === 0 ? (
                  <div style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>(无,点上方"+ 路径"添加)</div>
                ) : (
                  <div style={{ border: '1px solid var(--color-border-primary)', borderRadius: 4 }}>
                    {paths.map(p => (
                      <div key={p.id} style={C.pathRow}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path}</div>
                          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontFamily: 'sans-serif' }}>
                            添加: {fmtTime(p.added_at)} · 上次活跃: {fmtTime(p.last_seen_at)}
                          </div>
                        </div>
                        <button style={C.btnDanger} onClick={() => handleRemovePath(p.id)}>移除</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 24, padding: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border-primary)', borderRadius: 4, fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  💡 <strong>项目识别优先级</strong>(写 observation 时):<br />
                  1. 环境变量 <code>CLAUDE_MEM_PROJECT</code> = id 或 name<br />
                  2. cwd 内 <code>.claude-mem</code> 锚点文件存的 project_id<br />
                  3. cwd 在上方"登记路径"列表里精确匹配<br />
                  4. cwd 父目录最长前缀匹配<br />
                  5. 都没命中 → 按 cwd basename 新建项目并自动登记
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 目录 picker(条件渲染,叠在主 Modal 上)*/}
      {pickerMode !== null && (
        <DirectoryPicker
          initialPath={selected?.anchor_path ?? null}
          onPick={handlePickerPick}
          onCancel={() => setPickerMode(null)}
        />
      )}
    </div>
  );
}
