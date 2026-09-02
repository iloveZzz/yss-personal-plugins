# YSS Personal Plugins

本仓库收录个人维护的 YSS 角色 Harness 插件。每个 `plugins/<plugin-name>/` 目录都是一个可独立加载的插件根目录：

- Codex：`.codex-plugin/plugin.json`
- Cursor：`.cursor-plugin/plugin.json`，并由仓库根目录 `.cursor-plugin/marketplace.json` 汇总

插件依赖声明位于 `.yss-plugin/dependencies.yaml`。

## 插件列表

| 插件 | 用途 |
| --- | --- |
| `yss-backend-harness` | YSS 后端工程师 Harness：契约、后端切片实现、测试与 Fresh Verification |
| `yss-frontend-engineer` | YSS 前端工程师 Harness：前端切片实现与验证 |
| `yss-product-manager` | YSS 产品经理 Harness：范围、优先级、交互状态与商业约束 |
| `yss-project-manager` | YSS 项目经理 Harness：父 Ticket、风险、交接与实现仓路由 |
| `yss-requirements-manager` | YSS 需求经理 Harness：Discovery、领域语言、需求澄清与 Spec 起草 |
| `yss-test-engineer-harness` | YSS 测试工程师 Harness：测试、缺陷诊断、独立审查与 Fresh Verification |

## Cursor 使用

本仓库是 Cursor 多插件市场：根目录 `.cursor-plugin/marketplace.json` 列出全部插件，`metadata.pluginRoot` 为 `plugins`。

在 Cursor 中把本仓库添加为插件源后，可按需安装单个角色插件。每个插件仍以 `plugins/<plugin-name>/.cursor-plugin/plugin.json` 为准，技能在 `skills/`，Cursor 命令在 `commands/`。后端插件额外提供 `agents/yss-backend-engineer.md`。

## Codex 使用

按 Codex 插件加载方式选择某个 `plugins/<plugin-name>/` 目录作为插件根目录。Codex 版本和展示元数据以对应目录下的 `.codex-plugin/plugin.json` 为准。

这些插件依赖目标项目中的 YSS 上下文、角色注册表和生命周期资产；使用前请确保目标项目具备相应文件，并遵循插件自身 `SKILL.md` 中的前置检查与边界。

## 技能依赖边界

插件安装会提供 `plugin.json` 声明的角色 Harness skill，但不会把目标项目的共享 YSS skill 复制到项目中。共享 skill 仍由目标项目 `.agents/skills` 维护，并由 `docs/agents/yss-skill-registry.yaml`、`skills-lock.json` 和投影目录共同校验。

`.yss-plugin/dependencies.yaml` 只声明所需的角色契约和最低版本，不复制 `core_skills`。插件在调用前检查目标项目身份、角色契约和技能投影；缺失或漂移时返回 `blocked`，并路由到目标项目技能维护流程。插件不会自动下载、覆盖或写入目标项目技能。
