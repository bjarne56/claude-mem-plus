# 探测上游 thedotmack/claude-mem 安装到底改了哪些路径
# 镜像不需要持久化,跑完抓 diff 就丢
FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates unzip xz-utils jq rsync \
    && rm -rf /var/lib/apt/lists/*

# 装 bun(install.ts 里 ensureBun 会走它)
RUN curl -fsSL https://bun.sh/install | bash

ENV PATH="/root/.bun/bin:${PATH}"
ENV HOME=/root
WORKDIR /probe

COPY probe.sh /probe/probe.sh
RUN chmod +x /probe/probe.sh

# 不指定 ENTRYPOINT,留给 docker run 时直接调 /probe/probe.sh
CMD ["/probe/probe.sh"]
