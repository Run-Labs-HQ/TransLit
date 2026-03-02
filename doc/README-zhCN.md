# TransLit（简体中文）

TransLit 是一个面向学术文献的 Zotero 插件，围绕两条核心流程构建：

1. 使用 DeepSeek 对 PDF 正文进行全文翻译（保存为 Markdown 附件）
2. 使用 MinerU 提取图/表，并在 Zotero 内进行可视化浏览
3. 一键串联翻译 + 图表解析 + 译文 PDF 导出

## 核心功能

- 右键 `翻译全文（DeepSeek）`：
  - 调用 Zotero 内置全文提取
  - 按可配置提示词调用 `deepseek-reasoner`
  - 输出保存为文献附件 `.md`
- 右键 `解析图表资源（MinerU）`：
  - 上传 PDF 到 MinerU
  - 轮询任务状态并下载结果
  - 保存 `zip/markdown/summary/manifest/merged-manifest` 附件
- 右键 `查看图表结果（MinerU）`：
  - 按 `f1/f2/.../t1...` 快速切换图表
  - 支持滚轮缩放与拖动查看局部
  - 显示中文图注/表注
- 右键 `导出译文 PDF（含图表）`：
  - 正文中图表引用可点击跳转到图注/表注位置
  - 图/表按“图像在上、图注在下”导出
  - 支持公式渲染和目录导航
- 右键 `一键完成（翻译+解析+导出 PDF）`：
  - 自动串联执行上述三步流程

## 安装与开发

```bash
npm install
npm start
```

## 构建与检查

```bash
npm run lint:check
npm run build
npm run test -- --no-watch
```

## 配置项

在 Zotero 的 TransLit 设置中配置：

- DeepSeek API Key
- DeepSeek Base URL
- DeepSeek 提示词模板
- MinerU API Token
- MinerU Base URL
- MinerU Model Version
- Headless 浏览器可执行路径（可选）
- PDF 字体族 / 字号 / 正文占宽 / 首行缩进
- 右键菜单显示开关（默认仅显示一键流程）

提示词支持占位符：`{{title}}`、`{{itemKey}}`、`{{content}}`。

## 版本与更新说明

- 当前版本：`3.2.1`
- 详细更新：项目根目录 `CHANGELOG.md`

## 安全说明

- API 密钥优先存入登录管理器（安全存储）
- 旧版明文偏好会自动迁移并清理

## 仓库地址

- https://github.com/Run-Labs-HQ/TransLit

## 致谢

TransLit 基于开源 Zotero 插件模板构建：

- https://github.com/windingwind/zotero-plugin-template
- DeepSeek（翻译能力支持）：https://platform.deepseek.com/
- MinerU（图表解析能力支持）：https://mineru.net/
