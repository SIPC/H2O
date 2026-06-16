## 1. 面板安装

---
1. 服务器新建目录（例如 `h2o`）。
2. 上传项目中 `docker-compose.yml` 。
3. 在该目录执行：

```bash
docker compose up -d
```

或者

```bash
docker run -d --name h2o --restart unless-stopped -e TZ=Asia/Shanghai -p 3000:3000 -v "$(pwd)/data:/app/data" sipcink/h2o:latest
```

```bash
docker run -d --name h2o --restart unless-stopped -e TZ=Asia/Shanghai -e H2O_SECURE_COOKIE=false -p 3000:3000 -v "$(pwd)/data:/app/data" sipcink/h2o:latest
```

> **💡 提示：** 如果你是纯 IP+端口（HTTP）部署，需要先编辑 `docker-compose.yml`，取消 `H2O_SECURE_COOKIE: "false"` 的注释，否则登录后 cookie 无法存储，页面会一直报错。有域名并配置了 HTTPS 的用户无需修改。

启动后访问：`http://你的服务器IP:3000`

<img src="./imge/home.png" alt="主页" width="400" />

首次使用请进入：`http://你的服务器IP:3000/init` 创建管理员账号。

<img src="./imge/init-admin.png" alt="初始化管理员页面" width="400" />

常用命令（可选）：

- 查看状态：`docker compose ps`
- 查看日志：`docker compose logs -f`
- 停止服务：`docker compose down`

---

[2. 一键安装 Hysteria2 以及 H2O Agent](2-auto-install-hy2.md)
