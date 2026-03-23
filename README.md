# Selection Translator

选中即翻译。后台常驻，选中文本后点击悬浮按钮，调用大模型 API 翻译。

支持平台：**macOS、Windows**

---

## 快速开始

### 1. 安装前置依赖

**Windows** 需要 C++ 编译工具（用于编译原生模块 uiohook-napi）：

下载并安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)，安装时勾选「使用 C++ 的桌面开发」。

**macOS** 运行：
> 可先运行 `xcode-select -p` 和 `clang --version` 检测是否已安装 Xcode 命令行工具。如果前者输出路径信息，后者输出版本信息，则表示已安装。就不需要再执行下面的安装命令了。
```bash
xcode-select --install
```

### 2. 克隆并安装依赖

```bash
git clone https://github.com/washing1127/selection-translator.git
cd selection-translator
npm install
npm install uiohook-napi
```

### 3. 配置 API Key

```bash
# 复制示例配置
cp config.example.json config.json
```

编辑 `config.json`，填入你的 API Key：

```json
{
  "api": {
    "provider": "qwen",
    "apiKey": "sk-你的key填这里"
  }
}
```

### 4. ⚠️ Windows 高分屏必须设置 dpiScale
> **macOS 固定为 1**

编辑 `config.json`：

```json
"ui": {
  "dpiScale": 1.5
}
```

**dpiScale = Windows 显示缩放百分比 ÷ 100** 

| Windows 缩放设置 | dpiScale |
|-----------------|----------|
| 100%            | 1.0      |
| 125%            | 1.25     |
| 150%            | 1.5      |
| 175%            | 1.75     |
| 200%            | 2.0      |

查看方式：Windows 设置 → 系统 → 显示 → 缩放

### 5. 启动

```bash
npm start
```

或者双击`start.bat`(win) / `start.sh`(mac)

---

## 使用方式

1. 用鼠标在任意应用中拖选文字
2. 光标旁出现半透明翻译按钮（约 1 个字符大小）
3. 点击按钮，等待翻译结果
4. 悬浮窗操作：
   - **复制**：复制译文到剪贴板
   - **锁定**：锁定后点击外部不关闭窗口
   - **×**：关闭
   - 未锁定时点击窗口外任意位置自动关闭

翻译按钮 4 秒未点击自动消失。

---

## 完整配置说明

```json
{
  "api": {
    "provider": "qwen",       // 服务商: qwen / kimi / openai / deepseek
    "apiKey": "YOUR_KEY",     // API Key（勿提交到 git）
    "model": "qwen-turbo",    // 可选：覆盖该服务商默认模型
    "providers": { ... }      // 各服务商连接参数，一般不需要改
  },
  "translation": {
    "sourceLang": "auto",     // 源语言，auto = 自动检测
    "targetLang": "zh"        // 目标语言: zh/en/ja/ko/fr/de/es/ru
  },
  "cache": {
    "maxSize": 500            // 内存缓存上限（LRU，重启清空）
  },
  "ui": {
    "dpiScale": 1.0,          // ⚠️ Windows 缩放比例 ÷ 100
    "buttonOpacity": 0.75,    // 翻译按钮透明度 0~1
    "buttonOffsetX": 12,      // 按钮相对鼠标 X 偏移（逻辑像素）
    "buttonOffsetY": -8       // 按钮相对鼠标 Y 偏移（逻辑像素）
  }
}
```

修改配置后右键托盘图标 → **Reload Config** 热加载，无需重启。

---

## 支持的 API 服务商

只要是 OpenAI 兼容接口，直接在 `config.json` 的 `providers` 里加一条即可：

```json
"my-provider": {
  "baseUrl": "https://api.example.com/v1",
  "model": "my-model",
  "chatPath": "/chat/completions"
}
```

---

## macOS 额外步骤

首次启动后需要授权辅助功能权限：

**系统设置 → 隐私与安全 → 辅助功能** → 添加并启用本应用

不授权则无法读取选中文本。

---

## 已知限制

| 问题 | 说明 |
|------|------|
| 微信、Trae 等应用延迟较高 | UI Automation 覆盖不到时走剪贴板方案（Ctrl+C），首次约 300ms，后续约 50ms |
| 终端中不要用于选中文本翻译 | 剪贴板方案会发送 Ctrl+C，在终端中可能会中断正在运行的程序 |
| 悬浮窗不跟随页面滚动 | 跨进程无法获取其他应用的滚动事件，此功能未实现 |
| 多显示器不同缩放比例 | dpiScale 只支持单一值，多显示器缩放不同时按主显示器设置 |

---

## 目录结构

```
selection-translator/
├── main/
│   ├── index.js            # 主进程入口
│   ├── accessibility.js    # 读取选中文本
│   ├── apiClient.js        # LLM API 调用
│   ├── cache.js            # LRU 缓存
│   ├── config.js           # 配置读取
│   ├── mouseListener.js    # 全局鼠标监听（uiohook-napi）
│   ├── sendKey.js          # 快速发送 Ctrl+C（持久化 PS 进程）
│   ├── winNoActivate.js    # Windows 窗口不抢焦点
│   └── windowManager.js   # 窗口管理
├── renderer/
│   ├── button/index.html   # 翻译按钮
│   └── popup/index.html    # 翻译结果窗口
├── assets/tray.png         # 托盘图标
├── config.example.json     # 配置模板（可提交到 git）
├── config.json             # 实际配置，含 API Key（已加入 .gitignore）
├── .gitignore
├── .npmrc                  # npm 镜像（国内加速）
└── package.json
```
