#!/usr/bin/env bash
# dsh-plugin-strata 引导安装 / bootstrap installer
#
# 用法:
#   bash <(curl -fsSL https://raw.githubusercontent.com/youshanlian/dsh-plugin-strata/main/install.sh)
#   bash install.sh [--profile <name>] [--dry-run] [--skip-dsh-bootstrap]
#
# 做三件事:
#   1. 确保 dsh CLI 存在（没有则尝试用 npm 全局安装官方 CLI；--skip-dsh-bootstrap 跳过）
#   2. dsh plugin --profile <p> add github:youshanlian/dsh-plugin-strata
#   3. 校验：profile 的 package.json 出现依赖 + bundle，且 --dump-config 能装配成功
#
# 注意：插件只是 dsh 侧的控制面。系统侧需要先跑着 strata + strata-hop
# （见 README「前置条件」），本脚本不安装 strata 模型引擎。
set -euo pipefail

REPO="youshanlian/dsh-plugin-strata"
PROFILE="web"
DRY=0
BOOTSTRAP=1

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile 需要一个名字}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --skip-dsh-bootstrap) BOOTSTRAP=0; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1（--help 看用法）" >&2; exit 2 ;;
  esac
done

say() { printf '[install] %s\n' "$*"; }
die() { printf '[install] %s\n' "$*" >&2; exit 1; }

# 1. dsh CLI
if ! command -v dsh >/dev/null 2>&1; then
  if [ "$BOOTSTRAP" -eq 0 ]; then
    die "未找到 dsh CLI（--skip-dsh-bootstrap 时不自动安装）。先安装 dsh 再重试。"
  fi
  command -v npm >/dev/null 2>&1 || die "未找到 dsh CLI，也未找到 npm 来引导安装。请从官方渠道安装 dsh 后重跑。"
  say "未找到 dsh CLI，尝试 npm 全局安装…"
  if [ "$DRY" -eq 1 ]; then
    say "(dry-run) npm install -g @deepseek-ai/dsh"
  else
    npm install -g @deepseek-ai/dsh || die "npm 安装 @deepseek-ai/dsh 失败，请按官方文档安装 dsh 后重跑。"
    command -v dsh >/dev/null 2>&1 || die "npm 报告成功但 PATH 中仍无 dsh，请把 npm 全局 bin 加入 PATH 后重跑。"
  fi
fi
say "dsh CLI: $(command -v dsh)"

# 2. 安装插件（幂等：已装过则 pnpm 直接跳过）
say "安装 dsh-plugin-strata 到 profile「$PROFILE」…"
if [ "$DRY" -eq 1 ]; then
  say "(dry-run) dsh plugin --profile $PROFILE add github:$REPO"
else
  dsh plugin --profile "$PROFILE" add "github:$REPO"
fi

# 3. 校验
PKG="$HOME/.dsh/profiles/$PROFILE/package.json"
if [ "$DRY" -eq 0 ]; then
  [ -f "$PKG" ] || die "未找到 $PKG，profile 似乎没有创建成功。"
  grep -q "github:$REPO" "$PKG" || die "profile 依赖里没有 dsh-plugin-strata，安装可能失败。"
  grep -q '"dsh-plugin-strata"' "$PKG" || die "bundle 列表里没有 dsh-plugin-strata。"
  say "依赖与 bundle 已写入 $PKG"
  say "校验补丁装配（--dump-config，只读不启动）…"
  if timeout 60 dsh --profile "$PROFILE" --dump-config >/dev/null 2>&1; then
    say "补丁装配 OK：provider strata 与插件行已进入 profile。"
  else
    say "警告：--dump-config 失败。多为本机 hop/strata 前置条件缺失，插件本体不受影响；请按 README 前置条件排查。"
  fi
fi

say "完成。重启该 profile 的 dsh（dsh --profile $PROFILE）后即可看到顶部状态芯片与「调参」面板。"
say "提醒：模型 id 需与 ~/.config/strata/strata-hop.json 的 models 键一致，否则在 profile 补丁层覆盖 providers.strata（见 README）。"
