'use client';

import { useEffect, useState } from 'react';
import { useToast } from './toast';

interface AiConfigStatus {
  enabled: boolean;
  source: 'kv' | 'env' | 'none';
  baseUrl: string;
  model: string;
  maskedKey: string;
}

export function AiConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<AiConfigStatus | null>(null);

  const [provider, setProvider] = useState<'deepseek' | 'github' | 'custom'>('deepseek');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1');
  const [model, setModel] = useState('deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      if (!res.ok) throw new Error('获取配置失败');
      const data = (await res.json()) as AiConfigStatus;
      setStatus(data);
      if (data.baseUrl) setBaseUrl(data.baseUrl);
      if (data.model) setModel(data.model);
      if (data.baseUrl.includes('models.github.ai')) setProvider('github');
      else if (data.baseUrl.includes('api.deepseek.com')) setProvider('deepseek');
      else setProvider('custom');
    } catch {
      /* 忽略 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void fetchStatus();
  }, [open]);

  const selectProvider = (p: 'deepseek' | 'github' | 'custom') => {
    setProvider(p);
    if (p === 'deepseek') {
      setBaseUrl('https://api.deepseek.com/v1');
      setModel('deepseek-chat');
    } else if (p === 'github') {
      setBaseUrl('https://models.github.ai/inference');
      setModel('openai/gpt-4o-mini');
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          model,
          apiKey: apiKey.trim(),
          testOnly: true,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || '连通失败');
      toast(data.message || '大模型连通测试成功！', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '连接测试失败', 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiKey: apiKey.trim(),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || '保存失败');
      toast(data.message || 'AI 配置已保存！', 'success');
      setApiKey('');
      await fetchStatus();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm lg:items-center lg:p-4"
      onClick={onClose}
    >
      <div
        className="glass w-full max-w-md rounded-t-3xl border-b-0 bg-[#0d0f14]/95 p-5 shadow-2xl lg:rounded-3xl lg:border-b"
        style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 lg:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <h3 className="font-serif text-base font-bold text-[#f3efe6]">AI 策展大模型配置</h3>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-white/50 hover:text-white">
            关闭
          </button>
        </div>

        {/* 当前状态指示 */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs">
          <div>
            <div className="flex items-center gap-1.5 font-medium">
              <span
                className={`h-2 w-2 rounded-full ${
                  status?.enabled ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-amber-400'
                }`}
              />
              <span>{status?.enabled ? 'AI 大模型已接入' : '未连接大模型（走本地精选）'}</span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-white/45">
              {status?.enabled
                ? `${status.model} · ${status.source === 'kv' ? '前台自定义配置' : '环境变量'}`
                : '配置后，每次搜片将由大模型生成独一无二的影展'}
            </div>
          </div>
          {status?.maskedKey && (
            <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/70">
              {status.maskedKey}
            </span>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-3.5 text-xs">
          {/* 快捷平台切换 */}
          <div>
            <label className="mb-1.5 block font-medium text-white/70">选择大模型平台</label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => selectProvider('deepseek')}
                className={`rounded-xl border py-2 text-center transition ${
                  provider === 'deepseek'
                    ? 'border-amber-400/50 bg-amber-400/15 font-semibold text-amber-300'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                DeepSeek
              </button>
              <button
                type="button"
                onClick={() => selectProvider('github')}
                className={`rounded-xl border py-2 text-center transition ${
                  provider === 'github'
                    ? 'border-amber-400/50 bg-amber-400/15 font-semibold text-amber-300'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                GitHub Models
              </button>
              <button
                type="button"
                onClick={() => selectProvider('custom')}
                className={`rounded-xl border py-2 text-center transition ${
                  provider === 'custom'
                    ? 'border-amber-400/50 bg-amber-400/15 font-semibold text-amber-300'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                自定义兼容
              </button>
            </div>
          </div>

          {/* 接口 Base URL */}
          <div>
            <label className="mb-1 block font-medium text-white/70">API Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              required
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white focus:border-amber-400/60 focus:outline-none"
            />
          </div>

          {/* 模型名 */}
          <div>
            <label className="mb-1 block font-medium text-white/70">Model 模型名</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-chat 或 openai/gpt-4o-mini"
              required
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white focus:border-amber-400/60 focus:outline-none"
            />
          </div>

          {/* API Key */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="font-medium text-white/70">API Key / Token</label>
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="font-mono text-[10px] text-white/40 hover:text-white"
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={status?.maskedKey ? `留空保持使用 (${status.maskedKey})` : '填写 sk- 或 ghp_ 密钥'}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white focus:border-amber-400/60 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-white/40">
              {provider === 'deepseek'
                ? '在 deepseek.com 申请 sk-... 格式密钥，极便宜且中文文学策展效果最佳。'
                : provider === 'github'
                ? '在 GitHub Settings ➔ Developer settings 生成含 models:read 权限的 Token。'
                : '任何兼容 OpenAI /chat/completions 格式的接口与 Key。'}
            </p>
          </div>

          {/* 操作按钮组 */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              disabled={testing || (!apiKey.trim() && !status?.enabled)}
              onClick={testConnection}
              className="flex-1 rounded-xl border border-white/15 bg-white/10 py-2.5 font-medium text-white/90 hover:bg-white/15 disabled:opacity-40"
            >
              {testing ? '正在测试连接…' : '测试连通性'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl py-2.5 font-semibold text-[#08090b] shadow-lg active:scale-95 disabled:opacity-40"
              style={{ background: 'var(--a, #dba64a)' }}
            >
              {saving ? '保存中…' : '保存并全站生效'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
