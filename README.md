# dsh-plugin-strata

一个插件，四件事（合并自独立功能）：

1. **strata 接入 dsh** —— bundle 自带 `cordis.patch.yml`，默认写入 provider `strata`
   （`baseURL: http://127.0.0.1:8080/v1`，模型 id 与 hop 配置键一致）。
2. **模型切换路由控制** —— 工具 `strata_hop`：管理 127.0.0.1:8080 的 strata-hop
   （`status` / `models` / `warm` / `logs`）。路由器源码在 `router/strata-hop.py`
   （含 `/warm`、`/loaded` 端点）与 `router/strata-hop.service`。
3. **切换状态监控** —— 状态服务（默认 :8756，`GET /events`）+ Web GUI 顶部状态芯片 +
   工具 `strata_status`；GUI 里选中 strata 模型即自动 `POST /warm` 预热引擎
   （冷启动发生在第一次请求之前，而不是请求期间）。
4. **运行配置调参（调参）** —— 工具 `strata_params` + GUI 输入区旁的「调参」面板：
   编辑当前加载模型的 strata run-config（`sampling.temperature` / `top_p` / `top_k` /
   `min_p`、思考预算、显存预留、别名表等 16 键），保存进 hop 维护的模型 profile。

对推理**只读**：插件从不发 prompt、不消耗 token。写操作只有三类：`warm`（幂等预热）、
run-config 调参（只改下次启动用的配置）、以及显式的「重启生效」（hop 卸载后带 `force`
重新预热同一模型，同样不发 prompt）。真正的模型切换仍由 dsh 的模型选择器触发。

## 前置条件（一次性，系统侧）

```
strata-hop:  ~/.local/share/strata-hop/strata-hop.py  （本包 router/ 内有同款源码）
配置:        ~/.config/strata/strata-hop.json         （示例见 router/strata-hop.example.json）
密钥:        ~/.config/strata/strata-hop.env          （STRATA_API_KEY）
systemd:     ~/.config/systemd/user/strata-hop.service（本包 router/ 内有同款 unit）
```

## 安装

把本目录加进 profile 的 bundle 链（等价于插件页安装）：

```jsonc
// ~/.dsh/profiles/<profile>/package.json
"dependencies": { "dsh-plugin-strata": "file:/path/to/dsh-plugin-strata" },
"dsh": { "profile": { "bundles": [ …, "dsh-plugin-strata" ] } }
```

然后 `ln -s /path/to/dsh-plugin-strata ~/.dsh/profiles/<profile>/node_modules/`，
重启 dsh。bundle 的 `cordis.patch.yml` 会默认启用插件行和 provider `strata`；
若模型 id 与你的 hop 配置不同，请在 profile 的补丁层覆盖 `llm-pi-ai` 的 `providers.strata`。

## 配置（插件行 config）

| 键 | 默认 | 说明 |
|---|---|---|
| `hopUrl` | `http://127.0.0.1:8080` | strata-hop 地址 |
| `hopConfig` | `~/.config/strata/strata-hop.json` | hop 配置（读 catalog/默认模型） |
| `hopEnvFile` | `~/.config/strata/strata-hop.env` | 读密钥的兜底文件 |
| `apiKeyEnv` | `STRATA_API_KEY` | hop 的鉴权环境变量名 |
| `unit` | `strata-hop.service` | journalctl 跟踪的 systemd user unit |
| `host` / `port` | `127.0.0.1` / `8756` | 状态服务器绑定（GUI 芯片用 LAN 需设 `0.0.0.0`） |
| `followJournal` | `true` | 跟随 hop 日志 |
| `pollSeconds` | `2` | 被动探测间隔 |
| `warmOnSelection` | `true` | 选中模型即预热 |
| `warmProvider` | `strata` | 只预热该 provider 的选择，云端选择不动 |

## 调参（run-config tuning）

调的是 strata serve 的 **run-config**（hop 维护在每个模型 profile JSON 里，hop 会留
`.bak` 备份），不是 dsh 侧的 provider 参数。可调键与 serve 端 `runconfig.py` 的
EDITABLE 表一致（本包 `lib/params.js` 的 `PARAM_SPEC` 是同一份规范的镜像）：
`sampling.temperature/top_p/top_k/min_p`、`reasoning_budget_tokens`、`fit_max_tokens`、
`anthropic_thinking`、`effort_position`、`aliases`、`idle_unload_s`、`mtp`、`lazy_load`、
`engine_silence_s`、`api_monitor`、`open_browser`、`vram_reserve_mib`。

三个入口，同一套校验（全有或全无：一个键非法就整体不写）：

- **GUI**：输入区旁「调参 ▸」按钮 → 面板按键类型渲染控件（数字框 / 开·关·默认下拉 /
  枚举下拉 / 逗号分隔名单）。留空 = 清除该键、回 strata 默认。只提交改动过的键。
- **工具**：`strata_params` —— `action: get` 读当前视图；`action: set` 传
  `set_json: '{"sampling.temperature": 0.6, "mtp": null}'`；`action: restart` 重启生效。
- **HTTP**（monitor :8756）：`GET /params`、`POST /params {"set": {...}}`、
  `POST /restart {"model": ...}`。

语义要点：

- **保存 ≠ 生效**。写入的是该模型 profile 里下次启动用的配置；正在运行的引擎保持旧值。
  要立即生效点「重启生效」（或 `action: restart`）= hop `POST /unload` 后
  `POST /warm {force:true}` 重新拉起同一模型：约 25 秒冷启动，**不发 prompt、不耗 token**。
- **必须先有加载中的模型**才能保存（serve 的 `/config` 由活着的引擎应答）。没加载时
  GUI 显示 profile 的只读内容（`source: "file"`、`writable: false`），先在 dsh 里选中
  strata 模型（会自动预热）再编辑。
- **浏览器不能直连 hop 写**：serve 的 `_own_page` 防护会拒外来 Origin（403），所以 GUI
  一律走 monitor 代理（monitor 用 `~/.config/strata/strata-hop.env` 的密钥访问 hop）。
  不要手改 profile JSON —— hop 是这些文件的属主。
- `restart` 之后 GUI 会轮询 `/events`，就绪后自动刷新面板。

## 测试

```
node tools/smoke.js [--port 8757]     # 独立冒烟：监控 + hop 只读探测 + /params 路由与非法值拒绝，不动引擎
dsh --profile web --dump-config       # 校验 bundle/补丁装配
```

## 发布到插件市场

用官方生成器把本包（npm 发布后，或 git tag）编入市场索引：

```
pnpm --filter @deepseek-ai/dsh-plugin-market-generator start \
  --input plugins.txt --output site/index.json --title "…"
```

把 `index.json` 放到静态可访问（2xx、无重定向）的位置（如 GitHub Pages），
在 dsh Web 插件页 → 实验性插件 → 自定义插件市场里添加该 URL 即可。

## 换到别的机器：通用性注意事项

- **平台**：hop/监控的日志与单元状态依赖 Linux + systemd 用户会话
  （`journalctl --user` / `systemctl --user`）。非 systemd 环境把插件配置
  `followJournal: false`，被动探测与 GUI 芯片仍可用。
- **python3 ≥ 3.8**：`router/strata-hop.py` 只用标准库，无需 pip 依赖。
- **模型 id 对齐（最常见的坑）**：bundle `cordis.patch.yml` 里的两个模型 id
  只是示例，必须与你 hop 配置里 models 的键一致。不一致时在 profile 的
  `cordis.patch.yml` 覆盖 `providers.strata`——注意 provider 条目是
  **整条替换**，非内置目录的条目要写全 `api` / `baseURL` / `models`。
- **状态端口固定 8756**：GUI 芯片按 `http://<GUI 主机名>:8756/events` 连接
  （端口写死在客户端），不要改插件 `port`。要从局域网设备访问 GUI 时，
  把插件 `host` 设为 `0.0.0.0` 并放行防火墙 8756（GUI 端口同理）。
- **systemd unit 占位符**：`router/strata-hop.service` 里的 `/home/USER`
  与 strata 安装路径需按你的机器替换。
