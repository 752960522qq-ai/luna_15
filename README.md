# luna_15 · 人物移动测试

Jill 模型、高跟鞋走路与跑步动画、手机摇杆，以及可离线运行的 Android 测试应用。
走路动画使用提供的 `Female Walk.fbx`，保留原待机与跑步。

## 手机测试

从 Actions 的 `luna15-heel-motion-test-v1` 构建附件下载 `luna15-heel-motion-test-v1.apk`。
支持 Android 8.0 及以上，使用手机系统 Android WebView，需要 WebGL 2。
资源全部内置，无需联网，无需存储或网络权限。应用名称为「人物移动测试」，包名 `com.luna.heelmotion`。

- 左下摇杆移动，右侧空白区域拖动旋转视角。
- 「跑步」切换走路与跑步，可一只手按摇杆、另一只手点击按钮。
- 「脚部视角」观察高跟鞋接触地面；「重置」返回起点。
- 横屏运行，适配两种横屏方向；切换应用时清除摇杆输入。

若手机 WebView 过旧导致图形加载错误，请更新 Android System WebView。

## 源码与构建

| 目录 | 内容 |
| --- | --- |
| `web/` | 完整网页框架和 Three.js 本地依赖，构建时还原完整 GLB |
| `models/` | 原模型及三段动画的无损压缩文件和校验信息 |
| `android/` | Android 原生 WebView 容器、签名配置、Gradle Wrapper |
| `scripts/` | 动作烘焙与替换脚本、资源和 APK 完整性检查、移动逻辑检查 |
| `docs/animation-framework.md` | 动画来源、高跟鞋处理与框架说明 |

Android 使用 `WebViewAssetLoader` 从应用内资源加载 HTTPS 同源模块，避免 `file://` 的加载限制。
所有模块使用相对路径，不依赖 import map、CDN 或在线网站。

构建环境：JDK 17、Android SDK 35、Build Tools 35.0.0。Gradle Wrapper 固定 8.11.1，Android Gradle Plugin 固定 8.9.2。

```bash
python3 scripts/prepare_assets.py
python3 scripts/check_web.py
node scripts/check_movement.mjs
bash android/gradlew -p android assembleDebug
```

输出：`android/app/build/outputs/apk/debug/app-debug.apk`。
完整动画 GLB 无损压缩存放于仓库；构建会自动还原并检查 SHA-256，APK 中仍是原完整 GLB。
公开的 `android/test-signing.keystore` 仅用于测试，固定测试签名使后续测试版本可覆盖安装；不可用于正式应用。

每次推送到 main，GitHub Actions 自动构建并检查 APK 签名、安装元数据和全部资源字节。
另一个模拟器任务实际安装 APK，在断网状态检查模型载入、原生摇杆触控、双指切换跑步、松杆停止、视角与重置。
真机的画面和帧率以手机实际测试为准。

网页本地运行：

```bash
python3 scripts/prepare_assets.py
python3 -m http.server 8080 --directory web
```

当前为平地移动测试框架，不含复杂地形、台阶或角色碰撞。
Three.js 许可见 `web/vendor/LICENSE-THREE.txt`；角色素材许可遵循原提供文件。
