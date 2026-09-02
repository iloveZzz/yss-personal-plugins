# YSS Personal Plugins

本仓库收录个人维护的 Codex 插件包。每个 `plugins/<plugin-name>/` 目录都是一个可独立加载的插件根目录，包含 `.codex-plugin/plugin.json` 及其技能、脚本。

## 插件列表

| 插件 | 用途 |
| --- | --- |
| `yss-backend-harness` | YSS 后端工程师 Harness：契约、后端切片实现、测试与 Fresh Verification |
| `yss-frontend-engineer` | YSS 前端工程师 Harness：前端切片实现与验证 |
| `yss-product-manager` | YSS 产品经理 Harness：范围、优先级、交互状态与商业约束 |
| `yss-project-manager` | YSS 项目经理 Harness：父 Ticket、风险、交接与实现仓路由 |
| `yss-requirements-manager` | YSS 需求经理 Harness：Discovery、领域语言、需求澄清与 Spec 起草 |
| `yss-test-engineer-harness` | YSS 测试工程师 Harness：测试、缺陷诊断、独立审查与 Fresh Verification |

## 使用

按 Codex 插件加载方式选择某个 `plugins/<plugin-name>/` 目录作为插件根目录。插件的版本和展示元数据以对应目录下的 `.codex-plugin/plugin.json` 为准。

这些插件依赖目标项目中的 YSS 上下文、角色注册表和生命周期资产；使用前请确保目标项目具备相应文件，并遵循插件自身 `SKILL.md` 中的前置检查与边界。
