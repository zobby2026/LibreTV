/**
 * 品牌字标：金色渐变圆角方块 + 深色 Z。
 *
 * 为什么是「金底深 Z」而不是「深底金 Z」：页头背景在暗色下接近黑、在浅色下是米白，
 * 只有实心金块能在两种主题里都保持同样的辨识度；Z 用深色也顺带满足金底对比度
 * （白字放在 #dba64a 上只有 1.9:1，读不清）。
 *
 * 渐变 id 固定而不用 useId —— 这个组件会被 Server Component（页脚）和
 * Client Component（页头）同时渲染，useId 在 RSC 里不可用；同 id 的渐变定义
 * 重复出现不会出错，浏览器取第一份，且两份内容完全一致。
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="zobby的影视库"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="zm-gold-gradient" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f8e7bf" />
          <stop offset="0.42" stopColor="#dba64a" />
          <stop offset="1" stopColor="#b07d26" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#zm-gold-gradient)" />
      <rect x="0.6" y="0.6" width="30.8" height="30.8" rx="8.5" stroke="#000" strokeOpacity="0.18" strokeWidth="1.2" />
      <path
        d="M10 10.9h12L10 21.1h12"
        stroke="#15100a"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
