# luna_15 · Luna 城市生活 V1

Three.js + Android WebView 的离线开放世界生活原型。主菜单进入出生公寓，探索街区、与 8 名市民互动、完成 3 个任务、购买服装和换装，并恢复本地存档。

默认主角使用本次提供的赤脚 Jill 模型，保留原尺寸约 1.73 米；穿高跟鞋时使用原 Jill heels 的姿态与四段动画。城市保持 0.45 倍，实际范围 251.1 × 105.3 米。镜头默认 2.2 米，瞄准肩后镜头 1.85 米，保留建筑碰撞和镜头遮挡检测。

## 安装与游玩

GitHub Actions 附件 `luna15-life-v1-test` 中的 `luna15-life-v1-test.apk` 是测试安装包。应用名称「Luna 城市生活」，包名仍为 `com.luna.heelmotion`，固定测试签名，可覆盖原测试版本。Android 8.0 及以上，系统 WebView 需支持 WebGL 2。全部资源内置，无网络或存储权限。

- 左下摇杆移动；右侧空白区域拖动镜头；右下跑步、瞄准和接近物体后出现的互动按钮。
- 公寓任务板或街口阿岚可接任务；服装店店员阿晴提供新生活入门服装。
- 公寓衣柜可试穿四个装束，也可按五个部位搭配。公寓床铺可跳转到 00、06、12、18 点。
- 公寓保存点、暂停设置页手动保存；游戏中每 15 秒、切后台、完成任务、购买或换装时自动保存。
- 主菜单「继续游戏」恢复存档。「新的生活」会提示替换已有存档。
- 暂停包含继续、地图、任务、衣柜、设置和返回主菜单。设置可选流畅画质、镜头距离和脚部观察。
- 桌面测试：WASD/方向键移动、Shift 跑步、E 互动、Esc 暂停。

## 构建

JDK 17、Android SDK 35、Build Tools 35.0.0、Gradle 8.11.1、AGP 8.9.2。

```bash
python3 scripts/prepare_assets.py
python3 scripts/check_web.py
node scripts/check_movement.mjs
node scripts/check_runtime.mjs
node scripts/check_city.mjs
node scripts/check_life.mjs
bash android/gradlew -p android assembleDebug assembleDebugAndroidTest lintDebug
python3 scripts/check_apk.py android/app/build/outputs/apk/debug/app-debug.apk
```

`web/` 全部随 APK 内置。三个大型 GLB 以无损 gzip 存入 `models/`，构建前恢复并校验 SHA-256。`android/test-signing.keystore` 为公开测试签名，不用于正式发行。推送 main 启动 APK 构建、签名与资源完整性校验，再由断网 Android 35 模拟器实际检查触控、任务、购买和重开恢复。

网页测试：

```bash
python3 scripts/prepare_assets.py
python3 -m http.server 8080 --directory web
```

浏览器集成检查及真实高跟鞋预览使用 `scripts/check_life_browser.mjs`、`scripts/render_heels.mjs`，需要 Playwright Chromium；可通过 `PLAYWRIGHT_MODULE`、`CHROMIUM_EXECUTABLE` 指定环境。鞋预览还需 sharp（`SHARP_MODULE`）。运行时网页不依赖这些开发工具。

## 结构与范围

详见 [V1 修改报告](docs/life-v1.md)，包含新增/修改文件、流程、检查与已知限制。统一状态位于 `web/player-state.js`，人物与 NPC 状态机、交互、任务、商店、时间、存档和导航分别独立。

四个装束为原始赤脚、高跟鞋、街头套装和夜色套装。新增服装采用简化骨骼绑定测试网格；后续可替换为精细服装资源。安全屋是单独的简易测试室内。无完整驾驶、交通、警察、通缉、多人或枪战，仅预留状态/交互接口。NPC 使用可行走区域、障碍和 waypoint 网络，尚未升级 NavMesh；不含角色间物理碰撞、跳跃、攀爬或动态破坏。

原项目回滚分支：`rollback/pre-life-v1-20261004`（`97646b49b6ffcfd3857fc7713c86743b366aefab`）。

Three.js 许可见 `web/vendor/LICENSE-THREE.txt`；人物素材遵循原文件许可。城市场景 Neberkenezer / CC BY 4.0，详见 [城市说明](docs/city-scene.md)；男性 NPC 资源与署名见 [市民说明](docs/male-citizens.md)。
