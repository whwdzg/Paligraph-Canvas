# Paligraph Canvas

**灵感，落于笔尖。** A local-first notebook for ink, Markdown and the ideas in between.

[![Deploy to GitHub Pages](https://github.com/whwdzg/Paligraph-Canvas/actions/workflows/deploy.yml/badge.svg)](https://github.com/whwdzg/Paligraph-Canvas/actions/workflows/deploy.yml)
![Version](https://img.shields.io/badge/version-1.0.0-2b7fff)
![License](https://img.shields.io/badge/license-GPL--3.0--or--later-4c1)

Paligraph Canvas 是一个基于 Web 的笔记绘图软件：一张无限画布、一套接近 Apple Notes 的悬浮工具栏、Fluent Design Sun Valley 的材质，以及可选的液态玻璃（liquid glass）质感。它把笔迹数据和 Markdown 都留在这台设备上，并可以在需要时导出为 PDF 或 Markdown。

<p align="center">
  <img src="docs/hero-light.png" alt="Paligraph Canvas 浅色界面" width="92%" />
</p>

| 深色 / 阅读卡片 | 笔刷选项 |
| --- | --- |
| ![深色界面](docs/hero-dark.png) | ![笔刷选项](docs/tool-options.png) |

<p align="center">
  <img src="docs/mobile.png" alt="Paligraph Canvas 移动端" width="280" />
</p>

---

## 功能

### 画布与笔

- 无限画布，世界坐标与视口缩放分离；平移或缩放时不会破坏绘制精度。
- 钢笔、铅笔、蜡笔、毛笔四种笔触，压感会改变线条粗细。
- 荧光笔支持自由绘制与**直线**两种模式，颜色、宽度独立设置。
- 橡皮支持**按笔迹擦**（整条笔画）与**像素擦**（只擦除触及区域），也可以一键清空画布。
- 手写笔适配：Pointer Events 压感、合并事件、手掌防误触、笔杆侧键临时切换为橡皮。
- 双指**长按约 260 ms** 后移动可平移画布，捏合可缩放；快速双指触碰不会误移画布。
- 空格 + 拖动、鼠标中键、触控板滚动都可以移动画布；`Ctrl/⌘ + 滚轮`以指针为中心缩放。

### 选择与编辑

- 套索圈选笔迹，浮动工具条显示已选笔画数量。
- 拖动选区移动；拖动上方圆形手柄旋转；支持按钮旋转 90°。
- 复制、再制、删除、取消选择；`Ctrl/⌘ + C / V` 使用会话剪贴板。
- 撤销 / 重做覆盖绘制、擦除、移动、旋转、复制粘贴与清空画布。
- 对象擦除、像素擦除、撤销历史均为有界操作，不会无限堆积。

### Markdown / Obsidian

- 导入一个或多个 `.md` 文件，或通过浏览器文件夹选择器导入整个 Obsidian 库。
- 支持拖放文件或文件夹。
- 保留 vault 相对路径和小型图片附件；`![[image.png]]`、`[[Note|label]]`、`==highlight==` 与 `> [!tip]` 等 Obsidian 语法会转成可读的阅读卡片。
- 原始 Markdown 无损保留，可在右侧源码抽屉中编辑。
- 每篇导入笔记会变成一张画布笔记：阅读卡片位于世界坐标中，可直接在其上绘图、圈画、批注。
- 一次最多读取 240 篇 Markdown、80 张小图（单图 ≤ 1.6 MB，合计 ≤ 14 MB，单篇 Markdown ≤ 2.5 MB），超出部分会明确提示。
- 不会向 vault 写入任何内容；导入是单向复制。文件只在浏览器本地读取，不上传。

### 导出

- **Markdown**：保留原始 Markdown；如果是带笔迹的笔记，会追加一张以 base64 内嵌的笔迹快照。
- **PDF**：A4 纵向，Markdown 使用系统字体排版后栅格化为页面，解决中文/日文字体嵌入问题；纯笔迹笔记导出笔迹页。
- 导出模块与 jsPDF 只在点击导出时加载，不进入首屏。

### 外观、背景与可访问性

- 浅色 / 深色 / 跟随系统三种主题，切换即时生效。
- 可选液态玻璃材质；关闭后使用实色 Fluent 层，降低 GPU 合成开销。
- 背景支持**空白、网格、圆点、横线**；线条支持实线/虚线；可调间距、透明度、色调。
- 每篇笔记独立背景，也可以把当前背景保存为新笔记默认值。
- 减少动态效果、画布提示、压感灵敏度、防误触均可配置。
- 所有 UI 图标来自 [Microsoft Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)（MIT）。

### 多语言与数据

- 内置简体中文、繁體中文、English、日本語；默认跟随浏览器语言。
- 语言文件为普通 JSON；支持从设置中导入自定义语言包，缺失键回退英语。
- 设置以版本化 `{ version, settings }` JSON 导入/导出，可复制、下载、恢复默认。
- 笔记与笔迹保存在 IndexedDB；设置、语言偏好保存在 localStorage。
- 设置 JSON 不包含笔记内容（这是有意设计，避免把大量笔迹塞进偏好文件）。

---

## 快速开始

要求 **Node.js ≥ 20.19**（CI 使用 Node 22）。

```bash
npm install
npm run dev        # http://localhost:4173
npm run typecheck  # TypeScript
npm test           # Vitest · 31 tests
npm run build      # 生产构建到 dist/
npm run preview    # 预览构建，端口 4173
```

开发服务器与预览服务器都固定使用 `4173`，方便 QA 脚本复用。

### 生产构建与 GitHub Pages

仓库包含 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)：

1. push 到 `main`（或在 Actions 页手动运行 `workflow_dispatch`）。
2. 工作流依次执行 `npm ci` → `typecheck` → `test` → `build`。
3. 构建时注入 `GITHUB_ACTIONS=true`，Vite 自动把 base path 切换为 `/Paligraph-Canvas/`，HTML、图标、manifest、语言文件全部适配项目页子路径。
4. 通过 `actions/configure-pages`（带 `enablement: true`）、`upload-pages-artifact` 和 `deploy-pages` 发布。

首次进入仓库时，请在 **Settings → Pages → Build and deployment** 将 Source 设为 **GitHub Actions**。工作流里的 `enablement: true` 也会尝试在全新仓库上自动启用 Pages。

部署地址：<https://whwdzg.github.io/Paligraph-Canvas/>

本地模拟 Pages 子路径（可选）：

```bash
# 在 Windows PowerShell 中
$env:GITHUB_ACTIONS='true'; npm run build
# 把 dist/ 作为 Paligraph-Canvas/ 子目录放入一个静态服务器根目录
```

---

## 使用说明

### 工具栏

| 工具 | 操作 |
| --- | --- |
| 钢笔 / 荧光笔 / 橡皮 | 点击工具按钮绘制；再次点击已选中的工具打开选项面板 |
| 颜色圆环 | 打开当前工具的配色与尺寸选项 |
| 撤销 / 重做 | 底部工具栏按钮，或 `Ctrl/⌘ + Z`、`Ctrl/⌘ + Shift + Z` |
| 选择 | 套索圈选；拖动选区移动，拖动圆形手柄旋转 |
| 背景按钮（顶栏网格） | 打开当前笔记的背景面板 |
| 导出（顶栏） | PDF 或 Markdown |
| 设置（顶栏） | 外观、画布、语言、数据、关于 |

### 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `P` / `H` / `E` / `L` | 钢笔 / 荧光笔 / 橡皮 / 选择 |
| `Ctrl/⌘ + Z` | 撤销 |
| `Ctrl/⌘ + Shift + Z` 或 `Ctrl/⌘ + Y` | 重做 |
| `Ctrl/⌘ + C` / `V` | 复制 / 粘贴选区 |
| `Ctrl/⌘ + D` | 再制选区 |
| `Delete` / `Backspace` | 删除选区 |
| `0` | 重置视图 |
| `+` / `-` | 放大 / 缩小 |
| `Space + 拖动` | 平移画布 |
| `Ctrl/⌘ + 滚轮` | 以指针为中心缩放 |
| `N` | 新建笔记 |

### 触控与手写笔

- 单指绘制；双指长按约 260 ms 后移动/捏合，进入画布导航。
- 双指快速触碰会被识别为误触，不会移动画布或留下笔迹。
- 手写笔靠近后，触摸会被短时间忽略（手掌防误触可关闭）。
- 手写笔侧键在支持 Pointer Events 的浏览器中会临时切换为按笔迹擦。

---

## 设置 JSON

公共格式来自 [`src/config/default-settings.json`](src/config/default-settings.json)：

```json
{
  "version": 1,
  "settings": {
    "theme": "system",
    "language": "system",
    "liquidGlass": true,
    "penVariant": "pen",
    "penColor": "#1f6feb",
    "penSize": 4,
    "highlighterColor": "#ffd60a",
    "highlighterSize": 22,
    "highlighterMode": "free",
    "eraserMode": "stroke",
    "defaultBackground": {
      "pattern": "grid",
      "lineStyle": "solid",
      "spacing": 32,
      "opacity": 0.14,
      "color": ""
    }
  }
}
```

导入时可以只提供部分字段；未知字段忽略，数值会夹取到安全范围，颜色字段只接受 `#rrggbb`。版本高于当前支持版本会拒绝导入。

## 语言包

在 **设置 → 语言 → 导入语言包** 选择 JSON 文件：

```json
{
  "code": "pt-BR",
  "label": "Português",
  "nativeLabel": "Português (Brasil)",
  "translations": {
    "app.tagline": "Ideias, em tinta.",
    "sidebar.newNote": "Nova nota"
  }
}
```

也可以直接使用扁平的 key/value 字典；文件名会作为语言代码。`code` 必须匹配 `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$`。导入的包保存在 localStorage，缺失键自动回退英语。

内置语言文件在 [`public/locales/`](public/locales/)，欢迎提交新的翻译 PR。

---

## 设计与实现

### 视觉

- **Fluent Design Sun Valley**：Mica 式背景、Fluent 强调色、Acrylic 层级、圆角与克制的阴影。
- **Apple Notes 式工具逻辑**：底部悬浮工具栏、点击工具打开上下文选项、套索后浮动操作条。
- 可选 **liquid glass**：半透明、模糊、饱和度与高光边框；关闭后完全退化为实色 Fluent 表面。
- 侧栏、顶栏、工具条、对话框和提示层共用一套 spacing / radius / shadow token（[`src/styles/tokens.css`](src/styles/tokens.css)）。
- 应用图标为手绘的 “P” 墨迹 + 金色荧光笔 + 珊瑚色笔点，源文件 [`public/icons/icon.svg`](public/icons/icon.svg)，可运行 `npm run icons` 重新生成各尺寸 PNG（需要 Edge/Chrome）。

### 画布架构

`DrawingSurface` 使用四个独立 Canvas 层：

1. **background**：纸张颜色与网格/点阵/横线图案，屏幕空间绘制，保证任意缩放下清晰。
2. **ink**：已提交笔迹；只渲染与视口相交的笔画。
3. **live**：当前笔迹或选择变换预览；只重绘这一层。
4. **overlay**：套索路径、选区边框、旋转手柄。

像素橡皮通过 `destination-out` 合成，作为一条向量擦除笔迹写入文档，因此撤销/重做、导出和重新打开后都能重放。按笔迹擦在指针抬起时一次提交被擦除的笔画集合。所有渲染通过 `requestAnimationFrame` 合并，指针移动期间不写 IndexedDB。

### 性能策略

- 首屏只加载 React、Canvas UI 与应用状态；Markdown 渲染器、Obsidian 扫描器、jsPDF 都是按需 chunk。
- 当前构建首屏 JS gzip 约 **113 KB**（React 69 KB + 应用 31 KB + Fluent 图标 11 KB + 状态 1.4 KB），CSS gzip 约 **12.6 KB**，语言包约 **3–4 KB**；导出模块（jsPDF 约 126 KB gzip）在点击导出后才下载。
- 所有 Canvas 层按 `devicePixelRatio` 渲染，但根据视口面积与设备内存限制像素预算；大屏不会直接使用 2× 全屏位图，避免四层画布把内存放大到不可控。
- 只绘制视口内的笔画；输入点会做最小距离过滤、结束时 RDP 简化，避免存储冗余点。
- 缩略图使用 WebP 矢量重绘，保存时延迟生成；不保存整张画布位图。
- 自动保存有 650–700 ms 防抖；页面隐藏时尽力刷新。
- 液态玻璃可关闭以减少 backdrop-filter 合成开销；`prefers-reduced-motion` 与设置中的“减少动态效果”都会生效。

### 数据与隐私

- 笔记文档保存在 IndexedDB 数据库 `paligraph-canvas` 的 `notes` object store。
- 设置保存在 localStorage 的 `paligraph-settings`（Zustand persist）。
- 语言包保存在 `paligraph-language-packs`。
- 没有任何遥测、账号或云端调用；导入文件不会离开浏览器。
- 清除站点数据会删除本地笔记。设置 JSON 与 Markdown/PDF 导出是当前的迁移手段。

---

## 项目结构

```text
Paligraph-Canvas/
├─ .github/workflows/deploy.yml    GitHub Pages 部署
├─ public/
│  ├─ icons/                       应用图标与 favicon 源文件/PNG
│  ├─ locales/                     内置语言包 + manifest.json
│  └─ manifest.webmanifest         PWA manifest
├─ scripts/                        图标生成、QA、README 截图脚本
├─ src/
│  ├─ components/
│  │  ├─ canvas/DrawingSurface.tsx Canvas 交互与渲染调度
│  │  ├─ editor/                  工具栏、选项、导入、Markdown 源码
│  │  ├─ settings/                设置对话框
│  │  ├─ sidebar/                 笔记库
│  │  └─ common/                  Modal、Switch、Slider 等
│  ├─ config/                     默认设置与色板
│  ├─ hooks/                      笔记持久化、主题、提示
│  ├─ i18n/                       运行时 i18n
│  ├─ lib/                        几何、笔迹、渲染、存储、导出
│  ├─ state/                      Zustand 设置 store
│  └─ styles/                     design tokens 与响应式样式
├─ index.html                     首屏主题/locale 预取 + 静态度量
└─ vite.config.ts                 base path、手动拆包、测试
```

---

## 验证

```bash
npm run typecheck
npm test
npm run build
```

当前验证结果：**31 个单元测试通过**，TypeScript 严格模式无错误，生产构建成功。

浏览器 QA 需要先运行 `npm run preview`，并使用本地 Edge/Chrome：

```bash
npm run qa              # 首次加载与基础 DOM
npm run qa:interactions # 绘图、套索、移动/旋转、设置、导入、PDF
npm run qa:touch        # CDP 双指长按平移、捏合缩放、快速误触
npm run qa:features     # 荧光笔直线、橡皮、复制粘贴、设置 JSON、语言
node scripts/qa-assets.mjs  # Obsidian 附件导入
node scripts/qa-pdf.mjs     # 中文 PDF 导出
```

`playwright-core` 不下载浏览器，而是复用本机已安装的 Edge/Chrome；可通过 `CHROME_PATH` 指定可执行文件。CI 只运行单元测试与构建，不运行浏览器 QA。

---

## 已知限制

- PDF 页面是 Canvas 栅格图，文字不可选中/搜索；这是为了在客户端可靠显示中文、日文而不引入大型字体文件。
- 导入 Markdown 的图片附件会内联为 data URL；单次导入有明确上限。PDF 中 Markdown 图片显示为占位文字，笔迹会输出到单独的“笔迹批注”页。
- 导入的笔记是可编辑的阅读卡片，不是完整的 Obsidian 渲染器：嵌入图谱、Dataview、Canvas 等插件语法不会执行。
- 目前没有云同步、协作或多设备合并；数据属于当前浏览器配置文件。
- “双指长按”是故意设计的防误触机制；首次使用可能需要一两次适应。
- 超大笔记（数千笔迹）在低端移动设备上仍可能需要降低缩放或关闭液态玻璃。DPR 预算会优先保证交互流畅。
- 应用清单已包含 manifest 与安装图标，但未注册 Service Worker，因此不承诺完整离线启动。

---

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

图标来自 Microsoft Fluent UI System Icons（MIT）；应用图标、截图与文稿由本项目创作。
