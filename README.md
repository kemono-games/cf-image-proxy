# CF Image Proxy

一个基于 Cloudflare Workers 的图片代理服务，支持图片压缩、格式转换和尺寸调整。

## 功能特性

- 图片压缩和优化
- 自动格式转换（支持 JPEG、PNG、WebP）
- 图片尺寸调整
- 智能缓存
- 支持多个图片源适配器

## 技术栈

- Cloudflare Workers
- Hono (Web Framework)
- @jsquash (图片处理库)
- TypeScript

## 安装

```bash
# 安装依赖
pnpm install
```

## 开发

```bash
# 启动开发服务器
pnpm dev
```

## 部署

```bash
# 部署到 Cloudflare Workers
pnpm deploy
```

## 使用方法

### 基本用法

```
GET /?url=<图片URL>&w=<宽度>&q=<质量>
```

参数说明：
- `url`: 原始图片的 URL（必需）
- `w`: 目标宽度（可选，默认 200）
- `q`: 图片质量（可选，默认 65）

### 示例

```
https://your-worker.workers.dev/?url=https://example.com/image.jpg&w=800&q=80
```

## 配置

在 `wrangler.toml` 中配置允许的图片源域名：

```toml
[vars]
ALLOW_OTHER_HOSTS = "img.srkyxk.com,img.kemono.games"
```

### 特定 URL 黑名单

在 `src/config/blocklist.ts` 中填写需要禁止的原始图片 URL，然后重新部署：

```ts
export const BLOCKED_URLS: readonly string[] = [
  'https://img.example.com/image.jpg',
  'https://img.example.com/another.jpg?version=1',
]
```

- 填写图片源地址，不是本站的 `/?url=...` 代理地址；清空数组即可取消所有 URL 封禁。
- 对 `url` 参数进行 URL 标准化后精确匹配：忽略 `#fragment`，域名大小写和默认端口由 URL 解析器统一；路径大小写、查询参数及其顺序仍参与匹配。
- 不匹配整个域名或路径前缀。不同的源 URL（包括适配器改写地址和重定向入口）需要分别列出。
- 命中后返回 `403` 和 `Cache-Control: no-store`，不读取 L1/R2 缓存，也不请求上游。同一个源 URL 的所有 `w`、`q` 和输出格式均被禁止。
- 仅接受 HTTP/HTTPS 图片 URL；无效 URL 返回 `400`。
- 黑名单无法撤回浏览器已经缓存的图片；非 Pixiv 图片的浏览器缓存时间为一年，Pixiv 的策略见下文。

## Pixiv 图片审核

当前通过 `PIXIV_MODERATION_ENABLED = "false"` 暂时关闭审核：跳过审核 KV 和阿里云调用，直接进入图片缓存及代理流程；手动 URL 黑名单继续生效。
恢复时将 `wrangler.toml` 中该值改为 `"true"` 并部署。仅显式设置 `"false"` 才关闭审核；关闭期间继续保留 Pixiv 的 `private, no-store` 浏览器缓存策略，便于恢复审核。
以下为启用审核时的行为。

仅 `pximg.net` 及其子域名调用阿里云 `ImageModeration`，Bilibili 和其他图片源保持原有流程。
审核在 L1/R2 图片缓存读取之前执行，手动 URL 黑名单仍优先处理。
唯一免审地址为 `https://s.pximg.net/common/images/no_profile.png`（Pixiv 官方默认头像），
按完整 URL 精确匹配，不免审其他路径、主机或带查询参数的变体。该图片直接进入正常图片缓存及代理流程，不访问审核 KV 或阿里云。

KV 未命中时，Worker 直接下载 pximg CDN 的固定 `/c/600x1200_90/` 缩略图，
通过 `DescribeUploadToken` 获取内容安全服务的临时 OSS 上传凭据，将 JPEG 缩略图原样上传，
再使用 `ossBucketName` 和 `ossObjectName` 调用审核。该流程不需要自行创建 OSS 桶，
如果 CDN 返回 PNG，则使用现有 WASM 编解码器保持尺寸、透明区域铺白，以固定质量 90 转成 JPEG 后上传；不在 Worker 中缩放审核图。
插画的 `img-original` / `img-square` 会统一到 `img-master`，小说封面统一到 `novel-cover-master`。
缩略图下载、格式校验或上传失败时返回 503，不回退下载或上传原图；下载和上传均限制 5 MiB；PNG 解码前限制最多 720,000 像素。
其他 pximg 路径也仅尝试固定 CDN 缩略规格，不保证所有旧路径都支持。

- 规则：`postImageCheckByVL_global_01`，默认地域 `ap-southeast-1`，须与阿里云控制台中规则所属地域一致。
- 判定：任一返回标签的数值型 `Confidence > 80` 即拦截（403）；等于 80 不拦截。
  不按 `RiskLevel` 放行或拦截，不对标签设置例外；因此 `nonLabel_lib` 等免审图库标签若返回大于 80 的分数也会拦截。
  官方允许部分标签省略分数或返回 `null`，这些标签不触发分数阈值。
- 缓存：通过和拦截结果均保存在 `PIXIV_MODERATION` KV，TTL 为 180 天（15,552,000 秒，按固定天数近似六个月），命中不续期。
  Key 包含 `v2`、固定审核图规格版本、地域、规则名及规范化缩略 URL 的 SHA-256。
  不同代理请求 `w/q/format` 和源地址 `/c/尺寸_质量/` 规格共享审核结果；不删除源地址中可能影响内容的查询参数。
  展示图片的 L1/R2 缓存仍按尺寸、质量和格式区分。
  缓存记录保留标签及分数、RequestId、审核时间。更改规则内容但保持规则名时，应清除对应记录或提升代码中的 `v2` 版本。
- 失败：审核超时、业务错误、格式异常、KV 故障返回 503，不将接口失败保存为成功审核结果。
- Pixiv 对浏览器返回 `private, no-store`，内部 L1/R2 仍缓存图片；其他源的缓存策略不变。
  已经下发的一年浏览器缓存无法撤回，业务端需要更换代理请求 URL 的版本参数才能让这些旧请求重新经过 Worker。
- URL 相同而图片内容变化时，已有审核结果仍会复用到过期。KV 最终一致性也可能导致并发重复审核，不能作为全局锁。

上线前配置：

1. `wrangler.toml` 已配置现有项目账号和 `PIXIV_MODERATION` KV namespace；迁移到其他账号时，执行 `pnpm exec wrangler kv namespace create PIXIV_MODERATION` 并更新账号及 namespace ID。
2. 确认阿里云账号已开通服务，RAM AccessKey 有审核权限，且指定地域存在上述规则。
3. 分别使用交互命令 `pnpm exec wrangler secret put ALIYUN_ACCESS_KEY_ID` 和
   `pnpm exec wrangler secret put ALIYUN_ACCESS_KEY_SECRET` 设置密钥，不写入源码或普通 vars。
4. 本地开发可将相同名称配置在已被 Git 忽略的 `.dev.vars`，KV 默认使用本地模拟。

验证：Node.js 22.18+ 或 24 下执行 `pnpm test`；部署构建检查使用 `pnpm exec wrangler deploy --dry-run`。
测试使用模拟凭据和接口，不产生真实审核调用。仅 dry-run 不能验证线上 KV ID 或阿里云授权。

## 许可证

MIT
