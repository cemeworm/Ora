---
name: opencli
description: >-
  将任意网站变成确定性 CLI 命令。100+ 站点适配器开箱即用（B站、知乎、小红书、Twitter、Reddit、HackerNews 等），
  支持浏览器自动化（导航、点击、输入、提取、截图），可复用 Chrome 登录态。
  零 LLM 成本，确定性输出，可管道、可脚本。
trigger on: 查网页, 抓取, 搜索, 提取内容, 看热榜, 浏览器自动化, 网页截图, opencli, bilibili, zhihu, xiaohongshu,
  twitter, reddit, hackernews, 知乎, 小红书, 微博, B站, github, npm, 热搜, 商品搜索
---

# OpenCLI — 网站即 CLI

通过 `opencli` 命令直接与网站交互，复用 Chrome 登录态，确定性输出。

## 前置条件

- 已全局安装：`npm install -g @jackwener/opencli`
- 已在 Chrome 安装 [OpenCLI Browser Bridge 扩展](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)
- 验证环境：`opencli doctor`

## 模式 1：站点适配器

命令结构：`opencli <site> <command> [options]`

```bash
# 查看所有可用命令
opencli list

# 热点/热搜
opencli bilibili hot --limit 10        # B站热门
opencli zhihu hot --limit 10           # 知乎热榜
opencli weibo hot --limit 10           # 微博热搜
opencli xiaohongshu hot --limit 10     # 小红书热门
opencli hackernews top --limit 10      # HN 头条
opencli reddit hot --limit 10          # Reddit 热门

# 搜索
opencli bilibili search "关键词"
opencli zhihu search "关键词"
opencli xiaohongshu search "关键词"
opencli google search "关键词"
opencli duckduckgo search "关键词"
opencli npm search "包名"

# 详情
opencli github repo owner/repo
opencli npm package "包名"
opencli bilibili video "BVxxx"
```

## 模式 2：浏览器自动化

通过 `opencli browser <session> <command>` 操作任意网页。同一 session 名保持同一个浏览器 tab。

```bash
# 打开页面
opencli browser work open https://example.com

# 获取页面状态（URL、标题、可交互元素索引）
opencli browser work state

# 提取内容为 markdown
opencli browser work extract

# 截图
opencli browser work screenshot /tmp/page.png

# 交互
opencli browser work click 3           # 点击索引为 3 的元素
opencli browser work type 5 "文本"     # 在索引 5 的元素输入
opencli browser work fill "#id" "值"   # CSS 选择器填充

# 等待
opencli browser work wait selector ".loaded"
opencli browser work wait text "Success"

# 执行 JS
opencli browser work eval "document.title"

# 绑定/解绑当前 Chrome tab
opencli browser work bind
opencli browser work unbind

# 关闭 session tab
opencli browser work close
```

## 常用站点速查

| 类别 | 站点 |
|------|------|
| 中文社区 | bilibili, zhihu, xiaohongshu, weibo, douyin, v2ex, tieba, douban, hupu, jike, smzdm |
| 技术社区 | github, hackernews, reddit, producthunt, stackoverflow, devto, lobsters |
| 搜索 | google, duckduckgo, bing, baidu |
| AI | chatgpt, claude, deepseek, gemini, grok, qwen, doubao |
| 学术 | arxiv, pubmed, google-scholar, cnki, dblp, openreview |
| 电商 | amazon, taobao, jd, xianyu, coupang |
| 社交媒体 | twitter, facebook, instagram, linkedin, bluesky, tiktok |
| 视频 | youtube, bilibili, douyin |
| 开发 | npm, pypi, dockerhub, crates, nuget |
| 金融 | bloomberg, yahoo-finance, binance, eastmoney, xueqiu |
| 桌面应用 | cursor, codex, antigravity, chatgpt-app |

完整列表：`opencli list`

## 关键规则

1. **先验证环境**：遇到问题先跑 `opencli doctor`
2. **Session 隔离**：不同任务用不同 session 名
3. **登录态复用**：直接复用 Chrome 的登录状态，无需配置 cookie
4. **确定性输出**：相同命令返回相同 JSON schema，适合脚本和管道
5. **零 token 消耗**：opencli 运行时不需要 LLM，可以放心高频调用
6. **多 Profile**：多 Chrome profile 时用 `--profile <name>` 指定
