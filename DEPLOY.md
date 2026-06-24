# HTTP-VNC Proxy - 寶塔面板部署指南

## 1. 寶塔 Node.js 環境設置

1. 寶塔面板 → 軟體商店 → 安裝「Node.js版本管理器」
2. 安裝 Node.js v18+ (推薦 v20 LTS)
3. 網站 → 新增站點 → 選擇 Node 項目
4. 將本項目文件上傳至網站目錄
5. 執行 `npm install`
6. 啟動項目 (PM2 管理)

## 2. Nginx 反向代理配置（關鍵！）

在寶塔 Nginx 反代配置中加入以下內容，否則 MJPEG 串流會 60 秒超時斷線：

```nginx
# 在 location / { ... } 區塊內加入：

# MJPEG 長連接超時設置
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;

# 關閉緩衝 - 降低延遲
proxy_buffering off;
proxy_cache off;
proxy_request_buffering off;

# 不再壓縮 MJPEG（已經是壓縮幀，再壓浪費 CPU 且增延遲）
proxy_set_header Accept-Encoding "";

# 通知 Node.js 真實客戶端 IP
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header Host $host;
```

## 3. HTTPS（強烈建議）

寶塔面板 → 網站 → SSL → 申請 Let's Encrypt 免費證書

遠程桌面畫面經過網路傳輸，不走 HTTPS 等於明文截圖裸奔。

## 4. 環境變量（可選）

在 PM2 啟動配置或 .env 中設置：

| 變量 | 默認值 | 說明 |
|---|---|---|
| PORT | 3000 | Node.js 監聽端口 |
| FPS | 10 | MJPEG 幀率（1-30） |
| JPEG_QUALITY | 60 | JPEG 壓縮質量（1-100，越低越快但越糊） |

## 5. A 網絡 Windows 機器 VNC 設置

確認 A 網絡的 Windows 機器上的 VNC Server：
- 已啟動並監聽端口 5900（或自訂端口）
- 防火牆允許 B 服務器 IP 訪問 5900 端口
- 設置 VNC 密碼（推薦）

## 6. 完整 Nginx 配置參考

```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 證書（寶塔自動填）
    ssl_certificate    /www/server/panel/vhost/cert/your-domain.com/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/your-domain.com/privkey.pem;

    # Node.js 反代
    location / {
        proxy_pass http://127.0.0.1:3000;

        # 基礎反代
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # MJPEG 關鍵配置
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        proxy_set_header Accept-Encoding "";
    }
}
```
