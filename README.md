# Netease Music Mini

极简网易云音乐浏览器播放器（Chrome Manifest V3 扩展）。

## Mini 家族

Mini 家族提供多个音乐平台的轻量浏览器播放器：

- [Netease Music Mini](https://github.com/vaeccc/netease-music-mini)：网易云音乐歌单、搜索与后台播放。
- [Bili mini](https://github.com/vaeccc/Bili-mini)：把有权访问的 B 站视频音轨作为后台音乐播放。
- [QQ Music Mini](https://github.com/vaeccc/qq-music-mini)：QQ 音乐曲库、搜索与后台播放。

## 功能

- 个人音乐：查看“我喜欢”和个人歌单，歌单内支持播放全部
- 榜单：浏览网易云排行榜，一键播放全部
- 搜索：按关键词搜索歌曲、歌手或专辑，进入对应详情并分页加载
- 分页：我喜欢、歌单、歌手、专辑和搜索歌曲均支持继续下滑加载
- 播放器：顺序 / 列表循环 / 单曲循环 / 随机播放，进度拖动，媒体键控制
- 登录：网易云音乐 App 扫码登录（可播放会员/付费歌曲）
- 主题：随封面自动取色

## 安装

1. 打开 Chrome，进入 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录

## 登录

扩展弹窗内点击「登录网易云音乐」会打开网易云官方登录页（当前网易云已拒绝第三方二维码接口）。也可以直接点击「使用官方网页登录」，登录成功后回到扩展即可。
登录后的 cookie 由浏览器托管，退出登录会同时清除扩展状态和网易云会话 Cookie。

## 技术要点

- 纯前端、零依赖、无构建步骤，约 1200 行原生 JavaScript
- weapi 请求加密：双层 AES-128-CBC + 裸 RSA 模幂（BigInt 实现，Web Crypto 不支持无填充）
- 播放器三上下文架构：service worker（状态调度）+ offscreen（音频播放）+ popup（界面）
- 搜索防抖、结果缓存、分页去重、增量渲染、播放状态指纹

## 目录结构

```
api/        接口层（netease.js 接口、crypto.js 加密、auth.js 登录）
background.js   service worker，消息调度与播放状态机
offscreen/   音频播放文档（关闭弹窗后继续播放）
popup/       弹窗界面
storage/     状态持久化
```

## 隐私政策

请参阅 [隐私政策](PRIVACY.md)。

## 声明

本项目仅供学习交流，使用网易云音乐非官方接口，接口可能随时变动。请勿用于商业用途。
