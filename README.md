# 知乎收藏夹导出 Markdown（Chrome 扩展）

这是一个 **Chrome 扩展（Manifest V3）**，用于将知乎收藏夹中的内容批量导出为 **Markdown 文件**，便于本地归档、Obsidian/Typora 阅读、二次整理。推荐采用Obsidian。

<img width="74" height="72" alt="Snipaste_2025-12-27_15-05-46" src="https://github.com/user-attachments/assets/23ca6849-ee40-44f7-b7f7-9a1385472d4d" />


## 安装（加载扩展）

1. 打开 `chrome://extensions/`（或 Edge 的 `edge://extensions/`）
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目目录 `zhihu_fav_exporter`文件夹，之后浏览器工具栏会出现扩展图标，点击即可打开导出面板。

## 使用方法

### 导出当前收藏夹

1. 打开某个收藏夹页面，例如：`https://www.zhihu.com/collection/123456789`
2. 点击扩展图标，设置导出范围及下载条数：
3. 点击 **导出当前收藏夹**
4. 浏览器会自动将该收藏夹下的每个回答转为 `.md` 文件并下载至本地下载路径。

### 导出某用户的全部收藏夹

1. 打开用户收藏夹列表页，例如：`https://www.zhihu.com/people/<token>/collections`
2. 点击扩展图标，设置 `limit`（每篇导出间隔固定为 `1000ms`）
3. 点击 **导出全部收藏夹**

## 功能特点

- **导出单个收藏夹**：在 `https://www.zhihu.com/collection/<id>` 页面一键导出
- **导出某个用户的全部收藏夹**：在 `https://www.zhihu.com/people/<token>/collections` 页面一键导出
- **不再打开新标签页**：
  - 后台直接调用知乎 API 拉取 `content`（HTML）
  - 使用 MV3 `offscreen document` 在后台将 HTML 转为 Markdown（全程不创建/关闭 tab）
- **支持类型**：`answer`（回答）、`article`（专栏文章）、`pin`（想法）、`zvideo`（视频，导出为“链接 + 封面 + 描述”）
- **Markdown 结构清晰**：
  - 每篇内容单独生成一个 `.md`
  - 自动附带 YAML Front Matter（`title / author / source / exported_at`）
  - 代码块导出为 fenced code（已处理“代码内含 ``` 导致错位/吞行”的情况）
- **尽量清理噪音区域**：移除部分推荐阅读/互动区等非正文模块（规则在脚本里可继续扩展）

## 运行环境

- **Chrome / Edge**（Chromium 内核），支持加载解压的扩展（开发者模式）
- 需要登录知乎（导出依赖已登录态请求收藏夹 API）

## 导出文件说明

- **文件名**：`标题 - 作者.md`
- **内容结构**：
  - YAML Front Matter
  - 正文内容（含图片/代码块/列表等）

## 参数建议

- **limit（默认 200）**：
  - 用于控制单次导出量，避免一次拉取过多导致超时或被风控

## 常见问题（FAQ）

### 1. 点了导出但没有下载？

- 确认浏览器已允许该站点下载多个文件（Chrome 通常会提示“是否允许多个文件下载”）
- 确认已登录知乎

### 2. 图片为什么不是本地文件？

当前实现会把图片转成 HTML `<img ... width="800">` 并保留在线链接，方便在大部分 Markdown 渲染器中直接显示。
如需“下载图片并改成本地相对路径”，可以在此基础上扩展下载逻辑（欢迎提需求）。

## 项目结构

- `manifest.json`：扩展清单（MV3）
- `background.js`：后台 Service Worker，负责调用知乎 API、触发导出与下载（不再打开隐藏标签页）
- `offscreen.html / offscreen.js`：MV3 Offscreen Document，用于在后台进行 DOM 解析与 HTML→Markdown 转换
- `content_context.js`：识别当前页面上下文（用户收藏列表页 / 收藏夹页）
- `content_extract.js`：在页面内提取正文并转换为 Markdown
- `turndown-lite.js`：HTML → Markdown 的核心转换逻辑（含代码块等规则）
- `popup.html / popup.js / popup.css`：扩展弹窗 UI

## 免责声明

本项目仅用于个人学习与内容整理。请遵守知乎相关条款与当地法律法规，勿用于任何侵犯他人权益的用途。


