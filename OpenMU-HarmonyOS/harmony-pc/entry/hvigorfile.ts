import { hapTasks } from '@ohos/hvigor-ohos-plugin';
import * as fs from 'fs';
import * as path from 'path';

// 构建前配对密钥/服务器地址校验。
//
// build-profile.json5 中提交的是占位配对密钥（43 个 A，即实现报告里公开的测试
// 密钥）与开发者内网地址。直接出包会让 .hap 带着弱密钥上线——任何读过本仓库的
// 人都能派生游戏账号并调用 GM API。与安卓版“缺少真实参数即构建失败”的策略
// 对齐：占位值必须显式豁免，否则拒绝构建。
//
// 正式出包：把本文件同级 build-profile.json5 里的 MOBILE_PACKAGE_KEY 换成真实
// 的 43 位 base64url 密钥（与服务端 mobile-server-settings.json 一致）。
// 仅本地联调：设置环境变量 OPENMU_ALLOW_PLACEHOLDER_MOBILE_KEY=1 豁免。
function readBuildProfileFields(): Record<string, string> {
  const profilePath = path.resolve(__dirname, 'build-profile.json5');
  const raw = fs.readFileSync(profilePath, 'utf-8');
  const fields: Record<string, string> = {};
  const pattern = /"(MOBILE_PACKAGE_KEY|DEFAULT_SERVER_ADDRESS)"\s*:\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    fields[match[1]] = match[2];
  }
  return fields;
}

function isLocalOrPrivateAddress(address: string): boolean {
  if (address === 'localhost') {
    return true;
  }
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!parts) {
    // 主机名无法静态判定归属，交给运行期的 ServerAddressPolicy 同类规则处理，
    // 这里只拦截明确的公网 IPv4。
    return true;
  }
  const octets = parts.slice(1, 5).map(Number);
  if (octets.some((value) => value > 255)) {
    return false;
  }
  const [a, b] = octets;
  return a === 127 || a === 10 || (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function validateMobilePairing(): void {
  const fields = readBuildProfileFields();
  const allowPlaceholder = process.env.OPENMU_ALLOW_PLACEHOLDER_MOBILE_KEY === '1';

  const key = fields['MOBILE_PACKAGE_KEY'];
  if (key !== undefined) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
      throw new Error(
        'MOBILE_PACKAGE_KEY 必须是 43 位 base64url 字符（见 entry/build-profile.json5）。');
    }
    if (/^A{43}$/.test(key) && !allowPlaceholder) {
      throw new Error(
        '检测到占位配对密钥（43 个 A）。出包前请在 entry/build-profile.json5 中替换为' +
        '真实的 MobilePackageKey（与服务端 mobile-server-settings.json 相同）；' +
        '仅本地联调可设置 OPENMU_ALLOW_PLACEHOLDER_MOBILE_KEY=1 豁免。');
    }
  }

  const server = fields['DEFAULT_SERVER_ADDRESS'];
  if (server !== undefined && !allowPlaceholder && !isLocalOrPrivateAddress(server)) {
    throw new Error(
      `DEFAULT_SERVER_ADDRESS（${server}）不是本机/内网地址。移动包默认地址仅允许` +
      '私网 IPv4；公网部署必须走 HTTPS 并自行评估配对密钥的传输安全。');
  }
}

validateMobilePairing();

export default {
  system: hapTasks,
  plugins: []
}
