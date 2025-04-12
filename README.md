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
yarn install
```

## 开发

```bash
# 启动开发服务器
yarn dev
```

## 部署

```bash
# 部署到 Cloudflare Workers
yarn deploy
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

## 许可证

MIT
