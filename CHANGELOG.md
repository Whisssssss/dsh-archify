# @whisssssss/dsh-archify changelog

本包的每个版本都由 `main` 分支的一个不可变 commit 生成；`release.json`
记录源 commit、Skill 版本与验收宿主。

## 1.0.0

- 首个 git 直装版本：以独立孤儿分支 `dsh` 承载构建产物，
  `dsh plugin add 'github:Whisssssss/dsh-archify#dsh'` 即可安装。
- 内置 Archify 3.2.0（源 `main` 的干净暂存，排除 `test/`、`node_modules`
  与开发脚本），保留 Apache-2.0 许可与第三方声明。
- 单一 `archify-plugin` 文件系统 Skill 提供者，`includeDefaultRoots: true`
  （不会吞掉个人/项目 Skill）。无原生工具、无依赖、无安装钩子、无遥测。
- 验收宿主 `@deepseek-ai/dsh@0.2.1-rc.5`；声明支持 `>=0.2.0-rc.2`。
