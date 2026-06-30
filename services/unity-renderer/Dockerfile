FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libasound2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libglu1-mesa \
    libgtk-3-0 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxinerama1 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/unity-renderer

COPY builds ./builds
COPY docker-entrypoint.sh /usr/local/bin/unity-renderer-entrypoint

RUN chmod +x /usr/local/bin/unity-renderer-entrypoint \
  && chmod +x ./builds/unity-build.x86_64 \
  && test -d ./builds/unity-build_Data

ENV UNITY_EXECUTABLE=/opt/unity-renderer/builds/unity-build.x86_64 \
    UNITY_USE_XVFB=1 \
    XVFB_SCREEN=1280x720x24 \
    SIGNALING_URL=ws://gateway:8080 \
    SIGNALING_TYPE=websocket \
    LD_LIBRARY_PATH=/opt/unity-renderer/builds

ENTRYPOINT ["/usr/local/bin/unity-renderer-entrypoint"]
CMD ["-logFile", "-"]
