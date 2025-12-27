# 知乎收藏夹导出 Markdown（Chrome 扩展）

这是一个 **Chrome 扩展（Manifest V3）**，用于将知乎收藏夹中的内容批量导出为 **Markdown 文件**，便于本地归档、Obsidian/Typora 阅读、二次整理。推荐采用Obsidian。
<img width="74" height="72" alt="Snipaste_2025-12-27_15-05-46" src="https://github.com/user-attachments/assets/23ca6849-ee40-44f7-b7f7-9a1385472d4d" />

## 功能特点

- **导出单个收藏夹**：在 `https://www.zhihu.com/collection/<id>` 页面一键导出
- **导出某个用户的全部收藏夹**：在 `https://www.zhihu.com/people/<token>/collections` 页面一键导出
- **Markdown 结构清晰**：
  - 每篇内容单独生成一个 `.md`
  - 自动附带 YAML Front Matter（`title / author / source / exported_at`）
  - 代码块导出为 fenced code（已处理“代码内含 ``` 导致错位/吞行”的情况）
- **尽量清理噪音区域**：移除部分推荐阅读/互动区等非正文模块（规则在脚本里可继续扩展）

## 运行环境

- **Chrome / Edge**（Chromium 内核），支持加载解压的扩展（开发者模式）
- 需要登录知乎（导出依赖已登录态请求收藏夹 API）

## 安装（加载扩展）

1. 打开 `chrome://extensions/`（或 Edge 的 `edge://extensions/`）
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目目录 `04_zhihu_fav_exporter`

> 之后浏览器工具栏会出现扩展图标，点击即可打开导出面板。

## 使用方法

### 导出当前收藏夹

1. 打开某个收藏夹页面，例如：`https://www.zhihu.com/collection/123456789`
2. 点击扩展图标，设置：
   - **delay**：每篇导出之间的延迟（毫秒），默认 `1200`
   - **limit**：单个收藏夹最多导出多少条，默认 `200`
3. 点击 **导出当前收藏夹**
4. 浏览器会自动下载一个目录结构下的多个 `.md` 文件

### 导出某用户的全部收藏夹

1. 打开用户收藏夹列表页，例如：`https://www.zhihu.com/people/<token>/collections`
2. 点击扩展图标，设置 `delay / limit`
3. 点击 **导出全部收藏夹**

## 导出文件说明

- **文件名**：`标题 - 作者.md`（自动做了 Windows 兼容的文件名清洗）
- **内容结构**：
  - YAML Front Matter
  - 标题/作者/链接等信息
  - 正文内容（含图片/代码块/列表等）

## 参数建议

- **delay（默认 1200ms）**：
  - 如果遇到导出失败较多，可以调大到 `1500~2500`
- **limit（默认 200）**：
  - 用于控制单次导出量，避免一次拉取过多导致超时或被风控

## 常见问题（FAQ）

### 1. 点了导出但没有下载？

- 确认浏览器已允许该站点下载多个文件（Chrome 通常会提示“是否允许多个文件下载”）
- 确认已登录知乎
- 试着把 `delay` 调大

### 2. 导出的 Markdown 代码块显示错乱？

项目已对代码块做了专门处理：

- **代码内容里包含 ```** 时，会自动使用更长的 fence（例如 ````）避免提前闭合
- 同时避免出现 ` ```紧贴正文` 这种导致 Markdown 把正文当作语言标识的情况

如果你仍遇到特定页面异常，欢迎提供：
- 原知乎链接
- 导出后 `.md` 中异常代码块前后各 10 行内容

### 3. 图片为什么不是本地文件？

当前实现会把图片转成 HTML `<img ... width="800">` 并保留在线链接，方便在大部分 Markdown 渲染器中直接显示。
如需“下载图片并改成本地相对路径”，可以在此基础上扩展下载逻辑（欢迎提需求）。

## 项目结构（简述）

- `manifest.json`：扩展清单（MV3）
- `background.js`：后台 Service Worker，负责调用知乎 API、打开隐藏标签页、触发导出与下载
- `content_context.js`：识别当前页面上下文（用户收藏列表页 / 收藏夹页）
- `content_extract.js`：在页面内提取正文并转换为 Markdown
- `turndown-lite.js`：HTML → Markdown 的核心转换逻辑（含代码块等规则）
- `popup.html / popup.js / popup.css`：扩展弹窗 UI

## 免责声明

本项目仅用于个人学习与内容整理。请遵守知乎相关条款与当地法律法规，勿用于任何侵犯他人权益的用途。


