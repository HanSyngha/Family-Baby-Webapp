# untrunc 빌드 — FFmpeg 5.x 비호환 회피 위해 ubuntu 20.04(ffmpeg 4.x) + repo Makefile 사용.
FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential libavformat-dev libavcodec-dev libavutil-dev ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/anthwlock/untrunc.git /untrunc
WORKDIR /untrunc
RUN make FF_VER=system
ENTRYPOINT ["/untrunc/untrunc"]
