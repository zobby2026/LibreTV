import { NextResponse } from 'next/server';

const DUAL_CONFIG = {
  name: "我的专属精选源",
  version: 2,
  // —— LibreTV 原生识别格式 ——
  sources: [
    { name: "非凡蓝光", url: "http://cj.ffzyapi.com/api.php/provide/vod" },
    { name: "量子高清", url: "https://cj.lziapi.com/api.php/provide/vod" },
    { name: "红牛极速", url: "https://www.hongniuzy2.com/api.php/provide/vod" },
    { name: "索尼影视", url: "https://suoniapi.com/api.php/provide/vod" },
    { name: "卧龙秒播", url: "https://collect.wolongzyw.com/api.php/provide/vod" }
  ],
  liveSources: [
    {
      name: "央视卫视高清",
      url: "https://live.fanmingming.com/tv/m3u/ipv4.m3u",
      epg: "https://live.fanmingming.com/e.xml"
    }
  ],
  // —— TVBox / 猫影视 / MarcoMovie 电视盒子标准格式 ——
  sites: [
    { key: "ffzy", name: "非凡蓝光", type: 1, api: "http://cj.ffzyapi.com/api.php/provide/vod", searchable: 1, quickSearch: 1, filterable: 1 },
    { key: "lzzy", name: "量子高清", type: 1, api: "https://cj.lziapi.com/api.php/provide/vod", searchable: 1, quickSearch: 1, filterable: 1 },
    { key: "hnzy", name: "红牛极速", type: 1, api: "https://www.hongniuzy2.com/api.php/provide/vod", searchable: 1, quickSearch: 1, filterable: 1 },
    { key: "snzy", name: "索尼影视", type: 1, api: "https://suoniapi.com/api.php/provide/vod", searchable: 1, quickSearch: 1, filterable: 1 },
    { key: "wlzy", name: "卧龙秒播", type: 1, api: "https://collect.wolongzyw.com/api.php/provide/vod", searchable: 1, quickSearch: 1, filterable: 1 }
  ],
  lives: [
    {
      name: "央视卫视",
      type: 0,
      url: "https://live.fanmingming.com/tv/m3u/ipv4.m3u",
      epg: "https://live.fanmingming.com/e.xml"
    }
  ]
};

export async function GET() {
  return NextResponse.json(DUAL_CONFIG, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
    },
  });
}
