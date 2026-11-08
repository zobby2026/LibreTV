// Workers Builds 看到这个文件和已安装的 @opennextjs/cloudflare 后，
// 会用仓库里的 wrangler.jsonc 部署，而不是现场生成一份不含 KV / 环境变量的配置。
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
