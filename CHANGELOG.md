# Changelog

## [0.2.0](https://github.com/cemeworm/Ora/compare/v0.1.0...v0.2.0) (2026-05-09)


### Features

* **desktop:** Trails 调试器增加对比视图与会话 run 列表 ([7c79de9](https://github.com/cemeworm/Ora/commit/7c79de93d93c653bcb045262346b5e42dd0a5644))
* **desktop:** 中文 i18n 翻译系统与 UI 本地化 ([db2f4eb](https://github.com/cemeworm/Ora/commit/db2f4eb6d2e79818e885eab3ee4540dbeac10704))
* **desktop:** 乐观取消响应与会话状态管理优化 ([8edfe82](https://github.com/cemeworm/Ora/commit/8edfe8273fb6ef51d8ae88c55803fedd3349b1f1))
* **desktop:** 新增应用内更新功能 ([0c4b4b2](https://github.com/cemeworm/Ora/commit/0c4b4b2c978480d0d7e01b7dbcca03ab5f8ac6e2))
* **desktop:** 新手引导重构与提供方模型管理 ([cf4a446](https://github.com/cemeworm/Ora/commit/cf4a446372e401c06efcaa0950e69098ff19a514))
* **desktop:** 调试性能计时浮层与关键路径埋点 ([2a6d854](https://github.com/cemeworm/Ora/commit/2a6d8540bb3ec9d4bd13ce86c921800c8b991988))
* **evaluation:** add concurrent execution, cancel/resume, and report generation ([77a32c0](https://github.com/cemeworm/Ora/commit/77a32c0f882e05e6fa5e70582191f0defea1eb5a))
* **runtime:** add memory admission, dreaming, index, journal, observability, and wiki modules ([cb6ac0f](https://github.com/cemeworm/Ora/commit/cb6ac0fea9f5fb410950d0f94242e91fd31aece1))
* **runtime:** cost 模型优化与观测增强 ([0aecd30](https://github.com/cemeworm/Ora/commit/0aecd30ba9ab5f3865db7f6f2faf42672669cbf7))
* **runtime:** DeepSeek 提供方兼容支持 ([403b3b9](https://github.com/cemeworm/Ora/commit/403b3b9a9da9b67612cb60d9111a9d8f18d70b77))
* **runtime:** 支持条件边路由、层级并行执行和节点超时 ([357b3ab](https://github.com/cemeworm/Ora/commit/357b3ab0c2ac6fdd1955692b695581364548091f))
* **runtime:** 支持自迭代候选回滚、验证与 LLM 富化 ([f97b6f8](https://github.com/cemeworm/Ora/commit/f97b6f817c448bc015df9f1e4cc63578bff13028))
* **runtime:** 添加 Langfuse 评估数据集导入导出、评分和提示词获取 ([4709d18](https://github.com/cemeworm/Ora/commit/4709d184d631d7f1af5821d2d9b830ef669748e2))
* **runtime:** 添加自迭代影响评估，支持安全门禁与影响评估双阶段管线 ([7c498c1](https://github.com/cemeworm/Ora/commit/7c498c17d2279b27c53a053ef4fa94852ff11982))
* **shared:** add memory corpus, search, journal, and wiki schemas ([050abd1](https://github.com/cemeworm/Ora/commit/050abd1f1228ec7f729d90d265e95f7abd78d402))


### Bug Fixes

* **runtime:** refactor node skip logic and fix bootstrap session creation ([a29d5f2](https://github.com/cemeworm/Ora/commit/a29d5f28a0fe9e256d674102594bd0f168212926))


### Performance

* **desktop:** sidecar 预热与 cancel 优先级桥接 ([31cf5b6](https://github.com/cemeworm/Ora/commit/31cf5b666416f8ca69a93ee52131bd09667ac10c))
* **runtime:** add lazy session ledger refresh with event-excluded queries ([ac51ade](https://github.com/cemeworm/Ora/commit/ac51ade3b38ed29e8b0cd95686165a3ef8321a83))
* **runtime:** 优化 SQLite session ledger 批量加载与惰性事件加载 ([7af0fd5](https://github.com/cemeworm/Ora/commit/7af0fd53a0c44d4330dddb7837b2e9cacda621bb))


### Refactors

* **desktop:** simplify onboarding flow and update welcome copy ([0e9d2bb](https://github.com/cemeworm/Ora/commit/0e9d2bb617567b01172974631c33991dcc3e2410))
* **shared:** 使协调模式、节点模板和原子 ID 类型可扩展 ([a0e1b69](https://github.com/cemeworm/Ora/commit/a0e1b69ca398ef506c8e8cf1163bd2bce1374331))
