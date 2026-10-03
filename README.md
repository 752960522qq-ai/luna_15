# luna_15 · 人物移动测试

Jill 模型、四段高跟鞋动画、城市街区、手机摇杆，以及可离线运行的 Android 测试应用。
走路使用 `Female Walk.fbx`；跑步、待机分别替换为 `Running.fbx`、`Idle.fbx`，新增 `Rifle Aiming Idle.fbx` 瞄准待机。
当前源码已加入 CCity 街区，范围 558 × 234 米，人物约 1.73 米，含建筑阻挡与镜头防穿墙。城市更新只做预览，尚未打入 v2 APK。

## 手机测试

从 Actions 的 `luna15-heel-motion-test-v2` 构建附件下载 `luna15-heel-motion-test-v2.apk`。
支持 Android 8.0 及以上，使用手机系统 Android WebView，需要 WebGL 2。
资源全部内置，无需联网，无需存储或网络权限。应用名称为「人物移动测试」，包名 `com.luna.heelmotion`。

- 左下摇杆移动，右侧空白区域拖动旋转视角。
- 「跑步」切换走路与跑步，可一只手按摇杆、另一只手点击按钮。
- 「瞄准待机」选择步枪瞄准姿态，移动时播放正常走路/跑步，松杆后回到瞄准待机；再次点击恢复普通待机。
- 第三人称镜头默认距离从 4.7 米拉近至 3.5 米。
- 「脚部视角」观察高跟鞋接触地面；「重置」返回起点。
- 横屏运行，适配两种横屏方向；切换应用时清除摇杆输入。

若手机 WebView 过旧导致图形加载错误，请更新 Android System WebView。

## 源码与构建

| 目录 | 内容 |
| --- | --- |
| `web/` | 完整网页框架和 Three.js 本地依赖，构建时还原完整 GLB |
| `models/` | 人物动画与城市场景的无损压缩文件和校验信息 |
| `android/` | Android 原生 WebView 容器、签名配置、Gradle Wrapper |
| `scripts/` | 动作烘焙与替换脚本、资源和 APK 完整性检查、移动逻辑检查 |
| `docs/animation-framework.md` | 动画来源、高跟鞋处理与框架说明 |
| `docs/city-scene.md` | 城市尺度、资源处理、碰撞范围与素材署名 |

Android 使用 `WebViewAssetLoader` 从应用内资源加载 HTTPS 同源模块，避免 `file://` 的加载限制。
所有模块使用相对路径，不依赖 import map、CDN 或在线网站。

构建环境：JDK 17、Android SDK 35、Build Tools 35.0.0。Gradle Wrapper 固定 8.11.1，Android Gradle Plugin 固定 8.9.2。

```bash
python3 scripts/prepare_assets.py
python3 scripts/check_web.py
node scripts/check_movement.mjs
node scripts/check_runtime.mjs
node scripts/check_city.mjs
bash android/gradlew -p android assembleDebug
```

输出：`android/app/build/outputs/apk/debug/app-debug.apk`。
完整动画 GLB 无损压缩存放于仓库；构建会自动还原并检查 SHA-256，APK 中仍是原完整 GLB。
公开的 `android/test-signing.keystore` 仅用于测试，固定测试签名使后续测试版本可覆盖安装；不可用于正式应用。

推送到 main 默认由 GitHub Actions 构建并检查 APK 签名、安装元数据和全部资源字节；本次城市预览提交使用 `[skip ci]`，按请求暂不打包。
另一个模拟器任务实际安装 APK，在断网状态检查模型载入、原生摇杆触控、双指切换跑步、松杆停止、瞄准待机、视角与重置。
真机的画面和帧率以手机实际测试为准。

网页本地运行：

```bash
python3 scripts/prepare_assets.py
python3 -m http.server 8080 --directory web
```

当前为平地街区移动框架，支持建筑包围盒阻挡，不含复杂地形、台阶攀爬、室内探索或角色间碰撞。
Three.js 许可见 `web/vendor/LICENSE-THREE.txt`；角色素材许可遵循原提供文件。城市场景由 Neberkenezer 制作，使用 CC BY 4.0，署名与变更说明见 `docs/city-scene.md`。
