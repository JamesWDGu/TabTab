# TabTab（中文）

> 自动按域名将浏览器标签页分组 — 智能折叠非活跃分组。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](../LICENSE)
![Chrome](https://img.shields.io/badge/Chrome-93%2B-brightgreen)

[English](../README.md)

TabTab 是一个 Chrome 浏览器扩展，用自动化的规则分组替代手动管理标签。相同域名的标签页会被收集到带标签、带颜色的 Chrome Tab Group 中。当你切换到其他分组（或点击未分组的标签页）时，所有其他分组自动折叠 — 保持标签栏干净、专注。

---

## 目录

- [功能特性](#功能特性)
- [安装](#安装)
- [使用方式](#使用方式)
- [设置项](#设置项)
- [工作原理](#工作原理)
- [项目结构](#项目结构)
- [开发](#开发)
- [开源协议](#开源协议)

---

## 功能特性

- **自动按域名分组** — 同网站标签自动归入同一分组
- **智能自动折叠** — 切换分组时，非活跃分组自动折叠；点击未分组标签，全部分组折叠
- **可配置域名粒度** — 主域名模式（`google.com`）或完整域名模式（`docs.google.com`）
- **字母排序 + 活跃分组置尾** — 分组排在最前面，字母序排列，当前激活的分组排在最右侧
- **主开关** — 关闭立即解散所有分组；打开重新分组
- **自定义分组名称** — 通过弹窗重命名分组，名称持久化
- **标签计数显示** — 分组标题显示标签数量，例如 `github.com(5)`
- **排除域名列表** — 指定不需要自动分组的域名
- **单标签自动解散** — 分组内标签减至 1 个时自动 ungroup，并将其移动到现有分组之后
- **冻结标签容错** — 被 Chrome 冻结/丢弃的标签不会导致分组意外折叠
- **多窗口支持** — 每个窗口独立分组

---

## 安装

### 开发者模式加载

1. 克隆或下载本仓库
2. 打开 Chrome，进入 `chrome://extensions`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `TabTab` 文件夹
5. 工具栏出现扩展图标，点击即可配置

### 环境要求

- Chrome 93+
- 权限：`tabGroups`、`tabs`、`storage`

---

## 使用方式

安装后 TabTab 自动运行：

1. **打开同一域名的多个标签页**（例如多个 Google Docs 页面）
2. 它们会被**自动分组**在一起，带有颜色标签
3. **点击其他分组** — 旧分组折叠，新分組展开
4. **点击未分组标签** — 所有分组折叠，可自由浏览
5. **关闭分组中的标签页** — 当仅剩 1 个时，自动 ungroup 并移至其余分组之后

### 弹窗

点击扩展图标打开设置弹窗：

- 开关主开关
- 修改域名粒度
- 配置自动折叠、排序和标签计数显示
- 添加排除域名
- 添加、编辑、删除自定义分组名称
- 点击 **Save** 应用更改

---

## 设置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| 启用 TabTab | `true` | 主开关 |
| 域名分组 | `main` | `main` = 注册域名（`google.com`）；`full` = 完整主机名（`docs.google.com`） |
| 自动折叠非活跃分组 | `true` | 切换时折叠其他分组 |
| 分组排在最前面 | `true` | 分组按字母序排列在标签栏最前面 |
| 显示标签计数 | `true` | 分组标题显示标签数，如 `github.com(5)` |
| 排除域名 | `[]` | 每行一个域名，支持子域名匹配（`mail.google.com` 匹配 `google.com`） |
| 分组名称 | `{}` | 自定义分组显示名，域名 → 显示名映射 |

所有设置通过 `chrome.storage.local` 持久化，重启浏览器后仍然有效。

---

## 工作原理

### 域名提取

```
docs.google.com → google.com（主域名粒度）
docs.google.com → docs.google.com（完整域名粒度）
www.example.co.uk → example.co.uk（处理复合 TLD）
```

扩展使用已知二级域名（SLD）集合处理复合 TLD（`.co.uk`、`.com.au` 等）。

### 事件流程

```
标签页 URL 变更
  → extractDomain() 提取域名
  → 查找或创建标签分组
  → 分配确定性颜色（DJB2 哈希）
  → 命名分组（自定义名称或域名）
  → 分组排序至前方（活跃分组在末尾）

标签页激活
  → 折叠所有其他分组
  → 展开当前分组
  → 重新排序分组
```

### 颜色分配

通过 DJB2 哈希算法将域名字符串确定性映射到 Chrome 的 9 色调色板：`grey`、`blue`、`red`、`yellow`、`green`、`pink`、`purple`、`cyan`、`orange`。若首选颜色已被占用，选择第一个可用颜色。

### 性能优化

为防止重复 API 调用导致标签栏闪烁：

1. **`sortGroupsInWindow` 合并** — 每个窗口 80ms 去抖。短时间内多次排序请求（来自事件级联）合并为一次执行。
2. **`groupTabByDomain` 提前返回** — 若标签已在正确分组且组外无同域名标签，跳过所有操作。
3. **折叠/展开状态预检** — 调用 API 前先检查分组是否已处于目标状态。
4. **标题更新跳过** — 将计算出的标题与当前标题比较；若未变化则跳过 API 调用。

---

## 项目结构

```
TabTab/
├── manifest.json            # MV3 清单（ES module service worker）
├── background.js            # 事件处理 + 初始化（~180 行）
├── lib/
│   ├── state.js             # 共享内存状态（Map、Set、标志位）
│   ├── domain-utils.js      # 域名提取、颜色哈希、颜色分配
│   ├── storage-utils.js     # 设置 CRUD、域名名称 CRUD
│   └── group-logic.js       # 核心分组、折叠、排序、批量操作
├── popup.html               # 设置弹窗 HTML
├── popup.js                 # 设置弹窗逻辑（ES module）
└── popup.css                # 设置弹窗样式
```

**架构：** ES modules，零循环依赖：

```
state.js ← domain-utils.js, group-logic.js, background.js
domain-utils.js ← group-logic.js
storage-utils.js ← group-logic.js, background.js, popup.js
group-logic.js ← background.js
```

所有文件 ≤ 300 行，所有函数 ≤ 20 行。

---

## 开发

### 加载扩展

1. 进入 `chrome://extensions`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序** → 选择 `TabTab` 目录
4. 修改代码后，点击扩展卡片上的刷新图标

### 调试

- **Service Worker 控制台：** 在 `chrome://extensions` 中点击扩展卡片的 "service worker"
- **弹窗控制台：** 右键点击扩展图标 → 检查
- **chrome://inspect/#service-workers** 查看 service worker 生命周期

### 代码规范

- 服务和弹窗均使用 ES modules（`import`/`export`）
- 函数 ≤ 20 行，文件 ≤ 300 行
- 零循环依赖
- 优先使用 early return 而非嵌套条件
- 遵循单一职责原则

---

## 开源协议

[GNU Affero General Public License v3.0](../LICENSE)

TabTab 是自由软件，你可以重新分发和/或修改它，但必须遵循 AGPL v3 协议。这意味着任何在服务器上运行的修改版本也必须向用户公开其源代码。
