# TransLit（简体中文）

TransLit 是一个面向学术文献的 Zotero 插件，围绕两条核心流程构建：

1. 使用 DeepSeek 对 PDF 正文进行全文翻译（保存为 Markdown 附件）
2. 使用 MinerU 提取图/表，并在 Zotero 内进行可视化浏览

## 核心功能

- 右键 `翻译全文（DeepSeek）`：
  - 调用 Zotero 内置全文提取
  - 按可配置提示词调用 `deepseek-reasoner`
  - 输出保存为文献附件 `.md`
- 右键 `解析图表资源（MinerU）`：
  - 上传 PDF 到 MinerU
  - 轮询任务状态并下载结果
  - 保存 `zip/summary/manifest/merged-manifest` 附件
- 右键 `查看图表结果（MinerU）`：
  - 按 `f1/f2/.../t1...` 快速切换图表
  - 支持滚轮缩放与拖动查看局部
  - 显示中文图注/表注

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

提示词支持占位符：`{{title}}`、`{{itemKey}}`、`{{content}}`。

## 安全说明

- API 密钥优先存入登录管理器（安全存储）
- 旧版明文偏好会自动迁移并清理

## 仓库地址

- https://github.com/Run-Labs-HQ/TransLit

## 致谢

TransLit 基于开源 Zotero 插件模板构建：

- https://github.com/windingwind/zotero-plugin-template
