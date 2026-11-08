import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 测试环境准备。
 *
 * 用户/邀请码/个人数据都存在文件里，默认落在 `process.cwd()/data`。
 * 跑一次单测就在仓库里留下 users.json、.session-secret 是绝对不能接受的
 * （既污染工作区，也可能把某次测试造的会话密钥带进提交），
 * 所以统一指到临时目录，进程退出时删掉。
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libretv-test-'));
process.env.LIBRETV_DATA_DIR = dir;

process.on('exit', () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 临时目录清不掉不影响测试结果
  }
});
