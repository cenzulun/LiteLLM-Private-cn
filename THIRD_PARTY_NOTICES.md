# 第三方许可说明

本仓库不是将全部依赖重新授权为单一许可证。各组件适用其原有许可证。

- LiteLLM 的开放源码部分保留 MIT 许可及原始版权声明，见根目录 `LICENSE`、`deploy/LICENSE.litellm.txt` 和 `sources/litellm-1.110.1/LICENSE`。
- LiteLLM 企业目录及企业功能适用其企业许可证，见 `deploy/LICENSE.enterprise.txt` 与 `sources/litellm-1.110.1/enterprise/LICENSE.md`。前端保留功能入口不代表取得企业生产授权。
- MindIE-Motor 子模块来自 `https://github.com/Ascend/MindIE-Motor`，固定提交为 `96846215cf4f05aaf44068e1784f25d64c18e845`。适用许可证与第三方声明位于该子模块的 `LICENSE.md`、`motor/kv_conductor/THIRD_PARTY_NOTICES.md` 和相邻 `licenses` 目录。
- 前端随附的依赖包与字体、图像、标志等资源保留各自许可和权利归属。`vendor` 中的包是依赖锁文件指定的构建输入，保留包内许可文件。
- 运行镜像、npm、Python、Rust 及系统依赖保留各自许可证。源码构建时应保留对应依赖的许可证和声明。

界面品牌替换不移除交付源码和依赖中依法需要的版权与许可信息。
