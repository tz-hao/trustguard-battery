# Go 业务链码

Fabric 入口为 `Execute(commandJSON)` / `Query(queryJSON)`，身份来自 MSP 与证书属性。
领域规则位于 domain，覆盖资产、质检、谱系、放行、交接、生命周期、更正及策略；ledger adapter 提供真实账本历史与状态级背书。
`go test ./...`、`go vet ./...` 用于本地检查；vendor 支持离线链码构建。
当前业务部署为 local `batterybusiness` / `battery` 1.3、sequence 4，保留外部 basic 示例，不将其作为业务验收。
`domain/code.go` 按补充标准正文及第 1 号修改单校验 24 位新产品字段，新登记同时核对来源生产日期；
年份码保留 30 年循环歧义。正式厂商登记保持关闭，详见 [标准核验记录](../docs/standards-gbt34014.md)。
