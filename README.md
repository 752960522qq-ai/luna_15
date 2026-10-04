# luna_15 · Luna 城市生活 V1

Three.js + Android WebView 的离线开放世界生活原型。主菜单进入出生公寓，探索街区、与 12 名市民互动、完成 3 个任务、购买服装和换装，并恢复本地存档。

默认主角使用提供的赤脚 Jill 模型，保留原尺寸约 1.73 米；穿高跟鞋时使用原 Jill heels 的姿态与四段动画。现有城市从 0.45 调整至 0.72（放大 60%），范围 401.76 × 168.48 米；新上传城市接入东侧街区。镜头默认 2.2 米，瞄准肩后镜头 1.85 米，保留建筑碰撞和镜头遮挡检测。

Ada 上衣和黑鞋仍可独立穿脱。本次修正黑鞋脚面穿出与鞋口断边，增加上传的 D’Orsay 高跟鞋和黑色吊带连衣裙，提供 10 个衣柜预设；新旧存档免费获得这四件测试物品。六名女性市民独立拆分为 GLB，适配上传的待机、走路及现有男性对话动作，男女各六名。旧城市存档的位置随地图缩放迁移，金钱和任务保持原值。适配、文件清单、检查和限制见 [本次修改报告](docs/city-clothes-female.md)。本次按追加要求构建 `0.4.0-city-clothes` 测试 APK，进度见 [构建工作流](https://github.com/752960522qq-ai/luna_15/actions/workflows/android-test.yml)。

## 安装与游玩

GitHub Actions 附件 `luna15-life-v1-test` 中的 `luna15-life-v1-test.apk` 是测试安装包。应用名称「Luna 城市生活」，包名仍为 `com.luna.heelmotion`，固定测试签名，可覆盖原测试版本。Android 8.0 及以上，系统 WebView 需支持 WebGL 2。全部资源内置，无网络或存储权限。

旧 V1 安装包对应 [代码 83a34fe](https://github.com/752960522qq-ai/luna_15/commit/83a34fe107330744f2cf7c02be324f8eb721c728)；[原构建与断网模拟器测试](https://github.com/752960522qq-ai/luna_15/actions/runs/37162484484) 包含旧版附件，不包含本次更新。本次新包使用相同包名与测试签名，版本码提升至 4，可覆盖旧测试版。

- 左下摇杆移动；右侧空白区域拖动镜头；右下跑步、瞄准和接近物体后出现的互动按钮。
- 公寓任务板或街口阿岚可接任务；服装店店员阿晴提供新生活入门服装。
- 公寓衣柜可试穿十个装束，也可按五个部位搭配。公寓床铺可跳转到 00、06、12、18 点。
- 公寓保存点、暂停设置页手动保存；游戏中每 15 秒、切后台、完成任务、购买或换装时自动保存。
- Android 存档同步写入应用私有存储，重开 WebView 可恢复；浏览器版本使用 localStorage。两者均带双槽校验和损坏回退。
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
node scripts/check_ada_clothes.mjs
node scripts/check_city_clothes.mjs
bash android/gradlew -p android assembleDebug assembleDebugAndroidTest lintDebug
python3 scripts/check_apk.py android/app/build/outputs/apk/debug/app-debug.apk
```

`web/` 全部随 APK 内置。四个大型 GLB 以无损 gzip 存入 `models/`，构建前恢复并校验 SHA-256。服装和市民成品 GLB 直接存入 `web/assets/`。`android/test-signing.keystore` 为公开测试签名，不用于正式发行。未标记 `[skip ci]` 的 main 推送启动 APK 构建、签名与资源完整性校验，再由断网 Android 35 模拟器实际检查触控、任务、购买和重开恢复。本次按用户追加要求启动构建。

网页测试：

```bash
python3 scripts/prepare_assets.py
python3 -m http.server 8080 --directory web
```

浏览器集成检查及真实高跟鞋预览使用 `scripts/check_life_browser.mjs`、`scripts/render_heels.mjs`，需要 Playwright Chromium；可通过 `PLAYWRIGHT_MODULE`、`CHROMIUM_EXECUTABLE` 指定环境。鞋预览还需 sharp（`SHARP_MODULE`）。运行时网页不依赖这些开发工具。

三张 Ada 穿着预览使用 `node scripts/render_ada_outfits.mjs`，同样需要 Playwright Chromium、sharp 和可显示中文的字体。输出默认位于 `artifacts/ada-outfit/`，可用 `ADA_PREVIEW_OUTPUT` 修改目录。预览加载游戏的 Avatar、原有动画和实际服装 GLB。

本次真实衣服、鞋子、女性市民预览使用 `node scripts/render_city_clothes.mjs`；实际城市游戏截图使用 `node scripts/render_world_update.mjs`。同样需要 Playwright Chromium、sharp 和中文字体，默认输出 `artifacts/city-clothes/`。`POSE_QA=1` 可额外生成走路、跑步和瞄准姿势检查图。

## 结构与范围

详见 [V1 修改报告](docs/life-v1.md)，包含新增/修改文件、流程、检查与已知限制。统一状态位于 `web/player-state.js`，人物与 NPC 状态机、交互、任务、商店、时间、存档和导航分别独立。

原有四个装束为原始赤脚、高跟鞋、街头套装和夜色套装；街头、夜色服装仍为简化骨骼绑定测试网格。新增三个 Ada 预设使用本次上传的真实服装网格、UV 和贴图，已适配两套 Jill 骨架。安全屋是单独的简易测试室内。无完整驾驶、交通、警察、通缉、多人或枪战，仅预留状态/交互接口。NPC 使用可行走区域、障碍和 waypoint 网络，尚未升级 NavMesh；不含角色间物理碰撞、跳跃、攀爬或动态破坏。

D’Orsay 鞋与连衣裙新增三个真实模型预设，支持鞋与裙子独立搭配。连衣裙采用骨骼蒙皮，尚无布料物理。

原项目回滚分支：`rollback/pre-life-v1-20261004`（`97646b49b6ffcfd3857fc7713c86743b366aefab`）。
本次服装更新前的回滚分支：`rollback/pre-ada-outfit-20261004`（`20f821b4d82a0300ed09bac62f4bc32d4fb24c6e`）。
本次城市、鞋裙与女性市民更新前的回滚分支：`rollback/pre-city-clothes-female-20261004`（`003112fb50b209466b48aa1d24e726cf78587b5b`）。

Three.js 许可见 `web/vendor/LICENSE-THREE.txt`；人物素材遵循原文件许可。城市场景 Neberkenezer / CC BY 4.0，详见 [城市说明](docs/city-scene.md)；男性 NPC 资源与署名见 [市民说明](docs/male-citizens.md)。
新上传的城市、鞋子、连衣裙和女性市民署名见 [本次修改报告](docs/city-clothes-female.md#素材署名)。
