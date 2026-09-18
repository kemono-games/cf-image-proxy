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
- 黑名单无法撤回浏览器已经缓存的图片；当前图片响应的浏览器缓存时间为一年。

## 许可证

MIT
