/** AI 影展策展预设文案、配色与类型定义（前后端共用） */

export interface CuratePick {
  t: string;
  y: number;
  w: string;
  /** 展签批注（短句、有画面感） */
  note?: string;
}

export interface CuratorNotes {
  /** 策展词 */
  preface: string;
  /** 观看建议 */
  advice: string;
  /** 今夜片单 */
  lineup: string;
}

export interface CurateMeta {
  festivalTitle: string;
  subtitle: string;
  themeColor: string;
  tags: string[];
  totalCatalog: number;
}

export interface CuratePreset {
  id: string;
  festivalTitle: string;
  subtitle: string;
  themeColor: string;
  tags: string[];
  notes: CuratorNotes;
  annotations: string[];
  withdrawLine: string;
  openingLine: string;
  keywords: string[];
}

export const CURATE_PRESETS: CuratePreset[] = [
  {
    id: 'rain-emo',
    festivalTitle: '雨夜慢光 · 深夜 emo 特展',
    subtitle: '给不想说话的夜晚留一盏小灯',
    themeColor: '#5ea8ff',
    tags: ['克制', '潮湿', '慢'],
    notes: {
      preface: '有些情绪不需要被立刻安慰，只需要在银幕的暗光里被静静接住。',
      advice: '适合一个人，关掉主灯，只留一盏小台灯，把手机翻扣在桌边。',
      lineup: '今夜这几部片子都很慢，但镜头落幕时，心里会多出一块安静的地方。',
    },
    annotations: [
      '适合一个人，开着小灯看完。',
      '台词很少，但每一帧都在替你说话。',
      '别赶进度条，让雨声和留白慢慢落下来。',
      '看到结尾别急着关屏，配乐值得听完。',
      '像一封延迟多年才寄到的晚安信。',
    ],
    withdrawLine: '这部今夜无法放映，已为你撤下。',
    openingLine: '灯暗了，今夜只放你想看的。',
    keywords: ['深夜', 'emo', '孤独', '不想说话', '雨', '治愈', '文艺', '慢', '哭', '难过', '安静', '爵士'],
  },
  {
    id: 'midnight-twist',
    festivalTitle: '暗室反转 · 午夜迷宫特展',
    subtitle: '别相信前二十分钟看到的真相',
    themeColor: '#b28cff',
    tags: ['冷冽', '反转', '精密'],
    notes: {
      preface: '真正的悬念不在血腥与惊吓，而在你以为看透全局时突然抽走的地板。',
      advice: '建议留出完整两小时，别刷弹幕，也别提前搜影评剧透。',
      lineup: '今晚排出的这组作品结构严密，每一处看似随口的细节都在后面回收。',
    },
    annotations: [
      '前二十分钟藏着结局的钥匙。',
      '别看剧透，反转落下的瞬间最值票价。',
      '冷色调里的精密叙事，后劲很长。',
      '适合拉紧窗帘，一口气追到尾声。',
      '看完可能会忍不住倒回去重看开场。',
    ],
    withdrawLine: '这部今夜拷贝暂缺，已为你撤展。',
    openingLine: '放映厅落锁，谜底即将亮灯。',
    keywords: ['烧脑', '反转', '悬疑', '黑镜', '细思极恐', '探案', '推理', '犯罪', '惊悚', '迷宫', '科幻'],
  },
  {
    id: 'weekend-chill',
    festivalTitle: '微醺松弛 · 周末放空特展',
    subtitle: '把白天的紧绷寄存在放映厅门外',
    themeColor: '#f4a261',
    tags: ['轻快', '烟火', '松弛'],
    notes: {
      preface: '不是每场电影都要沉重思考，偶尔也需要一部让人嘴角上扬的轻松好片。',
      advice: '点一份热乎的外卖，窝进沙发最软的角落，怎么舒服怎么看。',
      lineup: '这几部节奏明快、笑点自然，专治一周积攒下来的疲惫和无聊。',
    },
    annotations: [
      '配冰饮或夜宵食用，快乐翻倍。',
      '不费脑，但每一段都刚好戳中笑点。',
      '像和老朋友闲聊，看完浑身轻快。',
      '节奏很爽，开场五分钟就能进入状态。',
      '适合周末彻底放空的电子布洛芬。',
    ],
    withdrawLine: '这部今夜暂未排上档期，已为你撤下。',
    openingLine: '灯光调暖，今夜只管放松。',
    keywords: ['周末', '下饭', '外卖', '喜剧', '搞笑', '爆笑', '解压', '放空', '爽片', '轻松', '午休', '日常'],
  },
  {
    id: 'film-warmth',
    festivalTitle: '胶片余温 · 私藏影迷特展',
    subtitle: '从片库深处为你打捞的一场私人放映',
    themeColor: '#e86f51',
    tags: ['复古', '光影', '余韵'],
    notes: {
      preface: '好电影像老式胶片，哪怕隔着屏幕，依然能感觉到光影穿过空气的温度。',
      advice: '挑一部最合眼缘的先点亮，不用按顺序，今夜的放映权完全交给你。',
      lineup: '这份片单兼顾口碑与氛围感，每一部都值得在安静的夜晚单独留一场。',
    },
    annotations: [
      '光影质感极佳，大屏看更有味道。',
      '私藏片单里的常青树，重看仍有新意。',
      '情绪铺垫很稳，中后段格外动人。',
      '选一个不被打扰的夜晚交给它。',
      '镜头语言干净利落，余味悠长。',
    ],
    withdrawLine: '这部今夜无法放映，已为你撤下。',
    openingLine: '灯暗了，今夜只放你想看的。',
    keywords: ['港风', '复古', '经典', '冷门', '私藏', '高分', '怀旧', '佳片'],
  },
];

export function matchCuratePreset(query: string): CuratePreset {
  const q = query.trim().toLowerCase();
  if (!q) return CURATE_PRESETS[3];

  let best = CURATE_PRESETS[3];
  let bestScore = 0;

  for (const preset of CURATE_PRESETS) {
    let score = 0;
    for (const kw of preset.keywords) {
      if (q.includes(kw.toLowerCase())) {
        score += kw.length >= 2 ? 2 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = preset;
    }
  }

  return best;
}

/** 从用户自然语言里切出 2~4 个可圈亮的关键词，供邀请函票根动画使用 */
export function extractQueryKeywords(query: string, fallbackTags: string[] = []): string[] {
  const clean = query.trim();
  if (!clean) return fallbackTags.slice(0, 3);

  const known = [
    '深夜', '雨夜', '孤独', '不想说话', '治愈', '文艺', '慢节奏', 'emo',
    '烧脑', '反转', '悬疑', '黑镜', '细思极恐', '推理', '科幻',
    '周末', '外卖', '轻喜剧', '喜剧', '下饭', '放空', '解压', '爽片',
    '港风', '复古', '冷门', '高分', '爵士乐', '催泪', '日常',
  ];

  const hits = known.filter((kw) => clean.includes(kw));
  if (hits.length >= 2) return hits.slice(0, 4);

  const chunks = clean
    .split(/[，。、！？\s,./·「」《》()（）]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 8);

  const merged = Array.from(new Set([...hits, ...chunks, ...fallbackTags])).filter(Boolean);
  return merged.slice(0, 4);
}

/** 生成今夜场次时间（从当前时间最近的整点/半点起排，若白天则从 19:30 起排） */
export function buildScreeningTimes(count: number, now = new Date()): string[] {
  const hour = now.getHours();
  let minutes = hour >= 18 && hour < 23
    ? hour * 60 + (now.getMinutes() < 30 ? 30 : 60)
    : 19 * 60 + 30;

  const gaps = [130, 125, 115, 120, 110];
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const wrapped = minutes % (24 * 60);
    const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
    const mm = String(wrapped % 60).padStart(2, '0');
    out.push(`${hh}:${mm}`);
    minutes += gaps[i % gaps.length];
  }
  return out;
}

const EDITION_KEY = 'libretv_festival_edition_v1';

export function getNextEditionNumber(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = Number(localStorage.getItem(EDITION_KEY) || '0');
    const next = Number.isFinite(raw) && raw > 0 ? raw + 1 : 1;
    localStorage.setItem(EDITION_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

export function isValidHexColor(color: unknown): color is string {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim());
}
