window.__ModuleLoader__.load({
	id: "dsh-plugin-strata",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		const jsx = react_jsx_runtime.jsx;
		const jsxs = react_jsx_runtime.jsxs;
		const useEffect = react.useEffect;
		const useState = react.useState;
		//#region lib/client.js
		const CSS = ".ssm-chip{display:inline-flex;align-items:center;gap:6px;max-width:min(560px,100%);box-sizing:border-box;padding:3px 9px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,#333);background:var(--dsw-alias-fill-l1,#ffffff0d);color:var(--dsw-alias-label-secondary,#888);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;cursor:default;user-select:none}.ssm-chip:hover{background:var(--dsw-alias-fill-l2,#ffffff14)}.ssm-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#888}.ssm-dot[data-phase=ready]{background:var(--dsw-alias-state-success-primary,#4caf50)}.ssm-dot[data-phase=failed]{background:var(--dsw-alias-state-error-primary,#f44336)}.ssm-dot[data-phase=starting],.ssm-dot[data-phase=loading_model],.ssm-dot[data-phase=loading_experts]{background:var(--dsw-alias-state-warning-primary,#ff9800);animation:ssm-pulse 1.1s ease-in-out infinite}@keyframes ssm-pulse{0%,100%{opacity:1}50%{opacity:.35}}.ssm-model{flex:none;font-weight:600;color:var(--dsw-alias-label-primary,#ddd)}.ssm-phase{flex:none}.ssm-text{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#888)}.ssm-open{padding:0 4px;border:0;background:none;color:inherit;cursor:pointer;font-size:11px}.ssm-banner{margin:0 0 6px;padding:6px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-state-warning-primary,#ff9800);background:#ff98001a;color:var(--dsw-alias-label-secondary,#aaa);font-size:12px;line-height:17px;display:flex;gap:8px;align-items:flex-start}.ssm-banner[data-phase=failed]{border-color:var(--dsw-alias-state-error-primary,#f44336);background:#f443361a}.ssm-banner-main{flex:1;min-width:0}.ssm-banner-title{color:var(--dsw-alias-label-primary,#ddd);font-weight:600}.ssm-list{margin:4px 0 0;padding:0 0 0 2px;list-style:none;font-family:var(--dsw-font-mono,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary,#888);max-height:150px;overflow:auto;white-space:normal}.ssm-dismiss{border:0;background:none;color:inherit;cursor:pointer;font-size:14px;line-height:16px;padding:0 2px}.ssm-tune-root{position:relative;display:inline-flex;flex-direction:column;align-items:flex-start;gap:4px}.ssm-tune-btn{padding:4px 11px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,#333);background:var(--dsw-alias-fill-l1,#ffffff0d);color:var(--dsw-alias-label-secondary,#888);font-size:13px;line-height:18px;cursor:pointer}.ssm-tune-btn:hover{background:var(--dsw-alias-fill-l2,#ffffff14);color:var(--dsw-alias-label-primary,#ddd)}.ssm-tune-panel{position:absolute;bottom:calc(100% + 6px);left:0;z-index:40;width:min(640px,94vw);box-sizing:border-box;padding:10px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1,#333);background:var(--dsw-alias-bg-base-solid,#1b1b1b);box-shadow:0 6px 24px #0006;color:var(--dsw-alias-label-secondary,#888);font-size:14px;line-height:20px}.ssm-tune-head{display:flex;gap:6px;align-items:center;margin-bottom:4px}.ssm-tune-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd)}.ssm-tune-tag{font-size:12px;padding:1px 7px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,#333)}.ssm-tune-sec{display:flex;gap:10px;align-items:center;margin:10px 0 4px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l1,#333);font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd)}.ssm-tune-rows{display:flex;flex-direction:column;gap:6px;max-height:32vh;overflow:auto}.ssm-tune-row{display:flex;gap:8px;align-items:center}.ssm-tune-key{flex:1.4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#ddd)}.ssm-tune-id{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);font-family:var(--dsw-font-mono,monospace)}.ssm-tune-row input,.ssm-tune-row select{width:130px;box-sizing:border-box;padding:3px 7px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1,#333);background:var(--dsw-alias-fill-l2,#ffffff14);color:var(--dsw-alias-label-primary,#ddd);font-size:13px}.ssm-tune-row input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}.ssm-tune-hint{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);width:38px}.ssm-tune-note{margin-top:6px;min-height:18px;color:var(--dsw-alias-state-warning-primary,#ff9800);font-size:13px;line-height:18px;white-space:normal}.ssm-tune-actions{display:flex;gap:6px;margin-top:6px}.ssm-tune-act{padding:4px 12px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1,#333);background:var(--dsw-alias-fill-l2,#ffffff14);color:var(--dsw-alias-label-primary,#ddd);font-size:13px;cursor:pointer}.ssm-tune-act:hover{background:var(--dsw-alias-fill-l3,#ffffff1a)}.ssm-tune-act:disabled{opacity:.45;cursor:default}.ssm-tune-foot{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);line-height:17px;white-space:normal}";
		const PHASE_LABEL = {
			starting: "启动中",
			loading_model: "加载模型",
			loading_experts: "载入专家权重",
			ready: "就绪",
			failed: "启动失败",
			stopping: "卸载中",
			unloaded: "未加载",
			unknown: "未知"
		};
		const MODEL_LABEL = (model) => {
			if (typeof model !== "string" || model === "") return "strata";
			if (model.includes("uncensored")) return "uncensored-iq3m";
			if (model.includes("iq3_s")) return "iq3_s";
			return model;
		};
		const injectCss = () => {
			if (typeof document === "undefined") return;
			const id = "dsh-plugin-strata/css";
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(id) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-strata";
			tag.dataset.pluginCss = id;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		};
		const usePolled = (url, ms) => {
			const [snapshot, setSnapshot] = useState(null);
			useEffect(() => {
				let alive = true;
				let timer = null;
				const tick = async () => {
					try {
						const response = await fetch(url, { cache: "no-store" });
						if (!response.ok) throw new Error("HTTP " + response.status);
						const body = await response.json();
						if (alive) setSnapshot(body);
					} catch {
						if (alive) setSnapshot((previous) => previous === null ? previous : { ...previous, stale: true });
					}
					if (alive) timer = setTimeout(tick, ms);
				};
				tick();
				return () => {
					alive = false;
					if (timer !== null) clearTimeout(timer);
				};
			}, [url, ms]);
			return snapshot;
		};
		const currentOf = (snapshot) => {
			if (snapshot === null) return null;
			const where = snapshot.live ?? snapshot.last;
			if (where === null || where === void 0) return null;
			return where;
		};
		function StrataChip({ url, ms }) {
			injectCss();
			const snapshot = usePolled(url, ms);
			const [open, setOpen] = useState(false);
			const where = currentOf(snapshot);
			if (where === null) return null;
			const phase = PHASE_LABEL[where.phase] !== void 0 ? where.phase : "unknown";
			return jsxs("div", {
				className: "ssm-chip",
				role: "status",
				"aria-live": "polite",
				title: where.text ?? "",
				children: [
					jsx("span", { className: "ssm-dot", "data-phase": phase }),
					jsx("span", { className: "ssm-model", children: MODEL_LABEL(where.model) }),
					jsx("span", { className: "ssm-phase", children: PHASE_LABEL[phase] }),
					where.text !== "" && where.text !== void 0 ? jsx("span", { className: "ssm-text", children: where.text }) : null,
					snapshot?.events?.length > 0 ? jsx("button", {
						type: "button",
						className: "ssm-open",
						title: open ? "收起" : "显示最近事件",
						onClick: () => setOpen((value) => !value),
						children: open ? "▾" : "▸"
					}) : null,
					open ? jsx("ul", {
						className: "ssm-list",
						children: (snapshot.events ?? []).slice(-12).map((event) => jsx("li", {
							children: new Date(event.at).toLocaleTimeString("zh-CN") + " [" + event.phase + "] " + event.text
						}, String(event.seq)))
					}) : null
				]
			});
		}
		function StrataSwitchBanner({ url, ms }) {
			injectCss();
			const snapshot = usePolled(url, ms);
			const [dismissed, setDismissed] = useState(null);
			const where = currentOf(snapshot);
			if (where === null) return null;
			const phase = where.phase ?? "unknown";
			const busy = ["starting", "loading_model", "loading_experts"].includes(phase);
			const failedPeriod = phase === "failed" ? where.period ?? 0 : null;
			const visible = busy || failedPeriod !== null && failedPeriod !== dismissed;
			if (!visible) return null;
			const events = (snapshot.events ?? []).slice(-6);
			return jsxs("div", {
				className: "ssm-banner",
				"data-phase": phase,
				role: "status",
				children: [
					jsxs("div", {
						className: "ssm-banner-main",
						children: [
							jsxs("div", {
								className: "ssm-banner-title",
								children: MODEL_LABEL(where.model) + " · " + (PHASE_LABEL[phase] ?? phase)
							}),
							jsx("div", { children: where.text ?? "" }),
							events.length > 0 ? jsx("ul", {
								className: "ssm-list",
								children: events.map((event) => jsx("li", {
									children: new Date(event.at).toLocaleTimeString("zh-CN") + " [" + event.phase + "] " + event.text
								}, String(event.seq)))
							}) : null
						]
					}),
					phase === "failed" ? jsx("button", {
						type: "button",
						className: "ssm-dismiss",
						title: "关闭",
						onClick: () => setDismissed(failedPeriod),
						children: "×"
					}) : null
				]
			});
		}
		const fmtParam = (entry) => {
			if (entry.kind === "bool") return entry.value === true ? "1" : entry.value === false ? "0" : "";
			if (entry.kind === "names") return Array.isArray(entry.value) ? entry.value.join(", ") : "";
			return entry.value === null || entry.value === void 0 ? "" : String(entry.value);
		};
		const parseParam = (entry, raw) => {
			if (raw === "") return null;
			if (entry.kind === "bool") return raw === "1";
			if (entry.kind === "number") {
				const value = Number(raw);
				if (!Number.isFinite(value)) throw new Error((entry.name ?? entry.key) + ": 需要数字，或留空表示清除");
				return value;
			}
			if (entry.kind === "names") return raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
			return raw;
		};
		const EFFORT_LABEL = { none: "不思考（直接答）", low: "简短思考", medium: "中等思考", high: "详尽思考" };
		const choiceLabel = (choice) => EFFORT_LABEL[choice] ?? choice;
		/**
		 * 调参面板，两块设置：
		 * ① 模型运行配置（hop /config）：保存写进 profile，下次引擎启动生效；
		 *    「重启生效」= hop 卸载后带 force 重新预热，立即生效、不发 prompt。
		 * ② 聊天设置（serve /settings）：所有应用共享的默认值，请求没带该参数时
		 *    就用它；保存立即生效并持久化，不需要重启。
		 * 读写都走宿主 monitor（:8756/params、/settings、/restart）——浏览器直连
		 * hop 会被 strata serve 的 _own_page Origin 检查拒掉，monitor 才是可信代理。
		 */
		function StrataTune({ base }) {
			injectCss();
			const [open, setOpen] = useState(false);
			const [data, setData] = useState(null);
			const [draft, setDraft] = useState({});
			const [shared, setShared] = useState(null);
			const [sharedDraft, setSharedDraft] = useState({});
			const [note, setNote] = useState("");
			const [busy, setBusy] = useState(false);
			const [restarting, setRestarting] = useState(false);
			const load = async () => {
				try {
					const response = await fetch(base + "/params", { cache: "no-store" });
					const body = await response.json();
					setData(body);
					setDraft({});
					if (!body.ok) setNote(body.error ?? "读取失败");
				} catch (error) {
					setNote("读取失败: " + (error?.message ?? error));
				}
				try {
					const response = await fetch(base + "/settings", { cache: "no-store" });
					const body = await response.json();
					setShared(body);
					setSharedDraft({});
				} catch (error) {
					setShared({ ok: false, error: String(error?.message ?? error) });
				}
			};
			useEffect(() => {
				if (!open) return;
				void load();
			}, [open, base]);
			useEffect(() => {
				if (!restarting) return void 0;
				let alive = true;
				let timer = null;
				const tick = async () => {
					try {
						const response = await fetch(base + "/events", { cache: "no-store" });
						const body = await response.json();
						const where = body.live ?? body.last ?? null;
						if (!alive) return;
						if (where !== null && where.phase === "ready") {
							setRestarting(false);
							setNote("新配置已生效。");
							void load();
						} else if (where !== null && where.phase === "failed") {
							setRestarting(false);
							setNote("重启失败：引擎没能启动，请展开状态芯片查看事件。");
						} else {
							setNote("引擎正在按新配置加载：" + (where?.text ?? where?.phase ?? "…"));
						}
					} catch {
					}
					if (alive) timer = setTimeout(tick, 1200);
				};
				void tick();
				return () => {
					alive = false;
					if (timer !== null) clearTimeout(timer);
				};
			}, [restarting, base]);
			const edit = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
			const editShared = (key, value) => setSharedDraft((previous) => ({ ...previous, [key]: value }));
			const save = async () => {
				const set = {};
				try {
					for (const entry of data?.keys ?? []) {
						if (!(entry.key in draft)) continue;
						set[entry.key] = parseParam(entry, draft[entry.key]);
					}
				} catch (error) {
					setNote(String(error?.message ?? error));
					return;
				}
				if (Object.keys(set).length === 0) {
					setNote("没有改动：改一行再点保存（留空 = 清除、回 strata 默认）。");
					return;
				}
				setBusy(true);
				try {
					const response = await fetch(base + "/params", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ set })
					});
					const body = await response.json();
					if (body.ok) {
						setNote("已保存 " + Object.keys(set).join(", ") + "；" + (body.note ?? "从模型的下一次启动起生效。") + " 点「重启生效」立即应用。");
						setData(body);
						setDraft({});
					} else {
						setNote("保存失败: " + (body.error ?? "HTTP " + response.status));
					}
				} catch (error) {
					setNote("保存失败: " + (error?.message ?? error));
				}
				setBusy(false);
			};
			const saveShared = async () => {
				const defaults = {};
				try {
					for (const entry of shared?.keys ?? []) {
						const value = parseParam(entry, entry.key in sharedDraft ? sharedDraft[entry.key] : fmtParam({ ...entry, value: (shared?.values ?? {})[entry.key] ?? null }));
						if (value !== null) defaults[entry.key] = value;
					}
				} catch (error) {
					setNote("聊天设置: " + String(error?.message ?? error));
					return;
				}
				if (Object.keys(sharedDraft).length === 0) {
					setNote("聊天设置没有改动：改一行再点「保存聊天设置」（留空 = 清除该项）。");
					return;
				}
				setBusy(true);
				try {
					const response = await fetch(base + "/settings", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ defaults })
					});
					const body = await response.json();
					if (body.ok) {
						setShared(body);
						setSharedDraft({});
						setNote(body.shared === true ? "聊天设置已保存：对所有没带这些参数的请求立即生效，无需重启。" : "聊天设置已全部清空：其他应用恢复使用自己的设置。");
					} else {
						setNote("聊天设置保存失败: " + (body.error ?? "HTTP " + response.status));
					}
				} catch (error) {
					setNote("聊天设置保存失败: " + (error?.message ?? error));
				}
				setBusy(false);
			};
			const restart = async () => {
				setBusy(true);
				setNote("正在请求重启引擎…");
				try {
					const response = await fetch(base + "/restart", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ model: data?.loaded ?? void 0 })
					});
					const body = await response.json();
					if (body.ok) setRestarting(true);
					else setNote("重启失败: " + (body.error ?? "HTTP " + response.status));
				} catch (error) {
					setNote("重启失败: " + (error?.message ?? error));
				}
				setBusy(false);
			};
			const row = (entry, drafts, setEdit) => {
				const raw = entry.key in drafts ? drafts[entry.key] : fmtParam(entry);
				return jsxs("label", {
					className: "ssm-tune-row",
					title: entry.key + " — " + (entry.help ?? ""),
					key: entry.key,
					children: [
						jsx("span", { className: "ssm-tune-key", children: entry.name ?? entry.key }),
						jsx("span", { className: "ssm-tune-id", children: entry.key }),
						entry.kind === "bool" ? jsxs("select", {
							value: raw,
							onChange: (event) => setEdit(entry.key, event.target.value),
							children: [
								jsx("option", {
									value: "",
									children: "默认",
									key: "d"
								}),
								jsx("option", {
									value: "1",
									children: "开",
									key: "1"
								}),
								jsx("option", {
									value: "0",
									children: "关",
									key: "0"
								})
							]
						}) : entry.kind === "enum" ? jsxs("select", {
							value: raw,
							onChange: (event) => setEdit(entry.key, event.target.value),
							children: [
								jsx("option", {
									value: "",
									children: "默认",
									key: "d"
								}),
								...(entry.choices ?? []).map((choice) => jsx("option", {
									value: choice,
									children: choiceLabel(choice),
									key: choice
								}))
							]
						}) : jsx("input", {
							type: entry.kind === "number" ? "number" : "text",
							step: entry.kind === "number" ? "any" : void 0,
							value: raw,
							placeholder: "默认",
							onChange: (event) => setEdit(entry.key, event.target.value)
						}),
						jsx("span", {
							className: "ssm-tune-hint",
							children: raw === "" ? "默认" : ""
						})
					]
				});
			};
			const rows = (data?.keys ?? []).map((entry) => row(entry, draft, edit));
			const sharedRows = (shared?.keys ?? []).map((entry) => row({ ...entry, value: (shared?.values ?? {})[entry.key] ?? null }, sharedDraft, editShared));
			return jsxs("div", {
				className: "ssm-tune-root",
				children: [
					jsx("button", {
						type: "button",
						className: "ssm-tune-btn",
						title: "调整 strata：模型运行配置 + 聊天设置（所有应用共享，立即生效），仅影响本地 strata 模型",
						onClick: () => setOpen((value) => !value),
						children: open ? "调参 ▾" : "调参 ▸"
					}),
					open ? jsxs("div", {
						className: "ssm-tune-panel",
						role: "dialog",
						"aria-label": "strata 调参",
						children: [
							jsxs("div", {
								className: "ssm-tune-head",
								children: [
									jsx("span", { className: "ssm-tune-title", children: "调参 · " + MODEL_LABEL(data?.model ?? data?.loaded ?? null) }),
									data?.source === "file" ? jsx("span", { className: "ssm-tune-tag", children: "只读（未加载）" }) : null,
									data?.loaded ? jsx("span", { className: "ssm-tune-tag", children: "已加载" }) : null
								]
							}),
							jsx("div", { className: "ssm-tune-sec", children: "模型运行配置（下次启动生效）" }),
							data?.keys === void 0 ? null : jsx("div", { className: "ssm-tune-rows", children: rows }),
							data === null ? jsx("div", { className: "ssm-tune-note", children: "读取中…" }) : null,
							jsxs("div", {
								className: "ssm-tune-actions",
								children: [
									jsx("button", {
										type: "button",
										className: "ssm-tune-act",
										disabled: busy || data?.writable !== true,
										onClick: () => void save(),
										title: "只保存上面的运行配置",
										children: "保存运行配置"
									}),
									jsx("button", {
										type: "button",
										className: "ssm-tune-act",
										disabled: busy || restarting || data?.loaded == null,
										onClick: () => void restart(),
										children: restarting ? "重启中…" : "重启生效"
									})
								]
							}),
							jsxs("div", {
								className: "ssm-tune-sec",
								children: [
									jsx("span", { children: "聊天设置（所有应用共享 · 立即生效）" }), jsx("span", { className: "ssm-tune-id", children: shared?.ok === true ? (shared.shared === true ? "已共享（其他应用沿用）" : "未共享（其他应用用自己的）") : "" }),
									shared?.ok === true ? jsx("button", {
										type: "button",
										className: "ssm-tune-act",
										disabled: busy || shared?.writable !== true,
										onClick: () => void saveShared(),
										title: "保存为 strata 的共享默认值：请求没带该参数时用这些值；保存即生效，无需重启",
										children: Object.keys(sharedDraft).length === 0 ? "保存聊天设置" : "保存聊天设置 *"
									}) : null
								]
							}),
							shared === null ? jsx("div", { className: "ssm-tune-note", children: "聊天设置读取中…" }) : shared.ok !== true ? jsx("div", { className: "ssm-tune-note", children: "聊天设置不可用：" + (shared.error ?? "未知错误") }) : jsx("div", { className: "ssm-tune-rows", children: sharedRows }),
							jsx("div", { className: "ssm-tune-note", children: note }),
							jsxs("div", {
								className: "ssm-tune-actions",
								children: [
									jsx("button", {
										type: "button",
										className: "ssm-tune-act",
										disabled: busy,
										onClick: () => void load(),
										children: "刷新"
									}),
									jsx("button", {
										type: "button",
										className: "ssm-tune-act",
										onClick: () => setOpen(false),
										children: "收起"
									})
								]
							}),
							jsx("div", {
								className: "ssm-tune-foot",
								children: "运行配置：保存写入该模型下次启动用的配置（hop 会自动留 .bak），点「重启生效」= 卸载后重新预热（约 25 秒，不发 prompt、不耗 token）。聊天设置：所有应用共享的默认值，保存立即生效、重启后仍在；请求明确带的参数（比如在 dsh 里选了 Effort）以请求为准。"
							})
						]
					}) : null
				]
			});
		}
		const inject = ["slots"];
		function apply(ctx) {
			injectCss();
			const url = typeof window === "undefined" ? "http://127.0.0.1:8756/events" : window.location.protocol + "//" + window.location.hostname + ":8756/events";
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "strata-switch",
				order: 40,
				inject: () => ({
					url,
					ms: 1000
				})
			}, StrataChip));
			ctx.slots.inject("conversation.content", () => ctx.slots.register({
				name: "conversation.content",
				id: "strata-switch-banner",
				order: 40,
				inject: () => ({
					url,
					ms: 1000
				})
			}, StrataSwitchBanner));
			const apiBase = url.slice(0, url.length - "/events".length);
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "strata-tune",
				order: 41,
				inject: () => ({
					base: apiBase
				})
			}, StrataTune));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
