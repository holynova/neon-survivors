# 霓虹幸存者 · NEON SURVIVORS

浏览器里的 **3D 俯视角类幸存者 Roguelite**。武器自动开火，你只需走位与成长。

![gameplay](docs/screenshot.jpg)

**在线试玩** → <https://holynova.github.io/neon-survivors/>　手机扫码 👉

![qr](docs/qr.png)

- **源码** → <https://github.com/holynova/neon-survivors>
- **设计文档** → [docs/GDD.md](docs/GDD.md)

## 玩法

20 波，每 5 波一个 BOSS。击杀掉经验 → 三选一强化卡 → 波间商店 → 死亡结算，一局 12~20 分钟。

- **5 角色**：各改写一套规则（掉落 / 召唤 / 范围 / 连锁 / 减速）+ 专属主动技能
- **8 武器**：散射、弹跳电弧、抛物爆炸、持续锥形、环绕、贯穿、追踪、充能；4 级 + 核心材料可**进化**
- **8 敌人 + 3 BOSS**：各有独立剪影，不靠颜色也能分辨

## 技术

- **Three.js + Vite**，运行时依赖只有 `three`
- **零外部资源**：无 `.glb`/`.png`/`.mp3`。模型程序化生成，音效实时合成
- 自写 **fresnel 轮廓 shader** —— 俯视角场景缺主光，纯色几何体会溶进网格地面
- **扫掠碰撞**防止高速弹丸穿透小型敌人
- 固定步长主循环 + `timeScale`，实现 hitstop 定格与慢镜
- 6 池 GPU 粒子 + Bloom + 色差 + 冲击环 + 闪电；全部走对象池 / `InstancedMesh`

## 运行

```bash
npm install
npm run dev    # http://localhost:5180
```

`WASD` 移动 · `Shift` 冲刺 · `E` 技能 · `Space` 暂停 · `1/2/3` 选卡

`npm test` = 113 项单元测试（~1s）+ 17 项 e2e（~55s）。
单测含碰撞 fuzz 与**无头平衡验证**（5 角色前 3 波可活、站桩必死、每波血量 vs DPS 可通关、BOSS 击杀 8~60 秒）。
e2e 覆盖启动→菜单→角色→移动→战斗→升级→商店→结算→重开，每项都挂 `pageerror` 守卫——本项目最大一类 bug 是「某方法运行时是 undefined」，不守卫只会静默失灵。

## 授权

MIT。美术与音频全部由代码生成，无第三方素材授权问题。
