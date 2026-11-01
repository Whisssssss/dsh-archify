# @whisssssss/dsh-archify

DeepSeek Harness 的社区 Skill 移植包（Archify），把
[`tt-a1i/archify`](https://github.com/tt-a1i/archify) 的 Archify Skill 以
DSH 插件形提供：一个 `archify-plugin` 文件系统 Skill 提供者，暴露
**Archify 3.2.0**（架构图、流程图、时序图、数据流图、生命周期图、ERD、类图、
树图、时间线、瀑布图与一页式讲解）。

本包不是官方 DeepSeek 产品，也不代表 DeepSeek 认可。

> **这个分支是构建产物，请勿手改。** 内容由
> `Whisssssss/dsh-archify` 的 `main` 分支通过
> `integrations/deepseek-harness/scripts/sync-branch.mjs` 生成并强制覆盖。
> 要修改请改 `main`，再重新同步。

## 安装

```bash
dsh plugin --profile web add 'github:Whisssssss/dsh-archify#dsh'
```

推荐固定到某个 commit（升级行为可预测）：

```bash
dsh plugin --profile web add 'github:Whisssssss/dsh-archify#<commit-sha>'
```

包内**没有** `prepare`/`install` 生命周期脚本：Skill 文件已随分支提交，
安装不需要 pnpm 的 `allowBuilds` 放行。

## 升级

```bash
dsh plugin --profile web add 'github:Whisssssss/dsh-archify#<new-commit-sha>'
```

同一 specifier 的 git 依赖可能被 pnpm 缓存，换新内容时请改 `#<sha>`
或先执行 `pnpm update`。更新 DSH 本身不会更新本插件；更新 `main` 也不会。

## 卸载

```bash
dsh plugin --profile web remove @whisssssss/dsh-archify
```

## 兼容范围

- 目标验收宿主：**`@deepseek-ai/dsh@0.2.1-rc.5`**；声明支持的宿主范围
  为 **`>=0.2.0-rc.2`**。
- Node.js：`^22.19.0 || >=24.0.0`。
- 未声明 `peerDependencies`：避免 pnpm 在 `autoInstallPeers` 下把整份 DSH
  CLI 装进 profile。兼容性由宿主自身的 bundle/patch 机制与本文档记录保证。
- 其他宿主版本、Electron Desktop 与运行中更新未在本轮验收范围内。

## 冲突与优先级

- 本包注册的 Skill provider 名为 `archify-plugin`，patch 行 id 为
  `archify-skill-filesystem`。**不要**同时安装官方
  `@tt-a1i/archify-dsh`，两者会争用同一位提供者。
- 个人/项目目录里同名的 `archify` Skill 优先级高于本包内置副本。
  插件升级不等于生效 Skill 升级；排查时先确认实际加载的路径与正文。

## 已知限制

- Skill 通过 shell 生成的文件不会自动出现在 Web 端 Produced Files 栏；
  请让 agent 返回规格 JSON 与 HTML 的**精确工作区路径**。
- 本包不提供原生工具、自定义 Web 客户端、遥测、凭据处理或后台服务；
  内置 Skill 含可选的“仅通知”版本检查与品牌资源的有界网络访问。

## 许可

- 适配层：MIT。
- 内置 Archify 3.2.0 Skill：Apache-2.0，并保留历史 MIT 授权与第三方声明。
  见包内 `skills/archify/LICENSE`、`LICENSE-MIT`、`NOTICE`、
  `THIRD_PARTY_NOTICES.md`，以及根目录 `THIRD_PARTY_NOTICES.md`。
- 上游作者：tt-a1i（Archify）与 Cocoon AI。若本包对你有用，也请给
  [上游仓库](https://github.com/tt-a1i/archify) 点个 star。
