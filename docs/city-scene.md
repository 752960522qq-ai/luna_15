# 城市场景

已将用户提供的 `ccity_building_set_1.glb` 接入现有摇杆测试框架。本次只更新场景与预览，不生成 APK。

## 尺寸与落脚点

建筑的 350 单位标准楼层按 0.01 换算为 3.5 米。人物维持原网格尺寸，静止身高约 1.73 米，包含高跟鞋。
整个路面边界为 558 × 234 米；最高建筑约 31.66 米。所有城市顶点烘焙到同一米制坐标，避免在运行时继承 FBX 根节点的轴向与缩放。

原车模相对建筑偏大，单独按 0.55 缩放，校正后车身约 3.72 × 1.74 × 1.13 米。车辆保持原停车位置，轮胎最低点对齐路面。
其余街区建筑、路灯、道路、球场及贴图保持来源素材的相对比例；该素材是风格化场景，不代表实测城市。

起点位于中间南北街道，源坐标为 `[-14300, 0, -8800]`，重置后朝北。
沥青路面统一至 Y = 0，人行道保留 0.2 米高差。逐帧采样实际道路网格的地面高度，再叠加原先的高跟鞋蒙皮顶点高度修正，防止悬空或穿地。当前可对齐道路与人行道，不含复杂楼梯攀爬动画。

## 移动与镜头

替换原先半径 22 米测试圆的限制，采用街区矩形边界和 22 个建筑/车辆包围盒。
人物在墙边可滑动，无法穿过建筑外轮廓；停止前进时步频根据实际移动距离停止。
建筑碰撞较保守，覆盖屋檐、阳台等外轮廓，当前不支持进入室内。

第三人称距离仍为 3.5 米，墙体会缩短镜头距离以减少穿墙。
日光照明、天空色与远景雾适配街区；镜头远裁剪扩大到 900 米。
四个现有动作及走路/跑步速度保持原配置。

## 资源与验证

1,357 个静态绘制单元按原材质合并为 22 个，保留 31,050 个三角形与 12 张原始 PNG 贴图。
运行 GLB 由 `models/city-neighborhood.glb.gz` 无损还原，校验信息和场景尺度见 `models/city-manifest.json`。
原上传文件未改写；导入脚本 `scripts/import_city.py` 可用原始 GLB 重新生成派生资源，需要 numpy。

```bash
python3 scripts/prepare_assets.py
python3 scripts/check_web.py
node scripts/check_movement.mjs
node scripts/check_runtime.mjs
node scripts/check_city.mjs
```

`check_city.mjs` 实际加载场景，检查米制边界、开放街道起点、墙体阻挡、墙边滑动、长距离移动与镜头遮挡。
城市预览由实际 Three.js 场景渲染；开发诊断参数允许固定预览镜头，不改变正常游戏的默认视角。
`scripts/preview_city.mjs` 使用 Playwright 截取街景与俯视图，并实际操作键盘和按钮检查走路、跑步及瞄准待机；需安装 Playwright 与 Chromium。`PREVIEW_OUTPUT` 可指定截图目录，`CHROMIUM_EXECUTABLE` 可指定现有浏览器。

## 素材署名

**CCity Building Set 1** — [Neberkenezer](https://sketchfab.com/neberkenezer)。
[原素材](https://sketchfab.com/3d-models/ccity-building-set-1-a2d5c7bfcc2148fb8994864c43dfcc97)，
许可 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。
变更：单位与原点换算、车辆尺寸校正、静态几何合并、添加运行场景与阻挡信息。署名与许可同时保留在派生 GLB 的 asset.extras 中。
