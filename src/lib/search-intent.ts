/**
 * 区分搜索框输入的两种用户意图：
 * - 'direct'：用户输入正常电影/剧集名（如「庆余年」「沙丘2」「周处除三害」），直接跨源搜片播放
 * - 'ai'：用户输入情绪、氛围、长句描述或点击示范词（如「周二晚上的电子布洛芬轻喜剧」），进入 AI 影展策展
 */

const AI_INTENT_RE =
  /推荐|类似|像[《「"'\s]|一样|适合|想看|有没有|什么|几部|片单|高分|冷门|私藏|下饭|解压|反转|烧脑|治愈|周末|深夜|晚安|\bemo\b|风格|氛围|催泪|搞笑|放空|电子布洛芬|停不下来|后劲|好看的|求一部|找一部|求片/i;

const SENTENCE_PUNCT_RE = /[？?！!。，,；;]/;

/** 去掉包裹整个词条的书名号或引号，提取纯净片名 */
export function normalizeDirectTitle(raw: string): string {
  const s = raw.trim();
  if (/^[《「"'].+[》」"']$/.test(s)) {
    return s.slice(1, -1).trim();
  }
  return s;
}

export function classifySearchIntent(
  raw: string,
  catalogTitles?: ReadonlySet<string>
): 'direct' | 'ai' {
  const trimmed = raw.trim();
  if (!trimmed) return 'ai';

  // 若包含明显的自然语言找片或情绪词，即便是短语也优先走 AI 影展
  if (AI_INTENT_RE.test(trimmed)) return 'ai';

  // 精确命中片库片名（不含上面的找同款词），直接直搜
  const cleanTitle = normalizeDirectTitle(trimmed);
  if (catalogTitles && (catalogTitles.has(cleanTitle) || catalogTitles.has(cleanTitle.toLowerCase()))) {
    return 'direct';
  }

  // 包含问句/逗号等句子标点，或超过 16 字的长句子，交给 AI 理解
  if (SENTENCE_PUNCT_RE.test(trimmed)) return 'ai';
  if (trimmed.split(/\s+/).filter(Boolean).length >= 3 && trimmed.length > 12) return 'ai';
  if (trimmed.length > 16) return 'ai';

  return 'direct';
}
